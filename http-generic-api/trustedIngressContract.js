import { createPublicKey, verify as verifySignature } from "node:crypto";
import { resolveTrustedRequestHost } from "./trustedRequestHost.js";

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
  const environment = String(env?.NODE_ENV || env?.REMOTE_MCP_ENVIRONMENT || "staging").trim().toLowerCase();
  const productionLike = ["production", "prod", "canary"].includes(environment);
  const mode = text(env?.REMOTE_MCP_TRUSTED_INGRESS_MODE || "legacy_assertion", 32).toLowerCase();
  const proxyHeadersEnabled = flag(env?.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS);
  const stripCallerHeaders = flag(env?.REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS);
  const legacyAttested = flag(env?.REMOTE_MCP_TRUSTED_INGRESS_ATTESTED);
  return {
    environment,
    production_like: productionLike,
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
    valid = verifySignature(null, parsed.payloadBytes, createPublicKey(publicKeyPem), parsed.signatureBytes);
  } catch {
    return { ok: false, code: "attestation_key_invalid" };
  }
  if (!valid) return { ok: false, code: "attestation_signature_invalid" };
  return {
    ok: true,
    code: null,
    key_id: text(claims.key_id, 128),
    canonical_host: canonicalHost,
    audience,
    expires_at: expiresAt,
    replay_protection: "bounded_ttl_only",
    secrets_included: false,
  };
}

export function buildTrustedIngressReadiness(env = process.env) {
  const readiness = baseReadiness(env);
  const ready = readiness.proxy_headers_enabled
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
      ready: base.proxy_headers_enabled && attestation.ok === true && base.caller_headers_stripped,
    };
    readiness.failure_mode = readiness.ready ? "accepted" : (base.production_like ? "fail_closed" : "staging_attestation_pending");
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
