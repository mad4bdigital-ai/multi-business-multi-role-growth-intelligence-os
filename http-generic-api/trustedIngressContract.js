import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { RECOVERY_REPLAY_STORE_CONTRACT } from "./recoveryReadinessEvidence.js";
import { resolveTrustedRequestHost } from "./trustedRequestHost.js";
import { resolveRuntimeEnvironment } from "./runtimeEnvironmentResolver.js";

const DEFAULT_ATTESTATION_HEADER = "x-mad4b-ingress-attestation";
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 30;
const DEFAULT_MAX_ATTESTATION_TTL_SECONDS = 90;

function flag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function text(value, max = 256) {
  return String(value || "").trim().slice(0, max);
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
  return {
    environment,
    production_like: productionLike,
    runtime_identity_ok: runtime.ok,
    runtime_identity_reason: runtime.ok ? null : runtime.reason,
    runtime_identity: runtime.ok ? {
      environment_key: runtime.environment_key,
      runtime_class: runtime.runtime_class,
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
    required_for_production: true,
    signed_attestation_configured: mode === "signature"
      && Boolean(text(env?.REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY, 8192))
      && Boolean(text(env?.REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST, 256))
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

function verifySignedAttestation(env, request) {
  const headerName = text(env?.REMOTE_MCP_TRUSTED_INGRESS_SIGNATURE_HEADER || DEFAULT_ATTESTATION_HEADER, 128).toLowerCase();
  const rawHeader = request?.headers?.[headerName] || request?.headers?.[headerName.replaceAll("-", "_")];
  if (Array.isArray(rawHeader)) return { ok: false, code: "attestation_header_duplicated" };
  const parsed = parseSignedAttestation(rawHeader);
  if (!parsed.ok) return parsed;

  const publicKeyPem = text(env?.REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY, 8192);
  const canonicalHost = text(env?.REMOTE_MCP_TRUSTED_INGRESS_CANONICAL_HOST, 256).toLowerCase();
  const audience = text(env?.REMOTE_MCP_TRUSTED_INGRESS_AUDIENCE, 256);
  const issuer = text(env?.REMOTE_MCP_TRUSTED_INGRESS_ISSUER, 256);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxSkew = boundedSeconds(env?.REMOTE_MCP_TRUSTED_INGRESS_MAX_CLOCK_SKEW_SECONDS, DEFAULT_MAX_CLOCK_SKEW_SECONDS, 300);
  const maxTtl = boundedSeconds(env?.REMOTE_MCP_TRUSTED_INGRESS_MAX_TTL_SECONDS, DEFAULT_MAX_ATTESTATION_TTL_SECONDS, 300);
  const claims = parsed.claims;
  const issuedAt = Number(claims.iat);
  const expiresAt = Number(claims.exp);
  const requestHost = resolveTrustedRequestHost(request, env);
  if (!publicKeyPem || !canonicalHost || !audience || !issuer) return { ok: false, code: "attestation_configuration_incomplete" };
  if (!Number.isInteger(issuedAt) || !Number.isInteger(expiresAt)) return { ok: false, code: "attestation_time_claims_invalid" };
  if (issuedAt > nowSeconds + maxSkew || expiresAt <= nowSeconds - maxSkew || expiresAt <= issuedAt || expiresAt - issuedAt > maxTtl) {
    return { ok: false, code: "attestation_expired_or_window_invalid" };
  }
  if (text(claims.iss, 256) !== issuer || text(claims.aud, 256) !== audience) {
    return { ok: false, code: "attestation_issuer_or_audience_invalid" };
  }
  if (text(claims.host, 256).toLowerCase() !== canonicalHost || requestHost !== canonicalHost) {
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
    canonical_host: canonicalHost,
    audience,
    expires_at: expiresAt,
    replay_protection: "bounded_ttl_only",
    secrets_included: false,
  };
}

// Recovery is stricter than legacy OAuth metadata: host assertions and legacy
// mode never confer provenance. The durable claim is consumed after ALL bindings.
export async function verifyRecoveryGatewayIngress({ env = process.env, request, policy, replayStore } = {}) {
  const runtime = resolveRuntimeEnvironment(env);
  if (!runtime.ok || runtime.environment_key !== "staging") return { ok: false, code: "ingress_runtime_invalid" };
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
  return { ok: true, code: null, replay_protection: "durable_atomic_claim", secrets_included: false };
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
