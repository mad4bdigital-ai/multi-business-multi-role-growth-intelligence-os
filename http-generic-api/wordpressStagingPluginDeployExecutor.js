import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { getPool } from "./db.js";
import { resolveEffectiveCredential } from "./credentialResolver.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";
import {
  capabilityEnvelopeError,
  extractCapabilityEnvelopeId,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
  transitionCapabilityEnvelopeLifecycle,
} from "./capabilityResolutionEnvelopeGuard.js";

export const WORDPRESS_STAGING_DEPLOY_CONTRACT = "mad4b.wordpress-staging-plugin-deploy.v2";
export const WORDPRESS_STAGING_HANDOFF_CONTRACT = "mad4b.wordpress-deployment-handoff.v2";
export const WORDPRESS_STAGING_DEPLOY_OPERATION = "wordpress_plugin_deploy";
export const WORDPRESS_STAGING_SOURCE_REPOSITORY = "mad4bdigital-ai/WordPress";
export const WORDPRESS_STAGING_SOURCE_WORKFLOW = "mad4b-control-plane-package.yml";
export const WORDPRESS_STAGING_ORIGIN = "https://staging.egypttourgates.com";
export const WORDPRESS_STAGING_HOST = "staging.egypttourgates.com";
export const WORDPRESS_STAGING_SITE_UUID = "d745d81f-6fc4-5c6a-99dd-d953c92137bf";
export const WORDPRESS_STAGING_PLUGIN_SLUG = "mad4b-site-control-plane";
export const WORDPRESS_STAGING_MCP_ADAPTER_VERSION = "0.6.1";

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 300000;
const SSH_CONNECT_TIMEOUT_SECONDS = 10;
const SSH_SERVER_ALIVE_INTERVAL_SECONDS = 5;
const SSH_SERVER_ALIVE_COUNT_MAX = 1;
const SSH_PROCESS_KILL_GRACE_MS = 5000;
const SSH_COMMON_ROLES = ["ssh_host", "ssh_port", "ssh_user"];
const SSH_PASSWORD_ROLE = "ssh_password";
const SSH_PRIVATE_KEY_ROLE = "ssh_private_key";
const SSH_AUTH_MODES = new Set(["password", "private_key"]);
const REQUIRED_HANDOFF_FORBIDDEN = [
  "unenrolled_target",
  "implicit_production_write",
  "breakglass",
  "raw_sql_side_channel",
  "caller_supplied_credentials",
  "merge_or_ready_before_required_acceptance",
];

function compact(value = "", max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function deployError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = { ...details, secrets_included: false };
  return err;
}

function normalizeOrigin(value = "") {
  const text = compact(value, 2048).replace(/\/+$/, "");
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return "";
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function assertSafeWordPressPath(value = "") {
  const path = compact(value, 1024).replace(/\/+$/, "");
  if (!path.startsWith("/home/") || path.includes("..") || /[\0\r\n;&|`$<>]/.test(path)) {
    throw deployError("wordpress_staging_deploy_path_invalid", "The server-owned WordPress root path is not safe.", 409);
  }
  return path;
}

function wildcardPathToRegex(pattern) {
  const escaped = String(pattern || "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]+")
    .replace(/\/+$/, "");
  return new RegExp(`^${escaped}(?:/.*)?$`);
}

function pathAllowedByTarget(path, target) {
  return Array.isArray(target?.path_allowlist)
    && target.path_allowlist.some((pattern) => wildcardPathToRegex(pattern).test(path));
}

function parseStoredJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

async function safeQuery(pool, sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return [];
    throw err;
  }
}

async function loadStagingTargetCandidates(pool) {
  const rows = await safeQuery(
    pool,
    `SELECT *
       FROM remote_runtime_targets
      WHERE plugin_key = 'remote_ssh_runtime'
        AND target_kind = 'hosting_account'
        AND provider_family = 'hostinger'
        AND status = 'active'
        AND validation_status IN ('valid','validated')
      ORDER BY updated_at DESC
      LIMIT 50`,
    [],
  );
  return rows.map((row) => ({
    target_id: row.target_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id || null,
    target_kind: row.target_kind,
    provider_family: row.provider_family || null,
    connector_family: row.connector_family || null,
    system_id: row.system_id || null,
    host_label: row.host_label || "",
    root_path: row.root_path || null,
    path_allowlist: parseStoredJson(row.path_allowlist_json, []),
    command_allowlist: parseStoredJson(row.command_allowlist_json, []),
    metadata: parseStoredJson(row.metadata_json, {}),
    status: row.status,
    validation_status: row.validation_status,
  }));
}

function stagingTargetIdentity(target) {
  const metadata = target?.metadata && typeof target.metadata === "object" ? target.metadata : {};
  return {
    environment: compact(metadata.environment || metadata.environment_type || metadata.environment_key, 64).toLowerCase(),
    origin: normalizeOrigin(metadata.origin || metadata.site_url || metadata.home_url || metadata.wordpress_origin),
    site_uuid: compact(metadata.site_uuid || metadata.site_profile_uuid || metadata.wordpress_site_uuid, 64).toLowerCase(),
  };
}

async function resolveUniqueStagingTarget(pool) {
  const candidates = await loadStagingTargetCandidates(pool);
  const matches = candidates.filter((target) => {
    const identity = stagingTargetIdentity(target);
    return identity.environment === "staging"
      && identity.origin === WORDPRESS_STAGING_ORIGIN
      && identity.site_uuid === WORDPRESS_STAGING_SITE_UUID
      && Array.isArray(target.command_allowlist)
      && target.command_allowlist.includes(WORDPRESS_STAGING_DEPLOY_OPERATION);
  });
  if (matches.length === 0) {
    throw deployError(
      "wordpress_staging_deploy_target_not_registered",
      "No unique active+validated Hostinger target is registered for the exact ETG Staging Site Profile and WordPress deploy command.",
      409,
      { candidate_count: candidates.length, matched_count: 0, expected_origin: WORDPRESS_STAGING_ORIGIN, expected_site_uuid: WORDPRESS_STAGING_SITE_UUID },
    );
  }
  if (matches.length > 1) {
    throw deployError(
      "wordpress_staging_deploy_target_ambiguous",
      "More than one active+validated Hostinger target matches the exact ETG Staging deployment identity.",
      409,
      { matched_count: matches.length, expected_origin: WORDPRESS_STAGING_ORIGIN, expected_site_uuid: WORDPRESS_STAGING_SITE_UUID },
    );
  }
  return matches[0];
}

function assertStagingTarget(target) {
  if (!target) throw deployError("wordpress_staging_deploy_target_not_found", "The Hostinger target was not found.", 404);
  if (target.target_kind !== "hosting_account" || target.provider_family !== "hostinger") {
    throw deployError("wordpress_staging_deploy_target_not_supported", "Only an explicit Hostinger hosting_account target is supported.");
  }
  if (target.status !== "active" || !["valid", "validated"].includes(String(target.validation_status || "").toLowerCase())) {
    throw deployError("wordpress_staging_deploy_target_not_ready", "The Hostinger Staging target must be active and validated.");
  }
  if (!Array.isArray(target.command_allowlist) || !target.command_allowlist.includes(WORDPRESS_STAGING_DEPLOY_OPERATION)) {
    throw deployError("wordpress_staging_deploy_command_not_allowlisted", "The target does not allow the WordPress Staging deployment operation.");
  }
  const metadata = target.metadata && typeof target.metadata === "object" ? target.metadata : {};
  const environment = compact(metadata.environment || metadata.environment_type || metadata.environment_key, 64).toLowerCase();
  const origin = normalizeOrigin(metadata.origin || metadata.site_url || metadata.home_url || metadata.wordpress_origin);
  const siteUuid = compact(metadata.site_uuid || metadata.site_profile_uuid || metadata.wordpress_site_uuid, 64).toLowerCase();
  if (environment !== "staging" || origin !== WORDPRESS_STAGING_ORIGIN || siteUuid !== WORDPRESS_STAGING_SITE_UUID) {
    throw deployError("wordpress_staging_deploy_target_identity_mismatch", "Target metadata does not prove the exact Egypt Tour Gates Staging environment and origin.", 409, {
      environment: environment || null,
      origin: origin || null,
      site_uuid: siteUuid || null,
      expected_environment: "staging",
      expected_origin: WORDPRESS_STAGING_ORIGIN,
      expected_site_uuid: WORDPRESS_STAGING_SITE_UUID,
    });
  }
  const wordpressPath = assertSafeWordPressPath(target.root_path || "");
  if (!pathAllowedByTarget(wordpressPath, target)) {
    throw deployError("wordpress_staging_deploy_path_not_allowlisted", "The server-owned WordPress root is outside the target path allowlist.");
  }
  return { wordpressPath, environment, origin, site_uuid: siteUuid };
}

async function resolveSshCredential(pool, target, role) {
  const result = await resolveEffectiveCredential({
    tenantId: target.tenant_id,
    userId: target.user_id || undefined,
    systemId: target.system_id || undefined,
    credentialRole: role,
    includeSecret: true,
    allowPlatformFallback: true,
  }, { pool });
  if (result?.status !== "resolved" || !compact(result.secret, 20000)) {
    throw deployError("wordpress_staging_deploy_ssh_credential_unresolved", `Required server-side SSH credential ${role} is not resolved.`, 409, { role });
  }
  return String(result.secret);
}

async function resolveSshConnection(pool, target, requestedMode = "") {
  const [host, port, user] = await Promise.all(SSH_COMMON_ROLES.map((role) => resolveSshCredential(pool, target, role)));
  const mode = compact(requestedMode, 32).toLowerCase() || (target.provider_family === "hostinger" ? "password" : "private_key");
  if (!SSH_AUTH_MODES.has(mode)) throw deployError("wordpress_staging_deploy_ssh_auth_mode_invalid", "ssh_auth_mode must be password or private_key.", 400);
  if (mode === "password") {
    return { host, port, user, auth_mode: mode, password: await resolveSshCredential(pool, target, SSH_PASSWORD_ROLE) };
  }
  return { host, port, user, auth_mode: mode, privateKey: await resolveSshCredential(pool, target, SSH_PRIVATE_KEY_ROLE) };
}

function hardenedSshOptions({ password = false } = {}) {
  const options = [
    "-T",
    "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
    "-o", "ConnectionAttempts=1",
    "-o", `ServerAliveInterval=${SSH_SERVER_ALIVE_INTERVAL_SECONDS}`,
    "-o", `ServerAliveCountMax=${SSH_SERVER_ALIVE_COUNT_MAX}`,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "LogLevel=ERROR",
  ];
  if (password) options.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1");
  else options.push("-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes");
  return options;
}

function sanitizeOutput(value = "") {
  return String(value || "")
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[redacted-private-key]")
    .replace(/(password|passphrase|token|secret|private_key)=\S+/gi, "$1=[redacted]")
    .slice(0, 12000);
}

function killProcessTree(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); return; } catch { /* fallback */ }
  try { child.kill(signal); } catch { /* noop */ }
}

async function runSshCommand(connection, remoteScript, { timeoutMs = DEFAULT_TIMEOUT_MS, stdinBuffer = null } = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), "mad4b-wp-staging-ssh-"));
  const keyFile = join(tempDir, "id_key");
  const passwordFile = join(tempDir, "password");
  const askpassFile = join(tempDir, "askpass.cjs");
  try {
    const passwordMode = connection.auth_mode === "password";
    let env = process.env;
    let args;
    if (passwordMode) {
      await writeFile(passwordFile, connection.password, { mode: 0o600 });
      await writeFile(askpassFile, [
        "const { readFileSync, rmSync } = require('node:fs');",
        "const file = process.env.MAD4B_SSH_ASKPASS_FILE;",
        "if (!file) process.exit(1);",
        "try { const value = readFileSync(file, 'utf8'); rmSync(file, { force: true }); process.stdout.write(value); } catch { process.exit(1); }",
      ].join("\n"), { mode: 0o600 });
      env = {
        ...process.env,
        SSH_ASKPASS: process.execPath,
        SSH_ASKPASS_REQUIRE: "force",
        DISPLAY: "mad4b-wp-staging:0",
        MAD4B_SSH_ASKPASS_FILE: passwordFile,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${askpassFile}`].filter(Boolean).join(" "),
      };
      args = [
        ...hardenedSshOptions({ password: true }),
        "-p", String(connection.port || 22),
        `${connection.user}@${connection.host}`,
        "bash", "-lc", remoteScript,
      ];
    } else {
      await writeFile(keyFile, connection.privateKey, { mode: 0o600 });
      args = [
        "-i", keyFile,
        ...hardenedSshOptions({ password: false }),
        "-p", String(connection.port || 22),
        `${connection.user}@${connection.host}`,
        "bash", "-lc", remoteScript,
      ];
    }

    return await new Promise((resolve) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"], shell: false, detached: true, env });
      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
      if (stdinBuffer) child.stdin.end(stdinBuffer); else child.stdin.end();
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killProcessTree(child, "SIGTERM");
        setTimeout(() => killProcessTree(child, "SIGKILL"), SSH_PROCESS_KILL_GRACE_MS).unref?.();
        resolve({ ok: false, exit_code: 124, timed_out: true, stdout: sanitizeOutput(stdout), stderr: sanitizeOutput(stderr) });
      }, timeoutMs + SSH_PROCESS_KILL_GRACE_MS + 1000);
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: Number(code) === 0, exit_code: Number(code), timed_out: Number(code) === 124, stdout: sanitizeOutput(stdout), stderr: sanitizeOutput(stderr) });
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, exit_code: 127, timed_out: false, stdout: "", stderr: sanitizeOutput(err.message) });
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

function parseKeyValueOutput(stdout = "") {
  const out = {};
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function buildPreflightScript(wordpressPath) {
  const wp = shellQuote(wordpressPath);
  return [
    "set -euo pipefail",
    `cd ${wp}`,
    "command -v wp >/dev/null",
    "test -d wp-content/plugins",
    "env_type=$(wp eval 'echo wp_get_environment_type();' 2>/dev/null | tail -n 1)",
    "home_url=$(wp option get home 2>/dev/null | tail -n 1 | sed 's:/*$::')",
    "site_url=$(wp option get siteurl 2>/dev/null | tail -n 1 | sed 's:/*$::')",
    "mcp_version=$(wp plugin get mcp-adapter --field=version 2>/dev/null | tail -n 1)",
    "wp plugin is-active mcp-adapter >/dev/null 2>&1",
    "control_version=$(wp plugin get mad4b-site-control-plane --field=version 2>/dev/null | tail -n 1 || true)",
    "site_uuid=$(wp eval 'echo class_exists(\"MAD4B_SCP_Site_Profile\") ? MAD4B_SCP_Site_Profile::site_uuid() : \"\";' 2>/dev/null | tail -n 1)",
    "profile_origin=$(wp eval '$p=class_exists(\"MAD4B_SCP_Site_Profile\") ? MAD4B_SCP_Site_Profile::profile() : array(); echo isset($p[\"canonical_origin\"]) ? $p[\"canonical_origin\"] : \"\";' 2>/dev/null | tail -n 1 | sed 's:/*$::')",
    "profile_environment=$(wp eval '$p=class_exists(\"MAD4B_SCP_Site_Profile\") ? MAD4B_SCP_Site_Profile::profile() : array(); echo isset($p[\"environment\"]) ? $p[\"environment\"] : \"\";' 2>/dev/null | tail -n 1)",
    "profile_revision=$(wp eval 'echo class_exists(\"MAD4B_SCP_Site_Profile\") ? MAD4B_SCP_Site_Profile::revision() : 0;' 2>/dev/null | tail -n 1)",
    "profile_digest=$(wp eval 'echo class_exists(\"MAD4B_SCP_Site_Profile\") ? MAD4B_SCP_Site_Profile::profile_digest() : \"\";' 2>/dev/null | tail -n 1)",
    "plugins_device=$(stat -c '%d' wp-content/plugins)",
    "echo \"environment=$env_type\"",
    "echo \"home_url=$home_url\"",
    "echo \"site_url=$site_url\"",
    "echo \"mcp_adapter_version=$mcp_version\"",
    "echo \"control_plane_version=$control_version\"",
    "echo \"site_uuid=$site_uuid\"",
    "echo \"profile_origin=$profile_origin\"",
    "echo \"profile_environment=$profile_environment\"",
    "echo \"profile_revision=$profile_revision\"",
    "echo \"profile_digest=$profile_digest\"",
    "echo \"plugins_device=$plugins_device\"",
    "echo \"preflight_result=ok\"",
  ].join(" && ");
}

function assertLivePreflight(result) {
  if (!result.ok) throw deployError("wordpress_staging_deploy_preflight_ssh_failed", "Read-only WordPress Staging SSH preflight failed.", 502, { exit_code: result.exit_code, stderr: result.stderr });
  const parsed = parseKeyValueOutput(result.stdout);
  const home = normalizeOrigin(parsed.home_url);
  const site = normalizeOrigin(parsed.site_url);
  if (
    parsed.preflight_result !== "ok"
    || String(parsed.environment || "").toLowerCase() !== "staging"
    || home !== WORDPRESS_STAGING_ORIGIN
    || site !== WORDPRESS_STAGING_ORIGIN
    || parsed.mcp_adapter_version !== WORDPRESS_STAGING_MCP_ADAPTER_VERSION
    || String(parsed.site_uuid || "").toLowerCase() !== WORDPRESS_STAGING_SITE_UUID
    || normalizeOrigin(parsed.profile_origin) !== WORDPRESS_STAGING_ORIGIN
    || String(parsed.profile_environment || "").toLowerCase() !== "staging"
  ) {
    throw deployError("wordpress_staging_deploy_live_identity_mismatch", "Live WordPress preflight does not prove the exact governed Staging target.", 409, {
      environment: parsed.environment || null,
      home_url: home || null,
      site_url: site || null,
      mcp_adapter_version: parsed.mcp_adapter_version || null,
      site_uuid: parsed.site_uuid || null,
      profile_origin: normalizeOrigin(parsed.profile_origin) || null,
      profile_environment: parsed.profile_environment || null,
      expected_origin: WORDPRESS_STAGING_ORIGIN,
      expected_site_uuid: WORDPRESS_STAGING_SITE_UUID,
    });
  }
  return parsed;
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mad4b-wordpress-staging-deployer",
  };
}

async function githubJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: githubHeaders(token) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw deployError("wordpress_staging_deploy_github_read_failed", `GitHub read failed with status ${response.status}.`, 502, { upstream_status: response.status, message: body?.message || "" });
  return body;
}

function assertSafeZipEntries(zipPath) {
  const listed = spawnSync("unzip", ["-Z1", zipPath], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (listed.error || listed.status !== 0) throw deployError("wordpress_staging_deploy_unzip_unavailable", "The Host Connector must have a working unzip binary before artifact deployment.", 500);
  for (const raw of String(listed.stdout || "").split(/\r?\n/).filter(Boolean)) {
    const entry = raw.replace(/\\/g, "/");
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw deployError("wordpress_staging_deploy_artifact_path_unsafe", "The GitHub artifact contains an unsafe ZIP path.", 409, { entry: raw.slice(0, 240) });
    }
  }
}

function unzipTo(zipPath, destination) {
  assertSafeZipEntries(zipPath);
  const result = spawnSync("unzip", ["-q", zipPath, "-d", destination], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw deployError("wordpress_staging_deploy_artifact_extract_failed", "The reviewed GitHub artifact could not be extracted.", 502, { stderr: sanitizeOutput(result.stderr) });
}

function readZipEntry(zipPath, entry) {
  assertSafeZipEntries(zipPath);
  const result = spawnSync("unzip", ["-p", zipPath, entry], { maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw deployError("wordpress_staging_deploy_artifact_entry_missing", `Required artifact entry ${entry} is missing.`, 409);
  return Buffer.from(result.stdout || []);
}

function validateHandoff(handoff) {
  if (handoff?.contract !== WORDPRESS_STAGING_HANDOFF_CONTRACT) throw deployError("wordpress_staging_deploy_handoff_contract_mismatch", "Deployment handoff contract mismatch.");
  if (handoff?.producer?.repository !== WORDPRESS_STAGING_SOURCE_REPOSITORY || handoff?.producer?.source_binding !== "exact_head_sha") throw deployError("wordpress_staging_deploy_handoff_source_mismatch", "Deployment handoff source binding is invalid.");
  if (handoff?.producer?.workflow !== ".github/workflows/mad4b-control-plane-package.yml" || handoff?.producer?.artifact_name_template !== "mad4b-site-control-plane-general-distribution-kit-{exact_head_sha}" || handoff?.producer?.install_manifest !== "install-manifest.json") throw deployError("wordpress_staging_deploy_handoff_producer_mismatch", "Deployment handoff producer metadata is invalid.");
  if (handoff?.target?.binding !== "explicit_site_profile" || handoff?.target?.environment_source !== "site_profile.environment" || handoff?.target?.origin_source !== "site_profile.canonical_origin" || handoff?.target?.site_uuid_source !== "site_profile.site_uuid") throw deployError("wordpress_staging_deploy_handoff_target_binding_mismatch", "Deployment handoff is not bound to the explicit Site Profile.");
  if (handoff?.target?.plugin_slug !== WORDPRESS_STAGING_PLUGIN_SLUG || handoff?.target?.mcp_adapter?.required_version !== WORDPRESS_STAGING_MCP_ADAPTER_VERSION || handoff?.target?.mcp_adapter?.deployment_mode !== "require_exact_preinstalled_or_verified_bundled") throw deployError("wordpress_staging_deploy_handoff_runtime_mismatch", "Deployment handoff plugin/runtime binding is invalid.");
  if (
    handoff?.executor?.authority !== "deployment_connector_selected_by_site_owner"
    || handoff?.executor?.operation !== WORDPRESS_STAGING_DEPLOY_OPERATION
    || handoff?.executor?.dry_run_default !== true
    || handoff?.executor?.human_approval_required_for_apply !== true
    || handoff?.executor?.exact_capability_envelope_required !== true
    || handoff?.executor?.exact_target_allowlist_required !== true
    || handoff?.executor?.caller_supplied_credentials_allowed !== false
  ) throw deployError("wordpress_staging_deploy_handoff_executor_mismatch", "Deployment handoff executor binding is invalid.");
  for (const key of REQUIRED_HANDOFF_FORBIDDEN) if (handoff?.forbidden?.[key] !== true) throw deployError("wordpress_staging_deploy_handoff_fail_closed_missing", `Required fail-closed handoff boundary is missing: ${key}.`);
  if (
    handoff?.apply?.backup_before_replace !== true
    || handoff?.apply?.atomic_replace_required !== true
    || handoff?.apply?.activate_after_replace !== true
    || handoff?.apply?.same_cycle_readback_required !== true
    || handoff?.apply?.rollback_on_failed_readback !== true
    || handoff?.apply?.rollback_restores_previous_plugin_files !== true
    || handoff?.apply?.production_requires_separate_explicit_authority !== true
  ) throw deployError("wordpress_staging_deploy_handoff_swap_contract_mismatch", "Deployment handoff does not require backup/atomic replace/readback/rollback.");
  if (handoff?.secrets_included !== false) throw deployError("wordpress_staging_deploy_handoff_secret_boundary_failed", "Deployment handoff must contain no secrets.");
}

async function resolveReviewedArtifact(expectedHeadSha, { fetchImpl = fetch, tokenProvider = getGitHubAppInstallationToken } = {}) {
  const [owner, repo] = WORDPRESS_STAGING_SOURCE_REPOSITORY.split("/");
  const token = await tokenProvider({ repository: { owner, repo } });
  const workflow = encodeURIComponent(WORDPRESS_STAGING_SOURCE_WORKFLOW);
  const runs = await githubJson(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/runs?head_sha=${expectedHeadSha}&status=success&event=pull_request&per_page=20`, token, fetchImpl);
  const run = (runs.workflow_runs || []).find((item) => String(item.head_sha || "").toLowerCase() === expectedHeadSha && item.conclusion === "success");
  if (!run) throw deployError("wordpress_staging_deploy_reviewed_run_missing", "No successful reviewed Control Plane package run exists for the exact WordPress HEAD.", 409, { expected_head_sha: expectedHeadSha });
  const artifacts = await githubJson(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/artifacts?per_page=100`, token, fetchImpl);
  const expectedName = `mad4b-site-control-plane-general-distribution-kit-${expectedHeadSha}`;
  const artifact = (artifacts.artifacts || []).find((item) => item.name === expectedName && item.expired !== true);
  if (!artifact) throw deployError("wordpress_staging_deploy_artifact_missing", "The exact-head reviewed General Distribution artifact is missing or expired.", 409, { workflow_run_id: run.id, artifact_name: expectedName });
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`, { headers: githubHeaders(token), redirect: "follow" });
  if (!response.ok) throw deployError("wordpress_staging_deploy_artifact_download_failed", `Artifact download failed with status ${response.status}.`, 502, { upstream_status: response.status });
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_ARTIFACT_BYTES) throw deployError("wordpress_staging_deploy_artifact_too_large", "The reviewed artifact exceeds the bounded deployment size.", 409, { content_length: length, max_bytes: MAX_ARTIFACT_BYTES });
  const bytes = Buffer.from(await response.arrayBuffer());
  const artifactSha256 = sha256(bytes);
  const advertisedDigest = compact(artifact.digest || "", 128).toLowerCase();
  if (advertisedDigest && advertisedDigest !== `sha256:${artifactSha256}`) throw deployError("wordpress_staging_deploy_outer_artifact_hash_mismatch", "GitHub artifact digest does not match downloaded artifact bytes.", 409, { artifact_id: artifact.id });
  if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw deployError("wordpress_staging_deploy_artifact_size_invalid", "The reviewed artifact size is outside the bounded deployment contract.", 409, { bytes: bytes.length, max_bytes: MAX_ARTIFACT_BYTES });

  const tempDir = await mkdtemp(join(tmpdir(), "mad4b-wp-staging-artifact-"));
  try {
    const outerZip = join(tempDir, "artifact.zip");
    await writeFile(outerZip, bytes, { mode: 0o600 });
    unzipTo(outerZip, tempDir);
    const manifest = JSON.parse(await readFile(join(tempDir, "install-manifest.json"), "utf8"));
    if (manifest.contract !== "mad4b.site-control-plane.general-distribution-kit.v1" || manifest.repository !== WORDPRESS_STAGING_SOURCE_REPOSITORY || String(manifest.commit || "").toLowerCase() !== expectedHeadSha || manifest.release_class !== "general-distribution-release-candidate" || manifest.tenant_binding_required !== true || manifest.tenant_binding_source !== "explicit_site_profile_enrollment") {
      throw deployError("wordpress_staging_deploy_manifest_identity_mismatch", "Reviewed artifact manifest does not match the exact WordPress General Distribution identity.");
    }
    if (!/^[a-f0-9]{64}$/.test(String(manifest.build_fingerprint || "").toLowerCase()) || !/^[a-f0-9]{64}$/.test(String(manifest.package_manifest_digest || "").toLowerCase())) throw deployError("wordpress_staging_deploy_manifest_provenance_invalid", "Reviewed artifact manifest is missing exact build provenance.");
    if (manifest?.mcp_adapter?.version !== WORDPRESS_STAGING_MCP_ADAPTER_VERSION || String(manifest?.mcp_adapter?.sha256 || "").toLowerCase() !== "1c3cd47c32e99b4e7d8690a44a7890256e92a8b96f61776cbe1894e5483cf676" || String(manifest?.mcp_adapter?.official_release_sha256 || "").toLowerCase() !== "1c3cd47c32e99b4e7d8690a44a7890256e92a8b96f61776cbe1894e5483cf676") throw deployError("wordpress_staging_deploy_manifest_mcp_version_mismatch", "Reviewed artifact requires a different or unverified MCP Adapter.");
    if (!Array.isArray(manifest.install_order) || manifest.install_order.length !== 2 || manifest.install_order[0] !== "mcp-adapter-0.6.1.zip" || manifest.install_order[1] !== manifest?.control_plane?.archive) throw deployError("wordpress_staging_deploy_install_order_mismatch", "Reviewed artifact install order is invalid.");
    const archiveName = compact(manifest?.control_plane?.archive, 255);
    if (!/^mad4b-site-control-plane-[A-Za-z0-9._-]+\.zip$/.test(archiveName)) throw deployError("wordpress_staging_deploy_control_archive_name_invalid", "Control Plane archive name is invalid.");
    const pluginArchivePath = join(tempDir, archiveName);
    const adapterArchive = await readFile(join(tempDir, "mcp-adapter-0.6.1.zip"));
    if (sha256(adapterArchive) !== String(manifest?.mcp_adapter?.sha256 || "").toLowerCase()) throw deployError("wordpress_staging_deploy_adapter_archive_hash_mismatch", "Bundled MCP Adapter SHA-256 does not match the reviewed manifest.");
    const provenance = JSON.parse(await readFile(join(tempDir, "MAD4B-BUILD-PROVENANCE.json"), "utf8"));
    if (provenance?.contract !== "mad4b.build-provenance.v1" || String(provenance?.source_commit_sha || "").toLowerCase() !== expectedHeadSha || String(provenance?.build_fingerprint || "").toLowerCase() !== String(manifest.build_fingerprint || "").toLowerCase() || String(provenance?.package_manifest_digest || "").toLowerCase() !== String(manifest.package_manifest_digest || "").toLowerCase()) throw deployError("wordpress_staging_deploy_build_provenance_mismatch", "Artifact build provenance does not match the exact install manifest.");
    const pluginArchive = await readFile(pluginArchivePath);
    const pluginSha = sha256(pluginArchive);
    if (pluginSha !== String(manifest?.control_plane?.sha256 || "").toLowerCase()) throw deployError("wordpress_staging_deploy_control_archive_hash_mismatch", "Control Plane archive SHA-256 does not match the reviewed manifest.");
    const handoffBytes = readZipEntry(pluginArchivePath, `${WORDPRESS_STAGING_PLUGIN_SLUG}/config/staging-deployment-handoff.json`);
    const handoff = JSON.parse(handoffBytes.toString("utf8"));
    validateHandoff(handoff);
    return {
      workflow_run_id: run.id,
      artifact_id: artifact.id,
      artifact_name: artifact.name,
      artifact_archive_sha256: artifactSha256,
      manifest,
      handoff,
      build_fingerprint: String(manifest.build_fingerprint || "").toLowerCase(),
      package_manifest_digest: String(manifest.package_manifest_digest || "").toLowerCase(),
      plugin_archive: pluginArchive,
      plugin_archive_sha256: pluginSha,
      control_plane_version: compact(manifest?.control_plane?.version, 64),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

function buildUploadScript(wordpressPath, remoteZip) {
  return [
    "set -euo pipefail",
    `cd ${shellQuote(wordpressPath)}`,
    "test -d wp-content/plugins",
    "umask 077",
    `cat > ${shellQuote(remoteZip)}`,
    `test -s ${shellQuote(remoteZip)}`,
    "echo upload_result=ok",
  ].join(" && ");
}

function buildApplyScript({ wordpressPath, remoteZip, expectedSha256, expectedVersion, expectedHeadSha, expectedBuildFingerprint, expectedPackageManifestDigest, expectedProfileRevision, expectedProfileDigest, deploymentId }) {
  const wp = shellQuote(wordpressPath);
  const zip = shellQuote(remoteZip);
  const version = shellQuote(expectedVersion);
  const sha = shellQuote(expectedSha256);
  const sourceSha = shellQuote(expectedHeadSha);
  const buildFingerprint = shellQuote(expectedBuildFingerprint);
  const packageManifestDigest = shellQuote(expectedPackageManifestDigest);
  const profileRevision = shellQuote(String(expectedProfileRevision || ""));
  const profileDigest = shellQuote(expectedProfileDigest || "");
  const safeId = deploymentId.replace(/[^A-Za-z0-9-]/g, "");
  return `set -euo pipefail
cd ${wp}
plugin_parent="$(pwd)/wp-content/plugins"
target="$plugin_parent/${WORDPRESS_STAGING_PLUGIN_SLUG}"
stage="$plugin_parent/.mad4b-stage-${safeId}"
backup="$plugin_parent/.mad4b-backup-${safeId}"
upload=${zip}
old_active=0
maintenance_on=0
rollback() {
  code="$1"
  set +e
  if [ "$maintenance_on" = "1" ]; then :; else wp maintenance-mode activate >/dev/null 2>&1; maintenance_on=1; fi
  if [ -d "$backup" ]; then
    if [ -d "$target" ]; then mv "$target" "$target.failed-${safeId}"; fi
    mv "$backup" "$target"
    if [ "$old_active" = "1" ]; then wp plugin activate ${WORDPRESS_STAGING_PLUGIN_SLUG} >/dev/null 2>&1; else wp plugin deactivate ${WORDPRESS_STAGING_PLUGIN_SLUG} >/dev/null 2>&1; fi
  fi
  rm -rf "$stage" "$upload"
  if [ "$maintenance_on" = "1" ]; then wp maintenance-mode deactivate >/dev/null 2>&1; fi
  echo rollback_result=restored
  exit "$code"
}
trap 'rollback $?' ERR

env_type="$(wp eval 'echo wp_get_environment_type();' 2>/dev/null | tail -n 1)"
home_url="$(wp option get home 2>/dev/null | tail -n 1 | sed 's:/*$::')"
site_url="$(wp option get siteurl 2>/dev/null | tail -n 1 | sed 's:/*$::')"
mcp_version="$(wp plugin get mcp-adapter --field=version 2>/dev/null | tail -n 1)"
test "$env_type" = staging
test "$home_url" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$site_url" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$mcp_version" = ${shellQuote(WORDPRESS_STAGING_MCP_ADAPTER_VERSION)}
wp plugin is-active mcp-adapter >/dev/null 2>&1
test -d "$target"
test "$(sha256sum "$upload" | awk '{print $1}')" = ${sha}
rm -rf "$stage" "$backup"
mkdir "$stage"
unzip -q "$upload" -d "$stage"
test -d "$stage/${WORDPRESS_STAGING_PLUGIN_SLUG}"
new_version="$(sed -nE 's/^ \\* Version: ([^ ]+).*/\\1/p' "$stage/${WORDPRESS_STAGING_PLUGIN_SLUG}/${WORDPRESS_STAGING_PLUGIN_SLUG}.php" | head -n 1)"
test "$new_version" = ${version}
new_build="$(sed -n 's/^release=//p' "$stage/${WORDPRESS_STAGING_PLUGIN_SLUG}/MAD4B-RUNTIME-BUILD.txt" | head -n 1)"
test "$new_build" = ${version}
plugins_device="$(stat -c '%d' "$plugin_parent")"
stage_device="$(stat -c '%d' "$stage")"
test "$plugins_device" = "$stage_device"
if wp plugin is-active ${WORDPRESS_STAGING_PLUGIN_SLUG} >/dev/null 2>&1; then old_active=1; fi
previous_version="$(wp plugin get ${WORDPRESS_STAGING_PLUGIN_SLUG} --field=version 2>/dev/null | tail -n 1)"
wp maintenance-mode activate >/dev/null
maintenance_on=1
mv "$target" "$backup"
mv "$stage/${WORDPRESS_STAGING_PLUGIN_SLUG}" "$target"
wp plugin activate ${WORDPRESS_STAGING_PLUGIN_SLUG} >/dev/null
actual_version="$(wp plugin get ${WORDPRESS_STAGING_PLUGIN_SLUG} --field=version 2>/dev/null | tail -n 1)"
runtime_version="$(wp eval 'echo defined("MAD4B_SCP_VERSION") ? MAD4B_SCP_VERSION : "";' 2>/dev/null | tail -n 1)"
env_after="$(wp eval 'echo wp_get_environment_type();' 2>/dev/null | tail -n 1)"
home_after="$(wp option get home 2>/dev/null | tail -n 1 | sed 's:/*$::')"
site_after="$(wp option get siteurl 2>/dev/null | tail -n 1 | sed 's:/*$::')"
mcp_after="$(wp plugin get mcp-adapter --field=version 2>/dev/null | tail -n 1)"
test "$actual_version" = ${version}
test "$runtime_version" = ${version}
test "$env_after" = staging
test "$home_after" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$site_after" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$mcp_after" = ${shellQuote(WORDPRESS_STAGING_MCP_ADAPTER_VERSION)}
site_uuid_after="$(wp eval 'echo class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::site_uuid() : "";' 2>/dev/null | tail -n 1)"
profile_origin_after="$(wp eval '$p=class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::profile() : array(); echo isset($p["canonical_origin"]) ? $p["canonical_origin"] : "";' 2>/dev/null | tail -n 1 | sed 's:/*$::')"
profile_environment_after="$(wp eval '$p=class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::profile() : array(); echo isset($p["environment"]) ? $p["environment"] : "";' 2>/dev/null | tail -n 1)"
profile_revision_after="$(wp eval 'echo class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::revision() : 0;' 2>/dev/null | tail -n 1)"
profile_digest_after="$(wp eval 'echo class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::profile_digest() : "";' 2>/dev/null | tail -n 1)"
source_sha_after="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo isset($p["source_commit_sha"]) ? $p["source_commit_sha"] : "";' 2>/dev/null | tail -n 1)"
build_fingerprint_after="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo isset($p["build_fingerprint"]) ? $p["build_fingerprint"] : "";' 2>/dev/null | tail -n 1)"
package_manifest_digest_after="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo isset($p["package_manifest_digest"]) ? $p["package_manifest_digest"] : "";' 2>/dev/null | tail -n 1)"
runtime_manifest_match="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo !empty($p["runtime_manifest_match"]) ? "1" : "0";' 2>/dev/null | tail -n 1)"
stale_after="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo !empty($p["stale"]) ? "1" : "0";' 2>/dev/null | tail -n 1)"
provenance_mismatch_count="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo isset($p["provenance_mismatch"]) && is_array($p["provenance_mismatch"]) ? count($p["provenance_mismatch"]) : -1;' 2>/dev/null | tail -n 1)"
test "$site_uuid_after" = ${shellQuote(WORDPRESS_STAGING_SITE_UUID)}
test "$profile_origin_after" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$profile_environment_after" = staging
test "$profile_revision_after" = ${profileRevision}
test "$profile_digest_after" = ${profileDigest}
test "$source_sha_after" = ${sourceSha}
test "$build_fingerprint_after" = ${buildFingerprint}
test "$package_manifest_digest_after" = ${packageManifestDigest}
test "$runtime_manifest_match" = 1
test "$stale_after" = 0
test "$provenance_mismatch_count" = 0
wp maintenance-mode deactivate >/dev/null
maintenance_on=0
rm -rf "$stage" "$upload"
trap - ERR
echo previous_version="$previous_version"
echo deployed_version="$actual_version"
echo runtime_version="$runtime_version"
echo environment="$env_after"
echo home_url="$home_after"
echo site_url="$site_after"
echo mcp_adapter_version="$mcp_after"
echo site_uuid="$site_uuid_after"
echo profile_origin="$profile_origin_after"
echo profile_environment="$profile_environment_after"
echo profile_revision="$profile_revision_after"
echo profile_digest="$profile_digest_after"
echo source_commit_sha="$source_sha_after"
echo build_fingerprint="$build_fingerprint_after"
echo package_manifest_digest="$package_manifest_digest_after"
echo runtime_manifest_match="$runtime_manifest_match"
echo stale="$stale_after"
echo provenance_mismatch_count="$provenance_mismatch_count"
echo backup_path="$backup"
echo deploy_result=ok`;
}

async function writeEvidence(pool, traceId, kind, status, output) {
  await writeExecutionEvidence({
    pool,
    traceId,
    entryType: kind,
    executionClass: "wordpress_staging_plugin_deployment",
    sourceLayer: "wordpressStagingPluginDeployExecutor",
    userInput: "governed WordPress Staging plugin deploy",
    routeKeys: "wordpress_staging_plugin_deploy",
    selectedWorkflows: WORDPRESS_STAGING_SOURCE_WORKFLOW,
    executionMode: output.dry_run ? "dry_run_only" : "approval_gated_execute",
    decisionTrigger: "admin_tool",
    executionStatus: status,
    outputSummary: { ...output, secrets_included: false },
    routeStatus: status === "success" ? (output.dry_run ? "dry_run_only" : "executed") : "failed",
    routeSource: "sql_primary",
    intakeValidationStatus: "validated",
    executionReadyStatus: status === "success" ? "complete" : "failed",
    failureReason: status === "success" ? null : output.failure_reason || "wordpress_staging_plugin_deploy_failed",
    logSource: "sql_primary",
  }).catch(() => null);
}

export async function executeWordPressStagingPluginDeploy(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const expectedHeadSha = compact(input.expected_head_sha || input.expectedHeadSha || input.expected_commit_sha || input.expectedCommitSha, 64).toLowerCase();
  const dryRun = input.dry_run === undefined ? true : bool(input.dry_run);
  const approvalReason = compact(input.approval_reason || input.approvalReason, 1000);
  const timeoutMs = boundedInt(input.timeout_ms || input.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_TIMEOUT_MS);
  const traceId = `wordpress_staging_deploy_${randomUUID()}`;

  if (!/^[0-9a-f]{40}$/.test(expectedHeadSha)) throw deployError("wordpress_staging_deploy_exact_head_required", "expected_head_sha must be the exact 40-character WordPress PR HEAD SHA.", 400);
  if (!dryRun && approvalReason.length < 20) throw deployError("wordpress_staging_deploy_approval_reason_required", "approval_reason with at least 20 characters is required for apply.", 403);

  const target = await resolveUniqueStagingTarget(pool);
  const targetId = target.target_id;
  const targetIdentity = assertStagingTarget(target);
  const artifact = await resolveReviewedArtifact(expectedHeadSha, deps);
  const connection = await resolveSshConnection(pool, target, compact(target?.metadata?.ssh_auth_mode || "", 32));
  const preflightResult = await runSshCommand(connection, buildPreflightScript(targetIdentity.wordpressPath), { timeoutMs });
  const preflight = assertLivePreflight(preflightResult);

  const base = {
    ok: true,
    contract: WORDPRESS_STAGING_DEPLOY_CONTRACT,
    deployment_run_id: traceId,
    target_id: targetId,
    environment: "staging",
    origin: WORDPRESS_STAGING_ORIGIN,
    expected_head_sha: expectedHeadSha,
    workflow_run_id: artifact.workflow_run_id,
    artifact_id: artifact.artifact_id,
    artifact_name: artifact.artifact_name,
    control_plane_version: artifact.control_plane_version,
    artifact_archive_sha256: artifact.artifact_archive_sha256,
    control_plane_sha256: artifact.plugin_archive_sha256,
    build_fingerprint: artifact.build_fingerprint,
    package_manifest_digest: artifact.package_manifest_digest,
    mcp_adapter_version: WORDPRESS_STAGING_MCP_ADAPTER_VERSION,
    preflight: {
      ready: true,
      environment: preflight.environment,
      home_url: normalizeOrigin(preflight.home_url),
      site_url: normalizeOrigin(preflight.site_url),
      current_control_plane_version: preflight.control_plane_version || null,
      mcp_adapter_version: preflight.mcp_adapter_version,
      site_uuid: preflight.site_uuid,
      profile_origin: normalizeOrigin(preflight.profile_origin),
      profile_environment: preflight.profile_environment,
      profile_revision: preflight.profile_revision,
      profile_digest: preflight.profile_digest,
      mutation_performed: false,
    },
    dry_run: dryRun,
    production_authority_used: false,
    breakglass_used: false,
    caller_supplied_credentials_used: false,
    secrets_included: false,
  };

  if (dryRun) {
    await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy_dry_run", "success", base);
    return { ...base, deployment_status: "planned", execution: { will_execute: false, executed: false, reason: "dry_run_only" } };
  }

  const envelope = await resolveCapabilityExecutionEnvelope({
    pool,
    source: input,
    acceptedAppKeys: ["remote_ssh_runtime", "hostinger", "wordpress"],
    acceptedIntents: [WORDPRESS_STAGING_DEPLOY_OPERATION, "deploy", "write"],
    acceptedCapabilityKeys: [WORDPRESS_STAGING_DEPLOY_OPERATION],
    expectedTenantId: target.tenant_id,
    expectedUserId: target.user_id || input.user_id || input.userId || "",
    expectedCommitSha: expectedHeadSha,
    requireCommitHint: true,
    allowReferenced: false,
  });
  if (!envelope.ok) throw capabilityEnvelopeError(envelope, "Exact approved capability envelope does not authorize this WordPress Staging deployment.");
  await markCapabilityEnvelopeReferenced({ envelopeId: envelope.envelope_id, executionRef: traceId });

  const deploymentId = randomUUID();
  const remoteZip = `${targetIdentity.wordpressPath}/wp-content/plugins/.mad4b-staging-${deploymentId}.zip`;
  const upload = await runSshCommand(connection, buildUploadScript(targetIdentity.wordpressPath, remoteZip), { timeoutMs, stdinBuffer: artifact.plugin_archive });
  if (!upload.ok || parseKeyValueOutput(upload.stdout).upload_result !== "ok") {
    const failure = { ...base, dry_run: false, failure_reason: "artifact_upload_failed", upload_exit_code: upload.exit_code };
    await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy", "failed", failure);
    throw deployError("wordpress_staging_deploy_upload_failed", "The verified Control Plane archive could not be uploaded through the governed SSH transport.", 502, { exit_code: upload.exit_code, stderr: upload.stderr });
  }

  const apply = await runSshCommand(connection, buildApplyScript({
    wordpressPath: targetIdentity.wordpressPath,
    remoteZip,
    expectedSha256: artifact.plugin_archive_sha256,
    expectedVersion: artifact.control_plane_version,
    expectedHeadSha,
    expectedBuildFingerprint: artifact.build_fingerprint,
    expectedPackageManifestDigest: artifact.package_manifest_digest,
    expectedProfileRevision: preflight.profile_revision,
    expectedProfileDigest: preflight.profile_digest,
    deploymentId,
  }), { timeoutMs });
  const applied = parseKeyValueOutput(apply.stdout);
  const deployOk = apply.ok
    && applied.deploy_result === "ok"
    && applied.deployed_version === artifact.control_plane_version
    && applied.runtime_version === artifact.control_plane_version
    && String(applied.environment || "").toLowerCase() === "staging"
    && normalizeOrigin(applied.home_url) === WORDPRESS_STAGING_ORIGIN
    && normalizeOrigin(applied.site_url) === WORDPRESS_STAGING_ORIGIN
    && applied.mcp_adapter_version === WORDPRESS_STAGING_MCP_ADAPTER_VERSION
    && String(applied.site_uuid || "").toLowerCase() === WORDPRESS_STAGING_SITE_UUID
    && normalizeOrigin(applied.profile_origin) === WORDPRESS_STAGING_ORIGIN
    && String(applied.profile_environment || "").toLowerCase() === "staging"
    && String(applied.profile_revision || "") === String(preflight.profile_revision || "")
    && String(applied.profile_digest || "") === String(preflight.profile_digest || "")
    && String(applied.source_commit_sha || "").toLowerCase() === expectedHeadSha
    && String(applied.build_fingerprint || "").toLowerCase() === artifact.build_fingerprint
    && String(applied.package_manifest_digest || "").toLowerCase() === artifact.package_manifest_digest
    && String(applied.runtime_manifest_match || "") === "1"
    && String(applied.stale || "") === "0"
    && String(applied.provenance_mismatch_count || "") === "0";

  if (!deployOk) {
    const failure = { ...base, dry_run: false, failure_reason: "same_cycle_readback_failed", apply_exit_code: apply.exit_code, rollback_result: applied.rollback_result || null };
    await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy", "failed", failure);
    throw deployError("wordpress_staging_deploy_readback_failed", "WordPress Staging deployment or same-cycle readback failed; the remote script attempted rollback before returning.", 502, { exit_code: apply.exit_code, rollback_result: applied.rollback_result || null, stderr: apply.stderr });
  }

  const consumed = await transitionCapabilityEnvelopeLifecycle({ envelopeId: envelope.envelope_id, action: "consume", executionRef: traceId, reason: "wordpress_staging_plugin_deploy_completed" });
  if (!consumed.ok) throw deployError("wordpress_staging_deploy_envelope_consume_failed", "Deployment completed but capability-envelope consumption could not be recorded; further automatic deployment is denied pending reconciliation.", 500, { envelope_id: envelope.envelope_id });

  const result = {
    ...base,
    dry_run: false,
    deployment_status: "completed",
    previous_control_plane_version: applied.previous_version || null,
    deployed_control_plane_version: applied.deployed_version,
    runtime_control_plane_version: applied.runtime_version,
    runtime_source_commit_sha: applied.source_commit_sha,
    runtime_build_fingerprint: applied.build_fingerprint,
    runtime_package_manifest_digest: applied.package_manifest_digest,
    runtime_manifest_match: applied.runtime_manifest_match === "1",
    stale: applied.stale !== "0",
    provenance_mismatch_count: Number(applied.provenance_mismatch_count || 0),
    site_profile: {
      site_uuid: applied.site_uuid,
      canonical_origin: normalizeOrigin(applied.profile_origin),
      environment: applied.profile_environment,
      revision: Number(applied.profile_revision || 0),
      profile_digest: applied.profile_digest,
      preserved: String(applied.profile_revision || "") === String(preflight.profile_revision || "") && String(applied.profile_digest || "") === String(preflight.profile_digest || ""),
    },
    rollback_backup_path: applied.backup_path || null,
    capability_envelope_id: envelope.envelope_id,
    capability_envelope_consumed: true,
    execution: {
      will_execute: true,
      executed: true,
      ssh_used: true,
      raw_shell_exposed: false,
      caller_selected_path: false,
      caller_supplied_credentials_used: false,
      same_filesystem_rename_replace: true,
      maintenance_mode_during_swap: true,
      same_cycle_readback: true,
      rollback_on_failed_readback: true,
    },
    remaining_live_acceptance: artifact.handoff?.post_deploy?.required_live_acceptance || [],
    secrets_included: false,
  };
  await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy", "success", result);
  return result;
}
