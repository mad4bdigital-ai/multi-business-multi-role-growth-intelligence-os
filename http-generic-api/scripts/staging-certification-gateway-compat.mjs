#!/usr/bin/env node
import { createHash, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONTRACT = "mad4b.staging-certification-gateway-compatibility.v1";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMPATIBLE_REASONS = Object.freeze([
  "gateway_recovery_trusted_ingress",
  "gateway_exact_commit",
  "gateway_upstream_ready",
]);
const POLICY_PATH = "http-generic-api/activation-gateway-runtime/generated/route-policy.staging.json";
const BUNDLE_PATHS = Object.freeze([
  "http-generic-api/activation-gateway-runtime/src/worker-staging.mjs",
  "http-generic-api/activation-gateway-runtime/src/gateway.mjs",
  POLICY_PATH,
  "http-generic-api/stagingActivationGatewayBundle.js",
  "http-generic-api/stagingActivationTrustInstaller.js",
  "http-generic-api/trustedIngressContract.js",
]);

function required(name, pattern = null) {
  const value = String(process.env[name] || "").trim();
  if (!value || (pattern && !pattern.test(value))) {
    console.error(`${name} is missing or invalid`);
    process.exit(2);
  }
  return value;
}

function runGit(repositoryPath, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repositoryPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args[0]} failed`);
  }
  return {
    status: Number.isInteger(result.status) ? result.status : 1,
    stdout: String(result.stdout || ""),
  };
}

function gitBlob(repositoryPath, commit, path) {
  const value = runGit(repositoryPath, ["rev-parse", `${commit}:${path}`]).stdout.trim().toLowerCase();
  if (!SHA40.test(value)) throw new Error("git blob identity is invalid");
  return value;
}

function gitText(repositoryPath, commit, path) {
  return runGit(repositoryPath, ["show", `${commit}:${path}`]).stdout;
}

function parseEnv(text) {
  const map = new Map();
  for (const rawLine of String(text || "").split(/\r?\n/u)) {
    if (!rawLine || /^\s*#/u.test(rawLine)) continue;
    const index = rawLine.indexOf("=");
    if (index <= 0) continue;
    map.set(rawLine.slice(0, index).trim(), rawLine.slice(index + 1));
  }
  return map;
}

function envText(map, key) {
  return String(map.get(key) || "").trim();
}

function boolText(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function normalizePem(value) {
  return String(value || "").replaceAll("\\n", "\n").replaceAll("\r", "").trim();
}

function publicKeyEvidence(value) {
  const pem = normalizePem(value);
  try {
    const key = createPublicKey(pem);
    const der = key.export({ type: "spki", format: "der" });
    return {
      valid: key.asymmetricKeyType === "ed25519",
      sha256: createHash("sha256").update(der).digest("hex"),
    };
  } catch {
    return { valid: false, sha256: null };
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    let body = null;
    try { body = await response.json(); } catch { }
    return { ok: response.ok, status: response.status, body, error: null };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: String(error?.name || error?.code || "fetch_failed").slice(0, 128),
    };
  }
}

const authorityCommit = required("STAGING_CERT_GATEWAY_COMPAT_AUTHORITY_COMMIT", SHA40).toLowerCase();
const expectedCommit = required("STAGING_CERT_GATEWAY_COMPAT_EXPECTED_COMMIT", SHA40).toLowerCase();
const repositoryPath = required("STAGING_CERT_GATEWAY_COMPAT_REPOSITORY_PATH");
const envFile = required("STAGING_CERT_GATEWAY_COMPAT_ENV_FILE");

let policy = null;
let policyHistorical = null;
let bundleBlobs = [];
let graphDigest = null;
let env = new Map();
let health = { ok: false, status: 0, body: null, error: "not_checked" };
let ready = { ok: false, status: 0, body: null, error: "not_checked" };
let ancestor = false;
let failure = null;

try {
  ancestor = runGit(repositoryPath, ["merge-base", "--is-ancestor", expectedCommit, authorityCommit], { allowFailure: true }).status === 0;
  bundleBlobs = BUNDLE_PATHS.map((path) => {
    const historical = gitBlob(repositoryPath, expectedCommit, path);
    const authority = gitBlob(repositoryPath, authorityCommit, path);
    return { path, historical_blob: historical, authority_blob: authority, identical: historical === authority };
  });

  policyHistorical = JSON.parse(gitText(repositoryPath, expectedCommit, POLICY_PATH));
  policy = JSON.parse(gitText(repositoryPath, authorityCommit, POLICY_PATH));
  env = parseEnv(await readFile(envFile, "utf8"));

  const workerTemplate = gitText(repositoryPath, authorityCommit, BUNDLE_PATHS[0]);
  const gatewaySource = gitText(repositoryPath, authorityCommit, BUNDLE_PATHS[1]);
  const policyText = gitText(repositoryPath, authorityCommit, POLICY_PATH);
  graphDigest = sha256(
    "mad4b.activation-gateway-staging.bundle.v1\0"
    + workerTemplate + "\0"
    + gatewaySource + "\0"
    + policyText,
  );

  const publicHost = String(policy?.public_host || "").trim().toLowerCase();
  if (!publicHost || !/^[a-z0-9.-]+$/u.test(publicHost)) throw new Error("gateway public host is invalid");
  const gatewayBase = new URL(`https://${publicHost}`);
  [health, ready] = await Promise.all([
    fetchJson(new URL("/health", gatewayBase)),
    fetchJson(new URL("/ready", gatewayBase)),
  ]);
} catch (error) {
  failure = String(error?.message || "gateway_compatibility_probe_failed").slice(0, 256);
}

const trust = ready.body?.recoveryTrustedIngress || null;
const localKey = publicKeyEvidence(envText(env, "REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY"));
const gatewayKey = publicKeyEvidence(trust?.public_key);
const expectedHost = String(policy?.public_host || "").trim().toLowerCase();
const expectedAudience = String(policy?.upstream_origin || "").trim();
const expectedIssuer = expectedHost ? `https://${expectedHost}` : "";
const policyParity =
  policy !== null
  && policyHistorical !== null
  && JSON.stringify(policyHistorical) === JSON.stringify(policy);

const bundleChecks = Object.fromEntries(bundleBlobs.map((entry) => [
  entry.path,
  entry.identical === true,
]));

const checks = Object.freeze({
  historical_release_is_ancestor_of_authority: ancestor,
  gateway_bundle_blob_parity: bundleBlobs.length === BUNDLE_PATHS.length && bundleBlobs.every((entry) => entry.identical === true),
  gateway_policy_semantic_parity: policyParity,
  gateway_policy_key_present: Boolean(String(policy?.policy_key || "").trim()),
  gateway_policy_hash_valid: SHA256.test(String(policy?.content_hash_sha256 || "").trim().toLowerCase()),
  gateway_graph_digest_valid: SHA256.test(String(graphDigest || "")),

  health_http_ready: health.ok === true && health.status === 200 && health.body?.ok === true && health.body?.stale === false,
  health_source_commit_is_current_worker: String(health.body?.sourceCommit || "").trim().toLowerCase() === authorityCommit,
  health_worker_build_is_current_worker: String(health.body?.workerBuildSha || "").trim().toLowerCase() === authorityCommit,
  health_worker_bundle_exact: String(health.body?.workerBundleSha256 || "").trim().toLowerCase() === graphDigest,
  health_policy_key_exact: String(health.body?.policyKey || "").trim() === String(policy?.policy_key || "").trim(),
  health_policy_hash_exact: String(health.body?.policyHash || "").trim().toLowerCase() === String(policy?.content_hash_sha256 || "").trim().toLowerCase(),
  health_secret_free: health.body?.secretsIncluded === false,

  ready_live_upstream: ready.ok === true
    && ready.status === 200
    && ready.body?.ok === true
    && ready.body?.upstreamReady === true
    && ready.body?.upstreamEvidenceVerified === true,
  ready_upstream_is_historical_release: String(ready.body?.upstreamSourceCommit || "").trim().toLowerCase() === expectedCommit,
  ready_policy_hash_exact: String(ready.body?.policyHash || "").trim().toLowerCase() === String(policy?.content_hash_sha256 || "").trim().toLowerCase(),
  ready_secret_free: ready.body?.secretsIncluded === false,

  gateway_trust_contract_exact: trust?.contract === "mad4b.staging.activation-recovery-origin-trust.v2",
  gateway_trust_source_is_current_worker: String(trust?.source_commit || "").trim().toLowerCase() === authorityCommit,
  gateway_trust_deployment_is_current_worker: String(trust?.deployment_sha || "").trim().toLowerCase() === authorityCommit,
  gateway_trust_worker_build_is_current_worker: String(trust?.worker_build_sha || "").trim().toLowerCase() === authorityCommit,
  gateway_trust_worker_bundle_exact: String(trust?.worker_bundle_sha256 || "").trim().toLowerCase() === graphDigest,
  gateway_trust_policy_hash_exact: String(trust?.policy_hash || "").trim().toLowerCase() === String(policy?.content_hash_sha256 || "").trim().toLowerCase(),
  gateway_trust_identity_exact: String(trust?.canonical_host || "").trim().toLowerCase() === expectedHost
    && String(trust?.gateway_host || "").trim().toLowerCase() === expectedHost
    && String(trust?.audience || "").trim() === expectedAudience
    && String(trust?.issuer || "").trim() === expectedIssuer,
  gateway_trust_signature_mode: trust?.trusted_ingress_mode === "signature" && trust?.strip_caller_headers === true,
  gateway_trust_key_valid: gatewayKey.valid === true && SHA256.test(String(gatewayKey.sha256 || "")),
  gateway_trust_secret_free: trust?.provider_credentials_included === false
    && trust?.production_deploy === false
    && trust?.database_mutation === false
    && trust?.secrets_included === false,

  local_trust_signature_mode: envText(env, "REMOTE_MCP_TRUSTED_INGRESS_MODE").toLowerCase() === "signature",
  local_trust_proxy_headers_enabled: boolText(envText(env, "REMOTE_MCP_TRUST_PROXY_HOST_HEADERS")),
  local_trust_caller_headers_stripped: boolText(envText(env, "REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS")),
  local_trust_current_worker_sha: envText(env, "REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA").toLowerCase() === authorityCommit,
  local_trust_identity_exact: envText(env, "REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST").toLowerCase() === expectedHost
    && envText(env, "REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE") === expectedAudience
    && envText(env, "REMOTE_MCP_TRUSTED_INGRESS_ISSUER") === expectedIssuer,
  local_trust_replay_directory_exact: envText(env, "RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY") === "/app/data/recovery-ingress",
  local_gateway_key_id_match: Boolean(envText(env, "REMOTE_MCP_TRUSTED_INGRESS_KEY_ID"))
    && envText(env, "REMOTE_MCP_TRUSTED_INGRESS_KEY_ID") === String(trust?.key_id || "").trim(),
  local_gateway_public_key_match: localKey.valid === true
    && gatewayKey.valid === true
    && localKey.sha256 === gatewayKey.sha256,
});

const verified = failure === null && Object.values(checks).every(Boolean);
const report = {
  contract: CONTRACT,
  verified,
  authority_mode: "control_plane_current_historical_gateway",
  authority_commit: authorityCommit,
  expected_commit: expectedCommit,
  compatible_degraded_reasons: verified ? [...COMPATIBLE_REASONS] : [],
  bundle_blob_checks: bundleChecks,
  checks,
  observed: {
    gateway_host: expectedHost || null,
    policy_key: policy?.policy_key || null,
    policy_hash: policy?.content_hash_sha256 || null,
    expected_worker_bundle_sha256: graphDigest,
    health_status: health.status || null,
    health_source_commit: String(health.body?.sourceCommit || "").trim().toLowerCase() || null,
    health_worker_build_sha: String(health.body?.workerBuildSha || "").trim().toLowerCase() || null,
    ready_status: ready.status || null,
    ready_upstream_source_commit: String(ready.body?.upstreamSourceCommit || "").trim().toLowerCase() || null,
    local_trust_worker_sha: envText(env, "REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA").toLowerCase() || null,
    local_public_key_sha256: localKey.sha256,
    gateway_public_key_sha256: gatewayKey.sha256,
  },
  failure,
  read_only: true,
  network_read_performed: true,
  database_connection_performed: false,
  database_mutation_performed: false,
  provider_mutation_performed: false,
  production_accessed: false,
  production_mutation_performed: false,
  secrets_included: false,
};
console.log(JSON.stringify(report));
if (!verified) process.exitCode = 1;
