import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getPool } from "./db.js";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";
import {
  resolveServerOwnedHostingerSshConnection,
  runHostingerSshCommand,
} from "./hostingerSshDeployExecutor.js";
import {
  capabilityEnvelopeError,
  extractCapabilityEnvelopeId,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
  transitionCapabilityEnvelopeLifecycle,
} from "./capabilityResolutionEnvelopeGuard.js";

export const WORDPRESS_STAGING_DEPLOY_CONTRACT = "mad4b.wordpress-staging-plugin-deploy.v2";
export const WORDPRESS_STAGING_DEPLOY_OPERATION = "wordpress_staging_plugin_deploy";
export const WORDPRESS_STAGING_HANDOFF_CONTRACT = "mad4b.wordpress-deployment-handoff.v2";
export const WORDPRESS_STAGING_SOURCE_REPOSITORY = "mad4bdigital-ai/WordPress";
export const WORDPRESS_STAGING_SOURCE_WORKFLOW = "mad4b-control-plane-package.yml";
export const WORDPRESS_STAGING_ORIGIN = "https://staging.egypttourgates.com";
export const WORDPRESS_STAGING_SITE_UUID = "d745d81f-6fc4-5c6a-99dd-d953c92137bf";
export const WORDPRESS_STAGING_PLUGIN_SLUG = "mad4b-site-control-plane";
export const WORDPRESS_STAGING_MCP_ADAPTER_SLUG = "mcp-adapter";
export const WORDPRESS_STAGING_MCP_ADAPTER_VERSION = "0.6.1";
export const WORDPRESS_GENERAL_KIT_CONTRACT = "mad4b.site-control-plane.general-distribution-kit.v1";

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
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

function publicTarget(row) {
  if (!row) return null;
  return {
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
  };
}

async function resolveStagingTarget(pool) {
  const rows = await safeQuery(
    pool,
    "SELECT * FROM remote_runtime_targets WHERE plugin_key = 'remote_ssh_runtime' AND target_kind = 'hosting_account' AND provider_family = 'hostinger' AND status = 'active' AND validation_status IN ('valid','validated') ORDER BY updated_at DESC LIMIT 32",
  );
  const matches = rows.map(publicTarget).filter(Boolean).filter((target) => {
    const metadata = target.metadata && typeof target.metadata === "object" ? target.metadata : {};
    const environment = compact(metadata.environment || metadata.environment_type || metadata.environment_key, 64).toLowerCase();
    const origin = normalizeOrigin(metadata.origin || metadata.site_url || metadata.home_url || metadata.wordpress_origin);
    return environment === "staging"
      && origin === WORDPRESS_STAGING_ORIGIN
      && Array.isArray(target.command_allowlist)
      && target.command_allowlist.includes(WORDPRESS_STAGING_DEPLOY_OPERATION);
  });
  if (matches.length === 0) {
    throw deployError("wordpress_staging_deploy_target_not_found", "No active+validated Hostinger target is registered for the exact ETG Staging origin and WordPress deploy command.", 409, { expected_environment: "staging", expected_origin: WORDPRESS_STAGING_ORIGIN, caller_target_selection_allowed: false });
  }
  if (matches.length !== 1) {
    throw deployError("wordpress_staging_deploy_target_ambiguous", "More than one Hostinger target matches the exact ETG Staging deployment authority; target selection remains fail-closed.", 409, { match_count: matches.length, caller_target_selection_allowed: false });
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
  if (environment !== "staging" || origin !== WORDPRESS_STAGING_ORIGIN) {
    throw deployError("wordpress_staging_deploy_target_identity_mismatch", "Target metadata does not prove the exact Egypt Tour Gates Staging environment and origin.", 409, {
      environment: environment || null,
      origin: origin || null,
      expected_environment: "staging",
      expected_origin: WORDPRESS_STAGING_ORIGIN,
    });
  }
  const wordpressPath = assertSafeWordPressPath(target.root_path || "");
  if (!pathAllowedByTarget(wordpressPath, target)) {
    throw deployError("wordpress_staging_deploy_path_not_allowlisted", "The server-owned WordPress root is outside the target path allowlist.");
  }
  return { wordpressPath, environment, origin };
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
    "profile_environment=$(wp eval 'echo class_exists(\"MAD4B_SCP_Site_Profile\") ? MAD4B_SCP_Site_Profile::current_environment() : \"\";' 2>/dev/null | tail -n 1)",
    "profile_origin=$(wp eval 'echo class_exists(\"MAD4B_SCP_Site_Profile\") ? MAD4B_SCP_Site_Profile::current_origin() : \"\";' 2>/dev/null | tail -n 1 | sed 's:/*$::')",
    "profile_configured=$(wp eval 'echo class_exists(\"MAD4B_SCP_Site_Profile\") && MAD4B_SCP_Site_Profile::configured() ? \"1\" : \"0\";' 2>/dev/null | tail -n 1)",
    "plugins_device=$(stat -c '%d' wp-content/plugins)",
    "echo \"environment=$env_type\"",
    "echo \"home_url=$home_url\"",
    "echo \"site_url=$site_url\"",
    "echo \"site_uuid=$site_uuid\"",
    "echo \"profile_environment=$profile_environment\"",
    "echo \"profile_origin=$profile_origin\"",
    "echo \"profile_configured=$profile_configured\"",
    "echo \"mcp_adapter_version=$mcp_version\"",
    "echo \"control_plane_version=$control_version\"",
    "echo \"plugins_device=$plugins_device\"",
    "echo \"preflight_result=ok\"",
  ].join(" && ");
}

function assertLivePreflight(result) {
  if (!result.ok) throw deployError("wordpress_staging_deploy_preflight_ssh_failed", "Read-only WordPress Staging SSH preflight failed.", 502, { exit_code: result.exit_code, stderr: result.stderr });
  const parsed = parseKeyValueOutput(result.stdout);
  const home = normalizeOrigin(parsed.home_url);
  const site = normalizeOrigin(parsed.site_url);
  const profileOrigin = normalizeOrigin(parsed.profile_origin);
  if (
    parsed.preflight_result !== "ok"
    || String(parsed.environment || "").toLowerCase() !== "staging"
    || home !== WORDPRESS_STAGING_ORIGIN
    || site !== WORDPRESS_STAGING_ORIGIN
    || parsed.profile_configured !== "1"
    || String(parsed.profile_environment || "").toLowerCase() !== "staging"
    || profileOrigin !== WORDPRESS_STAGING_ORIGIN
    || String(parsed.site_uuid || "").toLowerCase() !== WORDPRESS_STAGING_SITE_UUID
    || parsed.mcp_adapter_version !== WORDPRESS_STAGING_MCP_ADAPTER_VERSION
  ) {
    throw deployError("wordpress_staging_deploy_live_identity_mismatch", "Live WordPress preflight does not prove the exact enrolled ETG Staging Site Profile.", 409, {
      environment: parsed.environment || null,
      home_url: home || null,
      site_url: site || null,
      site_uuid: parsed.site_uuid || null,
      profile_environment: parsed.profile_environment || null,
      profile_origin: profileOrigin || null,
      profile_configured: parsed.profile_configured === "1",
      mcp_adapter_version: parsed.mcp_adapter_version || null,
      expected_environment: "staging",
      expected_origin: WORDPRESS_STAGING_ORIGIN,
      expected_site_uuid: WORDPRESS_STAGING_SITE_UUID,
      caller_target_selection_allowed: false,
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
  if (handoff?.contract !== WORDPRESS_STAGING_HANDOFF_CONTRACT) throw deployError("wordpress_staging_deploy_handoff_contract_mismatch", "WordPress deployment handoff v2 contract mismatch.");
  if (handoff?.producer?.repository !== WORDPRESS_STAGING_SOURCE_REPOSITORY || handoff?.producer?.source_binding !== "exact_head_sha") throw deployError("wordpress_staging_deploy_handoff_source_mismatch", "Deployment handoff source binding is invalid.");
  if (handoff?.producer?.workflow !== ".github/workflows/mad4b-control-plane-package.yml") throw deployError("wordpress_staging_deploy_handoff_workflow_mismatch", "Deployment handoff workflow binding is invalid.");
  if (handoff?.target?.binding !== "explicit_site_profile" || handoff?.target?.environment_source !== "site_profile.environment" || handoff?.target?.origin_source !== "site_profile.canonical_origin" || handoff?.target?.site_uuid_source !== "site_profile.site_uuid") throw deployError("wordpress_staging_deploy_handoff_target_binding_mismatch", "Deployment handoff does not require exact Site Profile target binding.");
  if (!Array.isArray(handoff?.target?.supported_environments) || !handoff.target.supported_environments.includes("staging")) throw deployError("wordpress_staging_deploy_handoff_environment_mismatch", "Deployment handoff does not permit Staging.");
  if (handoff?.target?.plugin_slug !== WORDPRESS_STAGING_PLUGIN_SLUG || handoff?.target?.mcp_adapter?.required_version !== WORDPRESS_STAGING_MCP_ADAPTER_VERSION) throw deployError("wordpress_staging_deploy_handoff_runtime_mismatch", "Deployment handoff plugin/runtime binding is invalid.");
  if (handoff?.executor?.operation !== "wordpress_plugin_deploy" || handoff?.executor?.dry_run_default !== true || handoff?.executor?.human_approval_required_for_apply !== true || handoff?.executor?.exact_capability_envelope_required !== true || handoff?.executor?.exact_target_allowlist_required !== true || handoff?.executor?.caller_supplied_credentials_allowed !== false) throw deployError("wordpress_staging_deploy_handoff_executor_mismatch", "Deployment handoff executor governance is invalid.");
  for (const key of REQUIRED_HANDOFF_FORBIDDEN) if (handoff?.forbidden?.[key] !== true) throw deployError("wordpress_staging_deploy_handoff_fail_closed_missing", `Required fail-closed handoff boundary is missing: ${key}.`);
  if (handoff?.apply?.backup_before_replace !== true || handoff?.apply?.atomic_replace_required !== true || handoff?.apply?.activate_after_replace !== true || handoff?.apply?.same_cycle_readback_required !== true || handoff?.apply?.rollback_on_failed_readback !== true || handoff?.apply?.rollback_restores_previous_plugin_files !== true || handoff?.apply?.production_requires_separate_explicit_authority !== true) throw deployError("wordpress_staging_deploy_handoff_apply_contract_mismatch", "Deployment handoff does not require the exact backup/atomic/readback/rollback sequence.");
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
  if (!bytes.length || bytes.length > MAX_ARTIFACT_BYTES) throw deployError("wordpress_staging_deploy_artifact_size_invalid", "The reviewed artifact size is outside the bounded deployment contract.", 409, { bytes: bytes.length, max_bytes: MAX_ARTIFACT_BYTES });

  const outerSha = sha256(bytes);
  const declaredArtifactDigest = compact(artifact.digest || "", 128).toLowerCase();
  if (declaredArtifactDigest && declaredArtifactDigest !== `sha256:${outerSha}`) throw deployError("wordpress_staging_deploy_artifact_digest_mismatch", "GitHub artifact digest does not match the downloaded exact artifact.", 409, { artifact_id: artifact.id });

  const tempDir = await mkdtemp(join(tmpdir(), "mad4b-wp-staging-artifact-"));
  try {
    const outerZip = join(tempDir, "artifact.zip");
    await writeFile(outerZip, bytes, { mode: 0o600 });
    unzipTo(outerZip, tempDir);

    const manifest = JSON.parse(await readFile(join(tempDir, "install-manifest.json"), "utf8"));
    if (manifest.contract !== WORDPRESS_GENERAL_KIT_CONTRACT || manifest.repository !== WORDPRESS_STAGING_SOURCE_REPOSITORY || String(manifest.commit || "").toLowerCase() !== expectedHeadSha || manifest.release_class !== "general-distribution-release-candidate" || manifest.tenant_binding_required !== true || manifest.tenant_binding_source !== "explicit_site_profile_enrollment") {
      throw deployError("wordpress_staging_deploy_manifest_identity_mismatch", "General Distribution manifest does not match the exact governed WordPress candidate.");
    }
    if (!/^[a-f0-9]{64}$/.test(String(manifest.build_fingerprint || "")) || !/^[a-f0-9]{64}$/.test(String(manifest.package_manifest_digest || ""))) throw deployError("wordpress_staging_deploy_manifest_provenance_invalid", "General Distribution manifest is missing exact build/package provenance.");
    if (manifest?.mcp_adapter?.version !== WORDPRESS_STAGING_MCP_ADAPTER_VERSION) throw deployError("wordpress_staging_deploy_manifest_mcp_version_mismatch", "Reviewed artifact requires a different MCP Adapter version.");
    if (manifest?.mcp_adapter?.official_release_sha256 !== manifest?.mcp_adapter?.sha256) throw deployError("wordpress_staging_deploy_manifest_mcp_release_mismatch", "Bundled MCP Adapter is not the exact certified release artifact.");

    const controlArchiveName = compact(manifest?.control_plane?.archive, 255);
    const adapterArchiveName = compact(manifest?.mcp_adapter?.archive, 255);
    if (!/^mad4b-site-control-plane-[A-Za-z0-9._-]+\.zip$/.test(controlArchiveName)) throw deployError("wordpress_staging_deploy_control_archive_name_invalid", "Control Plane archive name is invalid.");
    if (adapterArchiveName !== "mcp-adapter-0.6.1.zip") throw deployError("wordpress_staging_deploy_adapter_archive_name_invalid", "MCP Adapter archive name is invalid.");
    if (JSON.stringify(manifest.install_order || []) !== JSON.stringify([adapterArchiveName, controlArchiveName])) throw deployError("wordpress_staging_deploy_install_order_invalid", "General Distribution install order does not require MCP Adapter before Control Plane.");

    const controlArchivePath = join(tempDir, controlArchiveName);
    const adapterArchivePath = join(tempDir, adapterArchiveName);
    const controlArchive = await readFile(controlArchivePath);
    const adapterArchive = await readFile(adapterArchivePath);
    const controlSha = sha256(controlArchive);
    const adapterSha = sha256(adapterArchive);
    if (controlSha !== String(manifest?.control_plane?.sha256 || "").toLowerCase()) throw deployError("wordpress_staging_deploy_control_archive_hash_mismatch", "Control Plane archive SHA-256 does not match the reviewed manifest.");
    if (adapterSha !== String(manifest?.mcp_adapter?.sha256 || "").toLowerCase()) throw deployError("wordpress_staging_deploy_adapter_archive_hash_mismatch", "MCP Adapter archive SHA-256 does not match the reviewed manifest.");

    const provenance = JSON.parse(await readFile(join(tempDir, "MAD4B-BUILD-PROVENANCE.json"), "utf8"));
    if (provenance?.contract !== "mad4b.build-provenance.v1" || String(provenance?.source_commit_sha || "").toLowerCase() !== expectedHeadSha || provenance?.build_fingerprint !== manifest.build_fingerprint || provenance?.package_manifest_digest !== manifest.package_manifest_digest || provenance?.mcp_adapter_sha256 !== adapterSha) {
      throw deployError("wordpress_staging_deploy_build_provenance_mismatch", "Build provenance does not match the exact reviewed General Distribution manifest.");
    }

    const handoffBytes = readZipEntry(controlArchivePath, `${WORDPRESS_STAGING_PLUGIN_SLUG}/config/staging-deployment-handoff.json`);
    const handoff = JSON.parse(handoffBytes.toString("utf8"));
    validateHandoff(handoff);

    return {
      workflow_run_id: run.id,
      artifact_id: artifact.id,
      artifact_name: artifact.name,
      artifact_archive_sha256: outerSha,
      manifest,
      handoff,
      control_archive: controlArchive,
      control_archive_sha256: controlSha,
      adapter_archive: adapterArchive,
      adapter_archive_sha256: adapterSha,
      control_plane_version: compact(manifest?.control_plane?.version, 64),
      build_fingerprint: String(manifest.build_fingerprint),
      package_manifest_digest: String(manifest.package_manifest_digest),
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

function buildApplyScript({
  wordpressPath,
  remoteControlZip,
  remoteAdapterZip,
  expectedControlSha256,
  expectedAdapterSha256,
  expectedVersion,
  expectedHeadSha,
  expectedBuildFingerprint,
  expectedPackageManifestDigest,
  deploymentId,
}) {
  const wp = shellQuote(wordpressPath);
  const controlZip = shellQuote(remoteControlZip);
  const adapterZip = shellQuote(remoteAdapterZip);
  const version = shellQuote(expectedVersion);
  const controlSha = shellQuote(expectedControlSha256);
  const adapterSha = shellQuote(expectedAdapterSha256);
  const candidate = shellQuote(expectedHeadSha);
  const buildFingerprint = shellQuote(expectedBuildFingerprint);
  const packageDigest = shellQuote(expectedPackageManifestDigest);
  const siteUuid = shellQuote(WORDPRESS_STAGING_SITE_UUID);
  const safeId = deploymentId.replace(/[^A-Za-z0-9-]/g, "");
  return `set -euo pipefail
cd ${wp}
plugin_parent="$(pwd)/wp-content/plugins"
control_target="$plugin_parent/${WORDPRESS_STAGING_PLUGIN_SLUG}"
adapter_target="$plugin_parent/${WORDPRESS_STAGING_MCP_ADAPTER_SLUG}"
control_stage="$plugin_parent/.mad4b-control-stage-${safeId}"
adapter_stage="$plugin_parent/.mad4b-adapter-stage-${safeId}"
control_backup="$plugin_parent/.mad4b-control-backup-${safeId}"
adapter_backup="$plugin_parent/.mad4b-adapter-backup-${safeId}"
control_upload=${controlZip}
adapter_upload=${adapterZip}
old_control_active=0
old_adapter_active=0
maintenance_was_active=0
maintenance_activated_by_deploy=0
cleanup_transient() {
  rm -rf "$control_stage" "$adapter_stage" "$control_upload" "$adapter_upload"
}
rollback() {
  code="$1"
  set +e
  if [ -d "$control_backup" ]; then
    if [ -d "$control_target" ]; then mv "$control_target" "$control_target.failed-${safeId}"; fi
    mv "$control_backup" "$control_target"
  fi
  if [ -d "$adapter_backup" ]; then
    if [ -d "$adapter_target" ]; then mv "$adapter_target" "$adapter_target.failed-${safeId}"; fi
    mv "$adapter_backup" "$adapter_target"
  fi
  if [ "$old_adapter_active" = "1" ]; then wp plugin activate ${WORDPRESS_STAGING_MCP_ADAPTER_SLUG} >/dev/null 2>&1; else wp plugin deactivate ${WORDPRESS_STAGING_MCP_ADAPTER_SLUG} >/dev/null 2>&1 || true; fi
  if [ "$old_control_active" = "1" ]; then wp plugin activate ${WORDPRESS_STAGING_PLUGIN_SLUG} >/dev/null 2>&1; else wp plugin deactivate ${WORDPRESS_STAGING_PLUGIN_SLUG} >/dev/null 2>&1 || true; fi
  cleanup_transient
  if [ "$maintenance_was_active" != "1" ] && [ "$maintenance_activated_by_deploy" = "1" ]; then
    wp maintenance-mode deactivate >/dev/null 2>&1 || true
    maintenance_activated_by_deploy=0
  fi
  echo rollback_result=restored
  exit "$code"
}
trap cleanup_transient EXIT

env_type="$(wp eval 'echo wp_get_environment_type();' 2>/dev/null | tail -n 1)"
home_url="$(wp option get home 2>/dev/null | tail -n 1 | sed 's:/*$::')"
site_url="$(wp option get siteurl 2>/dev/null | tail -n 1 | sed 's:/*$::')"
site_uuid_before="$(wp eval 'echo class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::site_uuid() : "";' 2>/dev/null | tail -n 1)"
test "$env_type" = staging
test "$home_url" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$site_url" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$site_uuid_before" = ${siteUuid}
test -d "$control_target"
test -d "$adapter_target"
test "$(sha256sum "$control_upload" | awk '{print $1}')" = ${controlSha}
test "$(sha256sum "$adapter_upload" | awk '{print $1}')" = ${adapterSha}

rm -rf "$control_stage" "$adapter_stage" "$control_backup" "$adapter_backup"
mkdir "$control_stage" "$adapter_stage"
unzip -q "$control_upload" -d "$control_stage"
unzip -q "$adapter_upload" -d "$adapter_stage"
test -d "$control_stage/${WORDPRESS_STAGING_PLUGIN_SLUG}"
test -d "$adapter_stage/${WORDPRESS_STAGING_MCP_ADAPTER_SLUG}"
new_control_version="$(sed -nE 's/^ \\* Version: ([^ ]+).*/\\1/p' "$control_stage/${WORDPRESS_STAGING_PLUGIN_SLUG}/${WORDPRESS_STAGING_PLUGIN_SLUG}.php" | head -n 1)"
new_adapter_version="$(sed -nE 's/^ \\* Version: ([^ ]+).*/\\1/p' "$adapter_stage/${WORDPRESS_STAGING_MCP_ADAPTER_SLUG}/mcp-adapter.php" | head -n 1)"
test "$new_control_version" = ${version}
test "$new_adapter_version" = ${shellQuote(WORDPRESS_STAGING_MCP_ADAPTER_VERSION)}

plugins_device="$(stat -c '%d' "$plugin_parent")"
test "$plugins_device" = "$(stat -c '%d' "$control_stage")"
test "$plugins_device" = "$(stat -c '%d' "$adapter_stage")"
if wp plugin is-active ${WORDPRESS_STAGING_PLUGIN_SLUG} >/dev/null 2>&1; then old_control_active=1; fi
if wp plugin is-active ${WORDPRESS_STAGING_MCP_ADAPTER_SLUG} >/dev/null 2>&1; then old_adapter_active=1; fi
previous_control_version="$(wp plugin get ${WORDPRESS_STAGING_PLUGIN_SLUG} --field=version 2>/dev/null | tail -n 1)"
previous_adapter_version="$(wp plugin get ${WORDPRESS_STAGING_MCP_ADAPTER_SLUG} --field=version 2>/dev/null | tail -n 1)"
if wp maintenance-mode is-active >/dev/null 2>&1; then maintenance_was_active=1; fi
if [ "$maintenance_was_active" != "1" ]; then
  wp maintenance-mode activate >/dev/null
  maintenance_activated_by_deploy=1
fi
trap 'rollback $?' ERR
mv "$control_target" "$control_backup"
mv "$adapter_target" "$adapter_backup"
mv "$adapter_stage/${WORDPRESS_STAGING_MCP_ADAPTER_SLUG}" "$adapter_target"
mv "$control_stage/${WORDPRESS_STAGING_PLUGIN_SLUG}" "$control_target"
wp plugin activate ${WORDPRESS_STAGING_MCP_ADAPTER_SLUG} >/dev/null
wp plugin activate ${WORDPRESS_STAGING_PLUGIN_SLUG} >/dev/null

actual_control_version="$(wp plugin get ${WORDPRESS_STAGING_PLUGIN_SLUG} --field=version 2>/dev/null | tail -n 1)"
actual_adapter_version="$(wp plugin get ${WORDPRESS_STAGING_MCP_ADAPTER_SLUG} --field=version 2>/dev/null | tail -n 1)"
runtime_version="$(wp eval 'echo defined("MAD4B_SCP_VERSION") ? MAD4B_SCP_VERSION : "";' 2>/dev/null | tail -n 1)"
env_after="$(wp eval 'echo wp_get_environment_type();' 2>/dev/null | tail -n 1)"
home_after="$(wp option get home 2>/dev/null | tail -n 1 | sed 's:/*$::')"
site_after="$(wp option get siteurl 2>/dev/null | tail -n 1 | sed 's:/*$::')"
site_uuid_after="$(wp eval 'echo class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::site_uuid() : "";' 2>/dev/null | tail -n 1)"
profile_environment_after="$(wp eval 'echo class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::current_environment() : "";' 2>/dev/null | tail -n 1)"
profile_origin_after="$(wp eval 'echo class_exists("MAD4B_SCP_Site_Profile") ? MAD4B_SCP_Site_Profile::current_origin() : "";' 2>/dev/null | tail -n 1 | sed 's:/*$::')"
prov_source="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo isset($p["source_commit_sha"]) ? $p["source_commit_sha"] : "";' 2>/dev/null | tail -n 1)"
prov_build="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo isset($p["build_fingerprint"]) ? $p["build_fingerprint"] : "";' 2>/dev/null | tail -n 1)"
prov_package="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo isset($p["package_manifest_digest"]) ? $p["package_manifest_digest"] : "";' 2>/dev/null | tail -n 1)"
prov_match="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo !empty($p["runtime_manifest_match"]) ? "1" : "0";' 2>/dev/null | tail -n 1)"
prov_stale="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo !empty($p["stale"]) ? "1" : "0";' 2>/dev/null | tail -n 1)"
prov_mismatch_count="$(wp eval '$p=class_exists("MAD4B_SCP_Live_Acceptance_Observer") ? MAD4B_SCP_Live_Acceptance_Observer::build_provenance_status() : array(); echo isset($p["provenance_mismatch"]) && is_array($p["provenance_mismatch"]) ? count($p["provenance_mismatch"]) : 999;' 2>/dev/null | tail -n 1)"

test "$actual_control_version" = ${version}
test "$runtime_version" = ${version}
test "$actual_adapter_version" = ${shellQuote(WORDPRESS_STAGING_MCP_ADAPTER_VERSION)}
test "$env_after" = staging
test "$home_after" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$site_after" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$site_uuid_after" = ${siteUuid}
test "$profile_environment_after" = staging
test "$profile_origin_after" = ${shellQuote(WORDPRESS_STAGING_ORIGIN)}
test "$prov_source" = ${candidate}
test "$prov_build" = ${buildFingerprint}
test "$prov_package" = ${packageDigest}
test "$prov_match" = 1
test "$prov_stale" = 0
test "$prov_mismatch_count" = 0

if [ "$maintenance_was_active" != "1" ] && [ "$maintenance_activated_by_deploy" = "1" ]; then
  wp maintenance-mode deactivate >/dev/null
  maintenance_activated_by_deploy=0
fi
cleanup_transient
trap - ERR
trap - EXIT
echo previous_control_plane_version="$previous_control_version"
echo previous_mcp_adapter_version="$previous_adapter_version"
echo deployed_control_plane_version="$actual_control_version"
echo runtime_control_plane_version="$runtime_version"
echo mcp_adapter_version="$actual_adapter_version"
echo environment="$env_after"
echo home_url="$home_after"
echo site_url="$site_after"
echo site_uuid="$site_uuid_after"
echo profile_environment="$profile_environment_after"
echo profile_origin="$profile_origin_after"
echo source_commit_sha="$prov_source"
echo build_fingerprint="$prov_build"
echo package_manifest_digest="$prov_package"
echo runtime_manifest_match="$prov_match"
echo stale="$prov_stale"
echo provenance_mismatch_count="$prov_mismatch_count"
echo control_backup_path="$control_backup"
echo adapter_backup_path="$adapter_backup"
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
  const timeoutMs = boundedInt(input.timeout_ms || input.timeoutMs, 120000, 1000, 300000);
  const traceId = `wordpress_staging_deploy_${randomUUID()}`;

  if (!/^[0-9a-f]{40}$/.test(expectedHeadSha)) throw deployError("wordpress_staging_deploy_exact_head_required", "expected_head_sha must be the exact 40-character WordPress PR HEAD SHA.", 400);
  if (input.target_id || input.targetId || input.host || input.hostname || input.app_path || input.appPath || input.ssh_auth_mode || input.sshAuthMode || input.credential || input.credentials || input.artifact_id || input.artifactId) {
    throw deployError("wordpress_staging_deploy_caller_target_or_credential_forbidden", "Caller-selected target, artifact, path, host, SSH mode, or credentials are forbidden for WordPress Staging deployment.", 400);
  }
  if (!dryRun && approvalReason.length < 20) throw deployError("wordpress_staging_deploy_approval_reason_required", "approval_reason with at least 20 characters is required for apply.", 403);

  const target = await resolveStagingTarget(pool);
  const targetIdentity = assertStagingTarget(target);
  const artifact = await resolveReviewedArtifact(expectedHeadSha, deps);
  const connection = await resolveServerOwnedHostingerSshConnection(pool, target);
  const preflightResult = await runHostingerSshCommand({ ...connection, remoteScript: buildPreflightScript(targetIdentity.wordpressPath), timeoutMs });
  const preflight = assertLivePreflight(preflightResult);

  const base = {
    ok: true,
    contract: WORDPRESS_STAGING_DEPLOY_CONTRACT,
    deployment_handoff_contract: WORDPRESS_STAGING_HANDOFF_CONTRACT,
    deployment_run_id: traceId,
    resolved_target_id: target.target_id,
    target_resolution: "server_owned_unique_exact_staging_target",
    caller_target_selection_allowed: false,
    environment: "staging",
    origin: WORDPRESS_STAGING_ORIGIN,
    site_uuid: WORDPRESS_STAGING_SITE_UUID,
    expected_head_sha: expectedHeadSha,
    workflow_run_id: artifact.workflow_run_id,
    artifact_id: artifact.artifact_id,
    artifact_name: artifact.artifact_name,
    artifact_archive_sha256: artifact.artifact_archive_sha256,
    control_plane_version: artifact.control_plane_version,
    control_plane_sha256: artifact.control_archive_sha256,
    mcp_adapter_version: WORDPRESS_STAGING_MCP_ADAPTER_VERSION,
    mcp_adapter_sha256: artifact.adapter_archive_sha256,
    expected_build_fingerprint: artifact.build_fingerprint,
    expected_package_manifest_digest: artifact.package_manifest_digest,
    preflight: {
      ready: true,
      environment: preflight.environment,
      home_url: normalizeOrigin(preflight.home_url),
      site_url: normalizeOrigin(preflight.site_url),
      site_uuid: preflight.site_uuid,
      profile_environment: preflight.profile_environment,
      profile_origin: normalizeOrigin(preflight.profile_origin),
      profile_configured: preflight.profile_configured === "1",
      current_control_plane_version: preflight.control_plane_version || null,
      mcp_adapter_version: preflight.mcp_adapter_version,
      mutation_performed: false,
    },
    dry_run: dryRun,
    production_authority_used: false,
    breakglass_used: false,
    raw_sql_used: false,
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
    acceptedIntents: [WORDPRESS_STAGING_DEPLOY_OPERATION, "wordpress_plugin_deploy", "deploy", "write"],
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
  const remoteControlZip = `${targetIdentity.wordpressPath}/wp-content/plugins/.mad4b-control-${deploymentId}.zip`;
  const remoteAdapterZip = `${targetIdentity.wordpressPath}/wp-content/plugins/.mad4b-adapter-${deploymentId}.zip`;

  const adapterUpload = await runHostingerSshCommand({ ...connection, remoteScript: buildUploadScript(targetIdentity.wordpressPath, remoteAdapterZip), timeoutMs, stdinBuffer: artifact.adapter_archive });
  if (!adapterUpload.ok || parseKeyValueOutput(adapterUpload.stdout).upload_result !== "ok") {
    const failure = { ...base, dry_run: false, failure_reason: "adapter_artifact_upload_failed", upload_exit_code: adapterUpload.exit_code };
    await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy", "failed", failure);
    throw deployError("wordpress_staging_deploy_adapter_upload_failed", "The verified MCP Adapter archive could not be uploaded through the governed SSH transport.", 502, { exit_code: adapterUpload.exit_code, stderr: adapterUpload.stderr });
  }

  const controlUpload = await runHostingerSshCommand({ ...connection, remoteScript: buildUploadScript(targetIdentity.wordpressPath, remoteControlZip), timeoutMs, stdinBuffer: artifact.control_archive });
  if (!controlUpload.ok || parseKeyValueOutput(controlUpload.stdout).upload_result !== "ok") {
    const failure = { ...base, dry_run: false, failure_reason: "control_artifact_upload_failed", upload_exit_code: controlUpload.exit_code };
    await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy", "failed", failure);
    throw deployError("wordpress_staging_deploy_control_upload_failed", "The verified Control Plane archive could not be uploaded through the governed SSH transport.", 502, { exit_code: controlUpload.exit_code, stderr: controlUpload.stderr });
  }

  const apply = await runHostingerSshCommand({ ...connection, remoteScript: buildApplyScript({
    wordpressPath: targetIdentity.wordpressPath,
    remoteControlZip,
    remoteAdapterZip,
    expectedControlSha256: artifact.control_archive_sha256,
    expectedAdapterSha256: artifact.adapter_archive_sha256,
    expectedVersion: artifact.control_plane_version,
    expectedHeadSha,
    expectedBuildFingerprint: artifact.build_fingerprint,
    expectedPackageManifestDigest: artifact.package_manifest_digest,
    deploymentId,
  }), timeoutMs });
  const applied = parseKeyValueOutput(apply.stdout);

  const deployOk = apply.ok
    && applied.deploy_result === "ok"
    && applied.deployed_control_plane_version === artifact.control_plane_version
    && applied.runtime_control_plane_version === artifact.control_plane_version
    && applied.mcp_adapter_version === WORDPRESS_STAGING_MCP_ADAPTER_VERSION
    && String(applied.environment || "").toLowerCase() === "staging"
    && normalizeOrigin(applied.home_url) === WORDPRESS_STAGING_ORIGIN
    && normalizeOrigin(applied.site_url) === WORDPRESS_STAGING_ORIGIN
    && String(applied.site_uuid || "").toLowerCase() === WORDPRESS_STAGING_SITE_UUID
    && String(applied.source_commit_sha || "").toLowerCase() === expectedHeadSha
    && applied.build_fingerprint === artifact.build_fingerprint
    && applied.package_manifest_digest === artifact.package_manifest_digest
    && applied.runtime_manifest_match === "1"
    && applied.stale === "0"
    && applied.provenance_mismatch_count === "0";

  if (!deployOk) {
    const failure = { ...base, dry_run: false, failure_reason: "same_cycle_exact_provenance_readback_failed", apply_exit_code: apply.exit_code, rollback_result: applied.rollback_result || null };
    await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy", "failed", failure);
    throw deployError("wordpress_staging_deploy_readback_failed", "WordPress Staging deployment or exact same-cycle provenance readback failed; rollback is required before returning.", 502, { exit_code: apply.exit_code, rollback_result: applied.rollback_result || null, stderr: apply.stderr });
  }

  const consumed = await transitionCapabilityEnvelopeLifecycle({ envelopeId: envelope.envelope_id, action: "consume", executionRef: traceId, reason: "wordpress_staging_plugin_deploy_completed" });
  if (!consumed.ok) {
    const reconciliation = {
      ...base,
      dry_run: false,
      deployment_status: "completed_reconciliation_required",
      mutation_applied: true,
      same_cycle_exact_provenance_readback: true,
      retry_deployment: false,
      reconciliation_required: true,
      capability_envelope_id: envelope.envelope_id,
      capability_envelope_consumed: false,
      failure_reason: "capability_envelope_consume_failed_after_verified_deploy",
      observed_source_commit_sha: applied.source_commit_sha,
      observed_build_fingerprint: applied.build_fingerprint,
      observed_package_manifest_digest: applied.package_manifest_digest,
      runtime_manifest_match: true,
      stale: false,
      provenance_mismatch_count: 0,
      secrets_included: false,
    };
    await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy", "failed", reconciliation);
    throw deployError(
      "wordpress_staging_deploy_envelope_consume_failed",
      "Deployment completed and exact same-cycle readback succeeded, but capability-envelope consumption could not be recorded. Do not retry the deployment; governance reconciliation is required.",
      500,
      {
        envelope_id: envelope.envelope_id,
        mutation_applied: true,
        same_cycle_exact_provenance_readback: true,
        retry_deployment: false,
        reconciliation_required: true,
      },
    );
  }

  const result = {
    ...base,
    dry_run: false,
    deployment_status: "completed",
    previous_control_plane_version: applied.previous_control_plane_version || null,
    previous_mcp_adapter_version: applied.previous_mcp_adapter_version || null,
    deployed_control_plane_version: applied.deployed_control_plane_version,
    runtime_control_plane_version: applied.runtime_control_plane_version,
    observed_source_commit_sha: applied.source_commit_sha,
    observed_build_fingerprint: applied.build_fingerprint,
    observed_package_manifest_digest: applied.package_manifest_digest,
    runtime_manifest_match: true,
    stale: false,
    provenance_mismatch_count: 0,
    control_rollback_backup_path: applied.control_backup_path || null,
    adapter_rollback_backup_path: applied.adapter_backup_path || null,
    capability_envelope_id: envelope.envelope_id,
    capability_envelope_consumed: true,
    execution: {
      will_execute: true,
      executed: true,
      ssh_used: true,
      raw_shell_exposed: false,
      caller_selected_target: false,
      caller_selected_path: false,
      caller_supplied_credentials_used: false,
      adapter_replaced_from_verified_bundle: true,
      control_plane_replaced_from_verified_bundle: true,
      same_filesystem_rename_replace: true,
      maintenance_mode_during_swap: true,
      same_cycle_exact_provenance_readback: true,
      rollback_on_failed_readback: true,
    },
    remaining_live_acceptance: artifact.handoff?.post_deploy?.required_live_acceptance || [],
    secrets_included: false,
  };
  await writeEvidence(pool, traceId, "wordpress_staging_plugin_deploy", "success", result);
  return result;
}
