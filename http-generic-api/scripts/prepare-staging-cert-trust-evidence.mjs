#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
import { createHash, createPublicKey } from "node:crypto";
import {
  loadActivationGatewayProfilePolicy,
  readEnvironmentConvergenceRegistry,
} from "../environmentConvergenceRegistry.js";
import { STAGING_TRUSTED_INGRESS_CERTIFICATION_EVIDENCE_CONTRACT } from "../stagingTrustedIngressCertificationEvidence.js";

const CONTRACT = "mad4b.staging-cert-trust-runtime-binding.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const DIGEST_RE = /^[0-9a-f]{64}$/u;
const KEY_ID_RE = /^[A-Za-z0-9._:-]{16,128}$/u;

function bool(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function normalizeUrl(value, fallback) {
  const url = new URL(String(value || fallback));
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function resolveGatewayProbeTarget(env, gatewayPolicy) {
  const canonical = normalizeUrl(null, `https://${gatewayPolicy.public_host}`);
  const overrideValue = String(env.STAGING_CERT_GATEWAY_BASE_URL || "").trim();
  if (!overrideValue) return { ok: true, url: canonical, source: "environment_profile", reason: null };
  let candidate;
  try {
    candidate = normalizeUrl(overrideValue);
  } catch {
    return { ok: false, url: null, source: "rejected_override", reason: "gateway_override_invalid_url" };
  }
  const explicitFixture = bool(env.STAGING_CERT_SYNTHETIC_LOOPBACK_FIXTURE, false);
  const allowed = explicitFixture
    && isLoopbackHost(candidate.hostname)
    && ["http:", "https:"].includes(candidate.protocol);
  return allowed
    ? { ok: true, url: candidate, source: "synthetic_loopback_fixture", reason: null }
    : {
      ok: false,
      url: null,
      source: "rejected_override",
      reason: explicitFixture ? "gateway_fixture_override_must_be_loopback" : "gateway_live_override_forbidden",
    };
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    let body = null;
    try { body = await response.json(); } catch { }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: String(error?.name || error?.code || "fetch_failed").slice(0, 128),
    };
  } finally {
    clearTimeout(timer);
  }
}

function canonicalPublicKeyPem(value) {
  const expanded = String(value || "").replaceAll("\\n", "\n").replaceAll("\r", "").trim();
  return expanded ? `${expanded}\n` : "";
}

function publicKeyEvidence(value) {
  const pem = canonicalPublicKeyPem(value);
  let ed25519 = false;
  if (pem) {
    try { ed25519 = createPublicKey(pem).asymmetricKeyType === "ed25519"; } catch { }
  }
  return {
    pem,
    ed25519,
    sha256: pem ? createHash("sha256").update(pem, "utf8").digest("hex") : null,
  };
}

function check(key, ok, detail = null) {
  return { key, ok: ok === true, detail };
}

const expectedCommit = String(process.env.STAGING_CERT_EXPECTED_COMMIT || "").trim().toLowerCase();
if (!SHA_RE.test(expectedCommit)) {
  console.error("STAGING_CERT_EXPECTED_COMMIT must be an exact lowercase 40-character SHA");
  process.exit(1);
}

const registry = readEnvironmentConvergenceRegistry();
let resolution;
try {
  resolution = loadActivationGatewayProfilePolicy("staging", { registry });
} catch (error) {
  console.error(String(error?.message || "activation_gateway_canonical_policy_unavailable"));
  process.exit(1);
}
if (!resolution?.validation?.ok || !resolution?.policy) {
  console.error("Canonical Staging Activation Gateway profile/policy is not current");
  process.exit(1);
}

const gatewayPolicy = resolution.policy;
const gatewayProfile = registry.profiles.staging.activation_gateway;
const expectedHost = String(gatewayPolicy.public_host || "").trim().toLowerCase();
const expectedAudience = String(gatewayPolicy.upstream_origin || "").trim();
const expectedIssuer = expectedHost ? `https://${expectedHost}` : "";
const expectedPolicyHash = String(gatewayProfile.expected_policy_hash || "").trim().toLowerCase();
const expectedReplayDirectory = "/app/data/recovery-ingress";
const appBase = normalizeUrl(process.env.STAGING_CERT_APP_BASE_URL, "https://dev.mad4b.com");
const probeTarget = resolveGatewayProbeTarget(process.env, gatewayPolicy);
if (!probeTarget.ok) {
  console.error(`Staging Gateway probe target rejected: ${probeTarget.reason}`);
  process.exit(1);
}

const appHealthUrl = new URL("/health", appBase);
appHealthUrl.searchParams.set("include_staging_trusted_ingress_readiness", "1");
const [appHealth, gatewayReady] = await Promise.all([
  fetchJson(appHealthUrl),
  fetchJson(new URL("/ready", probeTarget.url)),
]);

const appEvidence = appHealth.body?.staging_trusted_ingress_readiness || null;
const observed = appEvidence?.observed || {};
const gatewayTrust = gatewayReady.body?.recoveryTrustedIngress || null;
const gatewayPublicKey = publicKeyEvidence(gatewayTrust?.public_key);
const canonicalHosts = Array.isArray(observed.canonical_hosts)
  ? observed.canonical_hosts.map((value) => String(value || "").trim().toLowerCase())
  : [];

const checks = [
  check("app_health_reachable", appHealth.ok && appHealth.body?.ok === true, { status: appHealth.status, error: appHealth.error || null }),
  check("app_evidence_contract", appEvidence?.contract === STAGING_TRUSTED_INGRESS_CERTIFICATION_EVIDENCE_CONTRACT, appEvidence?.contract || null),
  check("app_evidence_available", appEvidence?.available === true && appEvidence?.environment === "staging", { available: appEvidence?.available ?? null, environment: appEvidence?.environment || null }),
  check("app_evidence_configured", appEvidence?.configured === true && appEvidence?.runtime_identity_ok === true, { configured: appEvidence?.configured ?? null, runtime_identity_ok: appEvidence?.runtime_identity_ok ?? null }),
  check("app_evidence_read_only", appEvidence?.read_only === true, appEvidence?.read_only ?? null),
  check("app_evidence_secret_free", appEvidence?.secrets_included === false && appEvidence?.raw_public_key_exposed === false, { secrets_included: appEvidence?.secrets_included ?? null, raw_public_key_exposed: appEvidence?.raw_public_key_exposed ?? null }),
  check("app_signature_mode", observed.attestation_mode === "signature", observed.attestation_mode || null),
  check("app_proxy_headers_enabled", observed.proxy_headers_enabled === true, observed.proxy_headers_enabled ?? null),
  check("app_caller_headers_stripped", observed.caller_headers_stripped === true, observed.caller_headers_stripped ?? null),
  check("app_public_key_ed25519", observed.public_key_configured === true && observed.public_key_ed25519 === true && DIGEST_RE.test(String(observed.public_key_sha256 || "")), { public_key_configured: observed.public_key_configured ?? null, public_key_ed25519: observed.public_key_ed25519 ?? null, public_key_sha256_present: DIGEST_RE.test(String(observed.public_key_sha256 || "")) }),
  check("app_key_id_valid", observed.key_id_valid === true && KEY_ID_RE.test(String(observed.key_id || "")), { key_id_present: Boolean(observed.key_id), key_id_valid: observed.key_id_valid ?? null }),
  check("app_canonical_host_exact", observed.canonical_host_policy_valid === true && canonicalHosts.length === 1 && canonicalHosts[0] === expectedHost, { expected: expectedHost, observed: canonicalHosts }),
  check("app_audience_exact", observed.audience === expectedAudience, { expected: expectedAudience, observed: observed.audience || null }),
  check("app_issuer_exact", observed.issuer === expectedIssuer, { expected: expectedIssuer, observed: observed.issuer || null }),
  check("app_deployment_sha_exact", observed.deployment_sha === expectedCommit, { expected: expectedCommit, observed: observed.deployment_sha || null }),
  check("app_replay_directory_exact", observed.replay_directory === expectedReplayDirectory, { expected: expectedReplayDirectory, observed: observed.replay_directory || null }),
  check("gateway_ready", gatewayReady.ok && gatewayReady.body?.ok === true && gatewayReady.body?.upstreamReady === true && gatewayReady.body?.upstreamEvidenceVerified === true, { status: gatewayReady.status, upstream_ready: gatewayReady.body?.upstreamReady ?? null, upstream_evidence_verified: gatewayReady.body?.upstreamEvidenceVerified ?? null, error: gatewayReady.error || gatewayReady.body?.error?.code || null }),
  check("gateway_policy_hash_exact", gatewayReady.body?.policyHash === expectedPolicyHash && gatewayTrust?.policy_hash === expectedPolicyHash, { expected: expectedPolicyHash, ready: gatewayReady.body?.policyHash || null, trust: gatewayTrust?.policy_hash || null }),
  check("gateway_deployment_sha_exact", gatewayReady.body?.upstreamSourceCommit === expectedCommit && gatewayTrust?.deployment_sha === expectedCommit && gatewayTrust?.source_commit === expectedCommit && gatewayTrust?.worker_build_sha === expectedCommit, { expected: expectedCommit, upstream: gatewayReady.body?.upstreamSourceCommit || null, trust: gatewayTrust?.deployment_sha || null }),
  check("gateway_trust_contract", gatewayTrust?.contract === "mad4b.staging.activation-recovery-origin-trust.v2", gatewayTrust?.contract || null),
  check("gateway_trust_identity_exact", gatewayTrust?.gateway_host === expectedHost && gatewayTrust?.canonical_host === expectedHost && gatewayTrust?.audience === expectedAudience && gatewayTrust?.issuer === expectedIssuer, { expected_host: expectedHost, observed_host: gatewayTrust?.canonical_host || null, expected_audience: expectedAudience, observed_audience: gatewayTrust?.audience || null, expected_issuer: expectedIssuer, observed_issuer: gatewayTrust?.issuer || null }),
  check("gateway_trust_mode_exact", gatewayTrust?.trusted_ingress_mode === "signature" && gatewayTrust?.strip_caller_headers === true && gatewayTrust?.replay_store_scope === "single_filesystem", { mode: gatewayTrust?.trusted_ingress_mode || null, strip_caller_headers: gatewayTrust?.strip_caller_headers ?? null, replay_store_scope: gatewayTrust?.replay_store_scope || null }),
  check("gateway_public_key_ed25519", gatewayPublicKey.ed25519 && DIGEST_RE.test(String(gatewayPublicKey.sha256 || "")), { public_key_ed25519: gatewayPublicKey.ed25519, public_key_sha256_present: DIGEST_RE.test(String(gatewayPublicKey.sha256 || "")) }),
  check("gateway_key_id_valid", KEY_ID_RE.test(String(gatewayTrust?.key_id || "")), { key_id_present: Boolean(gatewayTrust?.key_id) }),
  check("gateway_trust_secret_free", gatewayTrust?.provider_credentials_included === false && gatewayTrust?.production_deploy === false && gatewayTrust?.database_mutation === false && gatewayTrust?.secrets_included === false, { provider_credentials_included: gatewayTrust?.provider_credentials_included ?? null, production_deploy: gatewayTrust?.production_deploy ?? null, database_mutation: gatewayTrust?.database_mutation ?? null, secrets_included: gatewayTrust?.secrets_included ?? null }),
  check("app_gateway_key_id_match", observed.key_id === gatewayTrust?.key_id, { app_key_id: observed.key_id || null, gateway_key_id: gatewayTrust?.key_id || null }),
  check("app_gateway_public_key_match", observed.public_key_sha256 === gatewayPublicKey.sha256, { app_public_key_sha256: observed.public_key_sha256 || null, gateway_public_key_sha256: gatewayPublicKey.sha256 || null }),
];

const failed = checks.filter((entry) => !entry.ok);
const ready = failed.length === 0;
const envFile = String(process.env.STAGING_CERT_TRUST_ENV_FILE || "").trim();
let environmentBindingWritten = false;
if (ready && envFile) {
  const publicKeyEscaped = gatewayPublicKey.pem.replaceAll("\n", "\\n");
  const lines = [
    "REMOTE_MCP_TRUSTED_INGRESS_MODE=signature",
    "REMOTE_MCP_TRUST_PROXY_HOST_HEADERS=true",
    "REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS=true",
    `REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY=${publicKeyEscaped}`,
    `REMOTE_MCP_TRUSTED_INGRESS_KEY_ID=${gatewayTrust.key_id}`,
    `REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST=${expectedHost}`,
    `REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE=${expectedAudience}`,
    `REMOTE_MCP_TRUSTED_INGRESS_ISSUER=${expectedIssuer}`,
    `REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA=${expectedCommit}`,
    `RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY=${expectedReplayDirectory}`,
  ];
  await appendFile(envFile, `${lines.join("\n")}\n`, "utf8");
  environmentBindingWritten = true;
}

const report = {
  contract: CONTRACT,
  ready,
  expected: {
    deployment_sha: expectedCommit,
    gateway_host: expectedHost,
    audience: expectedAudience,
    issuer: expectedIssuer,
    policy_hash: expectedPolicyHash,
    replay_directory: expectedReplayDirectory,
  },
  sources: {
    app_health: appHealthUrl.origin,
    gateway_ready: probeTarget.url.origin,
    gateway_probe_source: probeTarget.source,
  },
  checks,
  blocking_failures: failed.map((entry) => entry.key),
  environment_binding_written: environmentBindingWritten,
  public_key_sha256: gatewayPublicKey.sha256,
  key_id: gatewayTrust?.key_id || null,
  safety: {
    read_only_remote_probe: true,
    replay_claim_performed: false,
    database_mutation: false,
    provider_mutation: false,
    production_mutation: false,
    raw_public_key_reported: false,
    secrets_included: false,
  },
};

console.log(JSON.stringify(report));
if (!ready) process.exitCode = 1;
