import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { RECOVERY_REPLAY_STORE_CONTRACT } from "./recoveryReadinessEvidence.js";
import { resolveTrustedRequestHost } from "./trustedRequestHost.js";
import { resolveRuntimeEnvironment, resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";

const DEFAULT_ATTESTATION_HEADER = "x-mad4b-ingress-attestation";
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 30;
const DEFAULT_MAX_ATTESTATION_TTL_SECONDS = 90;
const MAX_CANONICAL_HOSTS = 16;

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function text(value, max = 256) {
  return String(value || "").trim().slice(0, max);
}

function trustedIngressPublicKey(env = process.env) {
  const configured = text(env?.REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY, 8192);
  if (!configured) return "";
  return configured.includes("\\n") ? configured.replaceAll("\\n", "\n") : configured;
}

function normalizeCanonicalHost(value) {
  const host = text(value, 256).toLowerCase();
  if (!host || host.includes("*") || host.includes(":") || host.includes("/") || host.includes("@")) return "";
  if (host.length > 253 || !/^[a-z0-9.-]+$/u.test(host)) return "";
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return "";
  const labels = host.split(".");
  if (labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return "";
  return host;
}

function trustedIngressCanonicalHostConfig(env = process.env) {
  const plural = text(env?.REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOSTS, 4096);
  const legacy = text(env?.REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST, 256);
  const rawEntries = plural ? plural.split(",").map((item) => item.trim()) : (legacy ? [legacy] : []);
  const normalized = rawEntries.map(normalizeCanonicalHost);
  const nonEmpty = normalized.filter(Boolean);
  const unique = [...new Set(nonEmpty)];
  const legacyNormalized = normalizeCanonicalHost(legacy);
  const valid = rawEntries.length > 0
    && rawEntries.length <= MAX_CANONICAL_HOSTS
    && rawEntries.every((item) => Boolean(item))
    && normalized.every(Boolean)
    && unique.length === normalized.length
    && (!plural || !legacy || unique.includes(legacyNormalized));
  return {
    valid,
    hosts: valid ? unique : [],
    source: plural ? "allowlist" : (legacy ? "legacy_single" : "missing"),
  };
}

function boundedSeconds(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

function baseReadiness(env = process.env) {
  const runtime = resolveRuntimeEnvironment(env);
  const environment = runtime.ok ? runtime.environment_key : null;
  const productionLike = environment === "production";
  const mode = text(env?.REMOTE_MCP_TRUSTED_INGRESS_MODE || "legacy_assertion", 32).toLowerCase();
  const proxyHeadersEnabled = flag(env?.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS);
  const stripCallerHeaders = flag(env?.REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS);
  const legacyAttested = flag(env?.REMOTE_MCP_TRUSTED_INGRESS_ATTESTED);
  const canonicalHosts = trustedIngressCanonicalHostConfig(env);
  return {
    environment,
    production_like: productionLike,
    runtime_identity_ok: runtime.ok,
    runtime_identity_reason: runtime.ok ? null : runtime.reason,
    runtime_identity: runtime.ok ? {
      environment_key: runtime.environment_key,
      runtime_class: runtime.runtime_class,
      runtime_class_explicit: runtime.runtime_class_explicit,
      deployment_model: runtime.deployment_model,
      branch: runtime.branch,
      authority_mode: runtime.authority_mode,
      public_gateway: runtime.public_gateway,
      upstream_service: runtime.upstream_service,
    } : null,
    attestation_mode: mode,
    proxy_headers_enabled: proxyHeadersEnabled,
    ingress_attested: mode === "signature" ? false : legacyAttested,
    caller_headers_stripped: stripCallerHeaders,
    canonical_host_policy: {
      source: canonicalHosts.source,
      host_count: canonicalHosts.hosts.length,
      hosts: canonicalHosts.hosts,
      valid: canonicalHosts.valid,
      secrets_included: false,
    },
    required_for_production: true,
    signed_attestation_configured: mode === "signature"
      && Boolean(trustedIngressPublicKey(env))
      && canonicalHosts.valid
      && canonicalHosts.hosts.length > 0
      && Boolean(text(env?.REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE, 256))
      && Boolean(text(env?.REMOTE_MCP_TRUSTED_INGRESS_ISSUER, 256))
      && Boolean(text(env?.REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA || env?.GIT_COMMIT_FULL, 64)),
    replay_protection: mode === "signature" ? "bounded_ttl_only" : "legacy_flag_assertion",
    secrets_included: false,
  };
}

function decodeBase64Url(value) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(normalized)) return null;
  try {
    return Buffer.from(normalized, "base64url");
  } catch {
    return null;
  }
}

function parseSignedAttestation(value) {
  if (typeof value !== "string" || value.length > 8192) return { ok: false, code: "attestation_format_invalid" };
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 2) return { ok: false, code: "attestation_format_invalid" };
  const payloadBytes = decodeBase64Url(parts[0]);
  const signatureBytes = decodeBase64Url(parts[1]);
  if (!payloadBytes || !signatureBytes) return { ok: false, code: "attestation_encoding_invalid" };
  let claims;
  try {
    claims = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { ok: false, code: "attestation_payload_invalid" };
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    return { ok: false, code: "attestation_claims_invalid" };
  }
  return { ok: true, payloadBytes, signatureBytes, claims };
}

function requestHeader(request, name) {
  if (request?.headers && typeof request.headers.get === "function") return request.headers.get(name);
  return request?.headers?.[name] || request?.headers?.[name.replaceAll("-", "_")];
}

function verifySignedAttestation(env, request) {
  const headerName = text(env?.REMOTE_MCP_TRUSTED_INGRESS_SIGNATURE_HEADER || DEFAULT_ATTESTATION_HEADER, 128).toLowerCase();
  const rawHeader = requestHeader(request, headerName);
  if (Array.isArray(rawHeader)) return { ok: false, code: "attestation_header_duplicated" };
  const parsed = parseSignedAttestation(rawHeader);
  if (!parsed.ok) return parsed;

  const publicKeyPem = trustedIngressPublicKey(env);
  const canonicalHosts = trustedIngressCanonicalHostConfig(env);
  const audience = text(env?.REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE, 256);
  const issuer = text(env?.REMOTE_MCP_TRUSTED_INGRESS_ISSUER, 256);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxSkew = boundedSeconds(env?.REMOTE_MCP_TRUSTED_INGRESS_MAX_CLOCK_SKEW_SECONDS, DEFAULT_MAX_CLOCK_SKEW_SECONDS, 300);
  const maxTtl = boundedSeconds(env?.REMOTE_MCP_TRUSTED_INGRESS_MAX_TTL_SECONDS, DEFAULT_MAX_ATTESTATION_TTL_SECONDS, 300);
  const claims = parsed.claims;
  const issuedAt = Number(claims.iat);
  const expiresAt = Number(claims.exp);
  const requestHost = normalizeCanonicalHost(resolveTrustedRequestHost(request, env));
  if (!publicKeyPem || !canonicalHosts.valid || canonicalHosts.hosts.length === 0 || !audience || !issuer) {
    return { ok: false, code: "attestation_configuration_incomplete" };
  }
  if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)) return { ok: false, code: "attestation_time_claims_invalid" };
  if (issuedAt > nowSeconds + maxSkew || expiresAt <= nowSeconds - maxSkew || expiresAt <= issuedAt || expiresAt - issuedAt > maxTtl) {
    return { ok: false, code: "attestation_expired_or_window_invalid" };
  }
  if (text(claims.iss, 256) !== issuer || text(claims.aud, 256) !== audience) {
    return { ok: false, code: "attestation_issuer_or_audience_invalid" };
  }
  const claimHost = normalizeCanonicalHost(claims.host);
  if (!requestHost || !canonicalHosts.hosts.includes(requestHost) || claimHost !== requestHost) {
    return { ok: false, code: "attestation_host_invalid" };
  }
  const expectedSha = text(env?.REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA || env?.GIT_COMMIT_FULL, 64).toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(expectedSha) || text(claims.deployment_sha, 64).toLowerCase() !== expectedSha) {
    return { ok: false, code: "attestation_deployment_sha_invalid" };
  }
  if (!text(claims.request_id, 256) || !text(claims.jti, 256) || !text(claims.key_id, 128)) {
    return { ok: false, code: "attestation_binding_claims_missing" };
  }
  let valid = false;
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return { ok: false, code: "attestation_key_invalid" };
    valid = verifySignature(null, parsed.payloadBytes, key, parsed.signatureBytes);
  } catch {
    return { ok: false, code: "attestation_key_invalid" };
  }
  if (!valid) return { ok: false, code: "attestation_signature_invalid" };
  return {
    ok: true,
    code: null,
    claims,
    key_id: text(claims.key_id, 128),
    canonical_host: requestHost,
    canonical_hosts: canonicalHosts.hosts,
    audience,
    expires_at: expiresAt,
    replay_protection: "bounded_ttl_only",
    secrets_included: false,
  };
}

export async function verifyRecoveryGatewayIngress({ env = process.env, request, policy, replayStore } = {}) {
  const runtime = resolveRuntimeEnvironmentStrict(env);
  if (!runtime.ok || runtime.environment_key !== "staging") return { ok: false, code: "ingress_runtime_invalid" };
  if (runtime.runtime_class !== "local_windows_docker" && replayStore?.scope !== "shared_deployment") {
    return { ok: false, code: "ingress_replay_scope_invalid" };
  }
  const proof = verifySignedAttestation(env, request);
  if (!proof.ok) return proof;
  const c = proof.claims;
  const requestPath = String(request?.originalUrl || request?.url || "");
  const authDigest = createHash("sha256").update(JSON.stringify([
    request?.headers?.authorization || "", request?.headers?.["x-api-key"] || "",
  ])).digest("hex");
  if (request?.method !== "GET" || !requestPath.startsWith("/admin/recovery/staging/") || requestPath.includes("?")
    || c.method !== request.method || c.path !== requestPath
    || c.request_id !== request.headers?.["x-request-id"]
    || c.policy_hash !== policy?.content_hash_sha256
    || c.worker_build_sha !== c.deployment_sha
    || !/^[a-f0-9]{64}$/.test(c.worker_bundle_sha256 || "")
    || c.auth_digest !== authDigest
    || c.body_digest !== createHash("sha256").update("").digest("hex")
    || request.headers?.["transfer-encoding"] || Number(request.headers?.["content-length"] || 0) !== 0
    || c.key_id !== env.REMOTE_MCP_TRUSTED_INGRESS_KEY_ID
    || c.exp <= Date.now() / 1000) return { ok: false, code: "ingress_request_binding_invalid" };
  if (replayStore?.contract !== RECOVERY_REPLAY_STORE_CONTRACT || typeof replayStore.claim !== "function") {
    return { ok: false, code: "ingress_replay_authority_missing" };
  }
  try {
    if (await replayStore.claim({ issuer: c.iss, key_id: c.key_id, jti: c.jti, expires_at: c.exp }) !== true) {
      return { ok: false, code: "ingress_replayed" };
    }
  } catch { return { ok: false, code: "ingress_replay_authority_unavailable" }; }
  return { ok: true, code: null, replay_protection: "durable_atomic_claim", secrets_included: false,
    build_identity: Object.freeze({ deployment_sha: c.deployment_sha, worker_build_sha: c.worker_build_sha,
      worker_bundle_sha256: c.worker_bundle_sha256, policy_hash: c.policy_hash,
      gateway_host: proof.canonical_host, expires_at: proof.expires_at }) };
}

export function buildTrustedIngressReadiness(env = process.env) {
  const readiness = baseReadiness(env);
  const ready = readiness.runtime_identity_ok
    && readiness.proxy_headers_enabled
    && readiness.ingress_attested
    && readiness.caller_headers_stripped;
  return {
    ...readiness,
    ready,
    failure_mode: ready ? "accepted" : (readiness.production_like ? "fail_closed" : "staging_attestation_pending"),
  };
}

export function assertTrustedIngressReadyForProduction(env = process.env, request = null) {
  const base = baseReadiness(env);
  let readiness = buildTrustedIngressReadiness(env);
  if (base.attestation_mode === "signature" && request) {
    const attestation = verifySignedAttestation(env, request);
    readiness = {
      ...readiness,
      ingress_attested: attestation.ok === true,
      signed_attestation: {
        verified: attestation.ok === true,
        failure_code: attestation.ok ? null : attestation.code,
        key_id: attestation.key_id || null,
        canonical_host: attestation.canonical_host || null,
        expires_at: attestation.expires_at || null,
        replay_protection: "bounded_ttl_only",
        secrets_included: false,
      },
      ready: base.runtime_identity_ok && base.proxy_headers_enabled && attestation.ok === true && base.caller_headers_stripped,
    };
    readiness.failure_mode = readiness.ready ? "accepted" : (base.production_like ? "fail_closed" : "staging_attestation_pending");
  }
  if (!base.runtime_identity_ok) {
    const error = new Error("Runtime identity is missing, unknown, or conflicting; trusted ingress cannot be established.");
    error.status = 503;
    error.code = "RUNTIME_IDENTITY_INVALID";
    error.details = readiness;
    throw error;
  }
  if (readiness.production_like && !readiness.ready) {
    const error = new Error("Trusted ingress attestation is required before production or canary OAuth metadata is served.");
    error.status = 503;
    error.code = "TRUSTED_INGRESS_ATTESTATION_REQUIRED";
    error.details = readiness;
    throw error;
  }
  return readiness;
}
