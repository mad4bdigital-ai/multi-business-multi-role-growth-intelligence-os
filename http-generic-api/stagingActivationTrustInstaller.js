import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createPublicKey } from "node:crypto";
import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";

const SHA_RE = /^[a-f0-9]{40}$/u;
const KEY_ID_RE = /^[A-Za-z0-9._:-]{16,128}$/u;
const ALLOWED_KEYS = Object.freeze([
  "REMOTE_MCP_TRUSTED_INGRESS_MODE",
  "REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS",
  "REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY",
  "REMOTE_MCP_TRUSTED_INGRESS_KEY_ID",
  "REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST",
  "REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE",
  "REMOTE_MCP_TRUSTED_INGRESS_ISSUER",
  "REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA",
]);

function compact(value, max = 8192) {
  return String(value ?? "").trim().slice(0, max);
}

function installerError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function escapeEnvValue(value) {
  return String(value ?? "").replaceAll("\r", "").replaceAll("\n", "\\n");
}

function parseEnvText(text) {
  const lines = String(text ?? "").replaceAll("\r\n", "\n").split("\n");
  const indexes = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(lines[index]);
    if (!match) continue;
    if (indexes.has(match[1])) throw installerError("staging_trust_env_duplicate_key", `Duplicate Staging environment key is forbidden: ${match[1]}`, 409, { key: match[1] });
    indexes.set(match[1], index);
  }
  return { lines, indexes };
}

function updateAllowedEnvText(text, values) {
  const { lines, indexes } = parseEnvText(text);
  for (const key of Object.keys(values)) {
    if (!ALLOWED_KEYS.includes(key)) throw installerError("staging_trust_env_key_not_allowed", `Staging trust installer cannot mutate ${key}.`, 403, { key });
  }
  for (const key of ALLOWED_KEYS) {
    if (!Object.hasOwn(values, key)) continue;
    const rendered = `${key}=${escapeEnvValue(values[key])}`;
    if (indexes.has(key)) lines[indexes.get(key)] = rendered;
    else {
      indexes.set(key, lines.length);
      lines.push(rendered);
    }
  }
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 10000)));
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { "x-request-id": crypto.randomUUID() } });
    const text = await response.text().catch(() => "");
    let body = null;
    try { body = JSON.parse(text); } catch {}
    return { status: response.status, ok: response.ok, body, secrets_included: false };
  } catch (error) {
    return { status: 0, ok: false, error: compact(error?.message, 300), body: null, secrets_included: false };
  } finally {
    clearTimeout(timer);
  }
}

function validateEd25519PublicKey(value) {
  try {
    const key = createPublicKey(String(value));
    return key.asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
}

export async function buildStagingActivationTrustInstallPlan({
  expectedSha,
  fetchImpl = globalThis.fetch,
  registry = readEnvironmentConvergenceRegistry(),
  timeoutMs = 10000,
} = {}) {
  const sha = compact(expectedSha, 64).toLowerCase();
  if (!SHA_RE.test(sha)) throw installerError("staging_trust_expected_sha_invalid", "An exact 40-character expected SHA is required.");
  if (typeof fetchImpl !== "function") throw installerError("staging_trust_fetch_unavailable", "Fetch implementation is unavailable.", 500);
  const gateway = registry?.profiles?.staging?.activation_gateway || {};
  if (gateway.policy_key !== "activation_gateway_staging" || gateway.public_host !== "activation-dev.mad4b.com" || !/^[a-f0-9]{64}$/u.test(compact(gateway.expected_policy_hash, 64))) {
    throw installerError("staging_trust_profile_invalid", "Staging Activation Gateway profile is invalid.", 503);
  }
  const base = `https://${gateway.public_host}`;
  const [health, ready] = await Promise.all([
    fetchJson(fetchImpl, `${base}/health`, timeoutMs),
    fetchJson(fetchImpl, `${base}/ready`, timeoutMs),
  ]);
  const trust = ready.body?.recoveryTrustedIngress || null;
  const checks = [
    { key: "health_200", ok: health.status === 200 && health.ok },
    { key: "health_ok", ok: health.body?.ok === true && health.body?.stale === false },
    { key: "health_policy_key", ok: health.body?.policyKey === gateway.policy_key },
    { key: "health_policy_hash", ok: compact(health.body?.policyHash, 64).toLowerCase() === compact(gateway.expected_policy_hash, 64).toLowerCase() },
    { key: "health_source_commit", ok: compact(health.body?.sourceCommit, 64).toLowerCase() === sha },
    { key: "health_worker_build_sha", ok: compact(health.body?.workerBuildSha, 64).toLowerCase() === sha },
    { key: "ready_200", ok: ready.status === 200 && ready.ok && ready.body?.ok === true },
    { key: "ready_policy_hash", ok: compact(ready.body?.policyHash, 64).toLowerCase() === compact(gateway.expected_policy_hash, 64).toLowerCase() },
    { key: "ready_upstream_source_commit", ok: compact(ready.body?.upstreamSourceCommit, 64).toLowerCase() === sha },
    { key: "trust_contract", ok: trust?.contract === "mad4b.staging.activation-recovery-origin-trust.v2" },
    { key: "trust_deployment_sha", ok: compact(trust?.deployment_sha, 64).toLowerCase() === sha },
    { key: "trust_worker_build_sha", ok: compact(trust?.worker_build_sha, 64).toLowerCase() === sha },
    { key: "trust_policy_hash", ok: compact(trust?.policy_hash, 64).toLowerCase() === compact(gateway.expected_policy_hash, 64).toLowerCase() },
    { key: "trust_canonical_host", ok: trust?.canonical_host === gateway.public_host && trust?.gateway_host === gateway.public_host },
    { key: "trust_issuer", ok: trust?.issuer === `https://${gateway.public_host}` },
    { key: "trust_audience", ok: trust?.audience === "https://dev.mad4b.com" },
    { key: "trust_key_id", ok: KEY_ID_RE.test(compact(trust?.key_id, 128)) },
    { key: "trust_public_key_ed25519", ok: validateEd25519PublicKey(trust?.public_key) },
    { key: "trust_flags", ok: trust?.trusted_ingress_mode === "signature" && trust?.strip_caller_headers === true && trust?.secrets_included === false && trust?.provider_credentials_included === false },
  ].map((check) => ({ ...check, secrets_included: false }));
  const readyToInstall = checks.every((check) => check.ok);
  const values = readyToInstall ? Object.freeze({
    REMOTE_MCP_TRUSTED_INGRESS_MODE: "signature",
    REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
    REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: trust.public_key,
    REMOTE_MCP_TRUSTED_INGRESS_KEY_ID: trust.key_id,
    REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST: trust.canonical_host,
    REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE: trust.audience,
    REMOTE_MCP_TRUSTED_INGRESS_ISSUER: trust.issuer,
    REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA: sha,
  }) : null;
  return {
    contract: "mad4b.staging.activation-recovery-trust-install-plan.v1",
    status: readyToInstall ? "ready" : "not_ready",
    ready: readyToInstall,
    expected_sha: sha,
    public_host: gateway.public_host,
    policy_hash: gateway.expected_policy_hash,
    key_id: readyToInstall ? trust.key_id : null,
    public_key_sha256: readyToInstall ? sha256(trust.public_key) : null,
    checks,
    allowed_env_keys: ALLOWED_KEYS,
    env_values: values,
    provider_mutation: false,
    cloudflare_mutation: false,
    workflow_dispatch: false,
    production_mutation: false,
    database_mutation: false,
    provider_credentials_included: false,
    secrets_included: false,
  };
}

export async function installStagingActivationTrust({
  expectedSha,
  envFile,
  mode = "dry_run",
  fetchImpl = globalThis.fetch,
  registry = readEnvironmentConvergenceRegistry(),
  timeoutMs = 10000,
} = {}) {
  const normalizedMode = compact(mode, 16).toLowerCase();
  if (!["dry_run", "apply"].includes(normalizedMode)) throw installerError("staging_trust_install_mode_invalid", "mode must be dry_run or apply.");
  const plan = await buildStagingActivationTrustInstallPlan({ expectedSha, fetchImpl, registry, timeoutMs });
  if (normalizedMode === "dry_run") return { ...plan, mode: normalizedMode, mutated: false };
  if (!plan.ready || !plan.env_values) throw installerError("staging_trust_install_not_ready", "Public Gateway evidence is not exact and cannot be installed.", 409, { failed_checks: plan.checks.filter((check) => !check.ok).map((check) => check.key) });
  const target = path.resolve(String(envFile || ""));
  if (!envFile) throw installerError("staging_trust_env_file_required", "envFile is required for apply.");
  const before = await fs.readFile(target, "utf8");
  const beforeParsed = parseEnvText(before);
  for (const key of ["REMOTE_MCP_TRUST_PROXY_HOST_HEADERS", "RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY"]) {
    if (!beforeParsed.indexes.has(key)) throw installerError("staging_trust_local_prerequisite_missing", `Required local Staging key is missing: ${key}`, 409, { key });
  }
  const proxyValue = beforeParsed.lines[beforeParsed.indexes.get("REMOTE_MCP_TRUST_PROXY_HOST_HEADERS")].split("=").slice(1).join("=").trim().toLowerCase();
  const replayValue = beforeParsed.lines[beforeParsed.indexes.get("RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY")].split("=").slice(1).join("=").trim();
  if (proxyValue !== "true" || replayValue !== "/app/data/recovery-ingress") {
    throw installerError("staging_trust_local_prerequisite_invalid", "Local proxy/replay prerequisites are not canonical; installer will not broaden them.", 409);
  }
  const after = updateAllowedEnvText(before, plan.env_values);
  const changed = after !== before.replaceAll("\r\n", "\n");
  if (changed) {
    const temp = `${target}.trust-install-${process.pid}-${Date.now()}.tmp`;
    await fs.writeFile(temp, after, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, target);
  }
  return {
    ...plan,
    mode: normalizedMode,
    mutated: changed,
    mutation_scope: "local_staging_trust_allowlist_only",
    env_file: target,
    env_file_sha256_before: sha256(before.replaceAll("\r\n", "\n")),
    env_file_sha256_after: sha256(after),
    values_returned: false,
    env_values: undefined,
    secrets_included: false,
  };
}

export { ALLOWED_KEYS as STAGING_ACTIVATION_TRUST_ENV_ALLOWLIST };
