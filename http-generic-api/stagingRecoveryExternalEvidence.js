import { createHash, randomUUID } from "node:crypto";
import {
  RECOVERY_EXTERNAL_EVIDENCE_CONTRACT,
  recoveryExternalEvidenceHash,
  verifyRecoveryExternalEvidenceIntegrity,
} from "./recoveryReadinessEvidence.js";
import {
  TENANT_GPT_OAUTH_CORRELATION_STAGES,
  verifyTenantGptOAuthOperationCorrelation,
} from "./tenantGptOAuthOperationCorrelation.js";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{8,160}$/u;

const KIND = Object.freeze({
  registration: Object.freeze({ evidence_kind: "chatgpt_registration", source: "chatgpt_live_readback" }),
  oauth: Object.freeze({ evidence_kind: "oauth_browser_round_trip", source: "oauth_server_correlation" }),
  network: Object.freeze({ evidence_kind: "origin_network_isolation", source: "independent_network_probe" }),
});

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const hash = (value) => createHash("sha256").update(
  typeof value === "string" ? value : JSON.stringify(stable(value)),
).digest("hex");

function fail(code, message) {
  throw Object.assign(new Error(message), { code, status: 409, details: { secrets_included: false } });
}

export function buildStagingRecoveryExternalObservation({
  kind,
  payload = {},
  deploymentSha,
  targetFingerprint,
  observationId = `recovery-${kind}-${randomUUID()}`,
  sourceProofHash,
  observedAt = new Date().toISOString(),
  expiresAt = new Date(Date.now() + 15 * 60_000).toISOString(),
} = {}) {
  const spec = KIND[kind];
  if (!spec || !SHA40.test(deploymentSha || "") || !SHA256.test(targetFingerprint || "")
    || !SAFE_ID.test(observationId || "") || !SHA256.test(sourceProofHash || "")) {
    fail("RECOVERY_EXTERNAL_OBSERVATION_INPUT_INVALID", "External observation binding is invalid.");
  }
  const base = {
    ...payload,
    contract: RECOVERY_EXTERNAL_EVIDENCE_CONTRACT,
    evidence_kind: spec.evidence_kind,
    source_provenance: Object.freeze({
      source: spec.source,
      observation_id: observationId,
    }),
    source_proof_hash: sourceProofHash,
    deployment_sha: deploymentSha,
    target_fingerprint: targetFingerprint,
    observed_at: observedAt,
    expires_at: expiresAt,
    secrets_included: false,
  };
  const evidence = Object.freeze({ ...base, evidence_hash: recoveryExternalEvidenceHash(base) });
  if (!verifyRecoveryExternalEvidenceIntegrity(evidence, {
    kind,
    expectedSha: deploymentSha,
    expectedTargetFingerprint: targetFingerprint,
  })) {
    fail("RECOVERY_EXTERNAL_OBSERVATION_INTEGRITY_INVALID", `${kind} evidence failed canonical integrity verification.`);
  }
  return evidence;
}

export function verifyOAuthCorrelationChain(chain, {
  expectedResource = "https://activation-dev.mad4b.com",
  now = Date.now(),
  maxAgeMs = 15 * 60_000,
} = {}) {
  if (!Array.isArray(chain) || chain.length !== TENANT_GPT_OAUTH_CORRELATION_STAGES.length) {
    fail("RECOVERY_OAUTH_CORRELATION_CHAIN_INCOMPLETE", "A complete OAuth correlation chain is required.");
  }
  const normalized = chain.map((entry, index) => verifyTenantGptOAuthOperationCorrelation(entry, {
    expected_resource: expectedResource,
    expected_stage: TENANT_GPT_OAUTH_CORRELATION_STAGES[index],
  }));
  const first = normalized[0];
  for (let index = 0; index < normalized.length; index += 1) {
    const entry = normalized[index];
    if (entry.operation_id !== first.operation_id
      || entry.correlation_id !== first.correlation_id
      || entry.client_id_sha256 !== first.client_id_sha256
      || entry.protected_resource !== first.protected_resource
      || (index > 0 && entry.previous_envelope_sha256 !== normalized[index - 1].envelope_sha256)) {
      fail("RECOVERY_OAUTH_CORRELATION_CHAIN_MISMATCH", "OAuth correlation identity or digest chain changed.");
    }
  }
  const last = normalized.at(-1);
  if (!last.subject_user_sha256 || !last.subject_tenant_sha256
    || !last.oauth_code_jti_sha256 || !last.access_token_jti_sha256) {
    fail("RECOVERY_OAUTH_CORRELATION_BINDING_INCOMPLETE", "OAuth correlation is missing subject/code/token bindings.");
  }
  const updated = Date.parse(last.updated_at);
  if (!Number.isFinite(updated) || updated > now + 60_000 || updated < now - maxAgeMs) {
    fail("RECOVERY_OAUTH_CORRELATION_STALE", "OAuth correlation chain is outside the freshness window.");
  }
  return Object.freeze({
    chain: Object.freeze(normalized),
    operation_id: first.operation_id,
    correlation_id: first.correlation_id,
    source_proof_hash: hash(normalized.map((entry) => entry.envelope_sha256)),
    updated_at: last.updated_at,
    secrets_included: false,
  });
}

export function buildOAuthServerCorrelationEvidence({
  chain,
  deploymentSha,
  targetFingerprint,
  observedAt = new Date().toISOString(),
  expiresAt = new Date(Date.now() + 15 * 60_000).toISOString(),
} = {}) {
  const verified = verifyOAuthCorrelationChain(chain);
  return buildStagingRecoveryExternalObservation({
    kind: "oauth",
    deploymentSha,
    targetFingerprint,
    observationId: `oauth-${verified.correlation_id}`,
    sourceProofHash: verified.source_proof_hash,
    observedAt,
    expiresAt,
    payload: {
      issuer: "https://dev.mad4b.com",
      resource: "https://activation-dev.mad4b.com",
      operation_id: verified.operation_id,
      correlation_id: verified.correlation_id,
      correlation_chain_sha256: verified.source_proof_hash,
      steps: Object.freeze({
        authorize: "pass",
        login_consent: "pass",
        code: "pass",
        callback: "pass",
        token: "pass",
        resource: "pass",
      }),
      server_correlation_verified: true,
    },
  });
}

export function buildNetworkIsolationEvidence({
  direct,
  gateway,
  deploymentSha,
  targetFingerprint,
  gatewayHost = "activation-dev.mad4b.com",
  upstreamOrigin = "https://dev.mad4b.com",
  observedAt = new Date().toISOString(),
  expiresAt = new Date(Date.now() + 15 * 60_000).toISOString(),
} = {}) {
  const path = String(direct?.path || "");
  const method = String(direct?.method || "").toUpperCase();
  const bodySha256 = String(direct?.body_sha256 || "");
  if (gateway?.path !== path || String(gateway?.method || "").toUpperCase() !== method
    || gateway?.body_sha256 !== bodySha256) {
    fail("RECOVERY_NETWORK_SAME_REQUEST_MISMATCH", "Direct and Gateway observations must bind the same request.");
  }
  if (direct?.status !== 403 || direct?.reason !== "RECOVERY_TRUSTED_INGRESS_REQUIRED"
    || !Number.isInteger(gateway?.status) || gateway.status < 200 || gateway.status >= 300) {
    fail("RECOVERY_NETWORK_ISOLATION_NOT_PROVEN", "Protected direct denial and signed Gateway success are required.");
  }
  const sourceProofHash = hash({ direct, gateway });
  return buildStagingRecoveryExternalObservation({
    kind: "network",
    deploymentSha,
    targetFingerprint,
    observationId: `network-${sourceProofHash.slice(0, 32)}`,
    sourceProofHash,
    observedAt,
    expiresAt,
    payload: {
      environment: "staging",
      gateway_host: gatewayHost,
      upstream_origin: upstreamOrigin,
      gateway_only: true,
      signed_ingress_required: true,
      network_restriction_verified: true,
      direct_recovery_surface_bypass_denied: true,
      request_method: method,
      request_body_sha256: bodySha256,
      direct_recovery_surface_status: direct.status,
      direct_recovery_surface_reason: direct.reason,
      direct_recovery_surface_path: path,
      signed_gateway_recovery_path: gateway.path,
      signed_gateway_recovery_method: String(gateway.method).toUpperCase(),
      signed_gateway_recovery_body_sha256: gateway.body_sha256,
      signed_gateway_recovery_status: gateway.status,
      public_health_status: gateway.public_health_status ?? null,
    },
  });
}

export function recoveryExternalObservationReceiptBinding(evidence) {
  if (!evidence || !SHA256.test(evidence.evidence_hash || "") || !SHA256.test(evidence.source_proof_hash || "")) {
    fail("RECOVERY_EXTERNAL_OBSERVATION_RECEIPT_BINDING_INVALID", "Evidence cannot be bound into an acquisition receipt.");
  }
  return Object.freeze({
    observation_id: evidence.source_provenance?.observation_id,
    source: evidence.source_provenance?.source,
    evidence_hash: evidence.evidence_hash,
    source_proof_hash: evidence.source_proof_hash,
    verified: true,
  });
}
