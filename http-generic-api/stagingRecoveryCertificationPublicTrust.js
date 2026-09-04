import { createHash, createPublicKey, verify } from "node:crypto";
import { readinessEvidencePayload } from "./recoveryReadinessEvidence.js";

export const STAGING_RECOVERY_CERTIFICATION_TRUST_CONTRACT = "mad4b.staging-recovery-certification-public-trust.v2";
export const STAGING_RECOVERY_SIGNED_RECORD_CONTRACT = "mad4b.staging-recovery-signed-certification.v1";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{8,160}$/u;

function fail(code, message) {
  throw Object.assign(new Error(message), { code, status: 503, details: { secrets_included: false } });
}

function fingerprint(key) {
  return createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
}

function normalizePublicKey(value, code) {
  let key;
  try { key = createPublicKey(value); }
  catch { fail(code, "Recovery certification public key is invalid."); }
  if (key.asymmetricKeyType !== "ed25519") fail(code, "Recovery certification trust must use Ed25519.");
  return key;
}

export function loadStagingRecoveryCertificationPublicTrust(env = process.env) {
  const publicKeyPem = String(env.RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY || "").trim();
  const keyId = String(env.RECOVERY_STAGING_CERTIFICATION_KEY_ID || "").trim();
  const issuer = String(env.RECOVERY_STAGING_CERTIFICATION_ISSUER || "").trim();
  const configured = [publicKeyPem, keyId, issuer].filter(Boolean).length;
  if (configured === 0) return null;
  if (configured !== 3) fail("RECOVERY_CERTIFICATION_TRUST_INCOMPLETE", "Recovery certification public trust must be configured atomically.");
  if (!SAFE_ID.test(keyId)) fail("RECOVERY_CERTIFICATION_KEY_ID_INVALID", "Recovery certification key ID is invalid.");
  if (!issuer) fail("RECOVERY_CERTIFICATION_ISSUER_INVALID", "Recovery certification issuer is invalid.");

  const publicKey = normalizePublicKey(publicKeyPem, "RECOVERY_CERTIFICATION_PUBLIC_KEY_INVALID");
  const ingressPem = String(env.REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY || "").trim();
  if (!ingressPem) {
    fail("RECOVERY_CERTIFICATION_INGRESS_TRUST_UNAVAILABLE", "Activation Gateway ingress public trust is required before Phase B certification trust can be enabled.");
  }
  const ingressKey = normalizePublicKey(ingressPem, "RECOVERY_CERTIFICATION_INGRESS_KEY_INVALID");
  if (fingerprint(ingressKey) === fingerprint(publicKey)) {
    fail("RECOVERY_CERTIFICATION_KEY_REUSE_FORBIDDEN", "Recovery certification public trust must be distinct from Activation Gateway ingress trust.");
  }

  return Object.freeze({
    contract: STAGING_RECOVERY_CERTIFICATION_TRUST_CONTRACT,
    publicKey: publicKeyPem,
    keyId,
    issuer,
    public_key_sha256: fingerprint(publicKey),
    activation_gateway_ingress_public_key_sha256: fingerprint(ingressKey),
    separate_from_activation_gateway_ingress: true,
    separation_verified: true,
    secrets_included: false,
  });
}

export function verifyStagingRecoverySignedCertificationRecord(record, {
  trust,
  expectedSha,
  expectedTargetFingerprint,
  expectedRunId,
  expectedNonce,
  now = Date.now(),
} = {}) {
  if (!trust || trust.contract !== STAGING_RECOVERY_CERTIFICATION_TRUST_CONTRACT || trust.separation_verified !== true) {
    fail("RECOVERY_CERTIFICATION_TRUST_UNAVAILABLE", "Recovery certification public trust is unavailable or ingress-key separation was not verified.");
  }
  if (record?.contract !== STAGING_RECOVERY_SIGNED_RECORD_CONTRACT || record?.secrets_included !== false) fail("RECOVERY_CERTIFICATION_RECORD_INVALID", "Signed Recovery certification record is invalid.");
  const payload = record.payload;
  if (!payload || payload.contract !== "mad4b.recovery-readiness-evidence.v1" || payload.secrets_included !== false || payload.environment !== "staging" || payload.branch !== "main") {
    fail("RECOVERY_CERTIFICATION_PAYLOAD_INVALID", "Recovery certification payload is not canonical Staging/main evidence.");
  }
  if (!SHA40.test(payload.deployment_sha || "") || payload.deployment_sha !== expectedSha) fail("RECOVERY_CERTIFICATION_SHA_MISMATCH", "Recovery certification exact SHA mismatch.");
  if (!SHA256.test(payload.target_fingerprint || "") || payload.target_fingerprint !== expectedTargetFingerprint) fail("RECOVERY_CERTIFICATION_TARGET_MISMATCH", "Recovery certification target fingerprint mismatch.");
  if (!SAFE_ID.test(payload.certification_run_id || "") || payload.certification_run_id !== expectedRunId) fail("RECOVERY_CERTIFICATION_RUN_MISMATCH", "Recovery certification run identity mismatch.");
  if (!SAFE_ID.test(payload.nonce || "") || payload.nonce !== expectedNonce) fail("RECOVERY_CERTIFICATION_NONCE_MISMATCH", "Recovery certification nonce mismatch.");
  if (payload.issuer !== trust.issuer || payload.key_id !== trust.keyId) fail("RECOVERY_CERTIFICATION_SIGNER_MISMATCH", "Recovery certification signer identity mismatch.");
  if (!Number.isFinite(Date.parse(payload.generated_at)) || !Number.isFinite(Date.parse(payload.expires_at))
    || Date.parse(payload.generated_at) > now + 60_000 || Date.parse(payload.expires_at) <= now) {
    fail("RECOVERY_CERTIFICATION_FRESHNESS_INVALID", "Recovery certification is stale or future-dated.");
  }
  if (!SHA256.test(payload.evidence_envelope_sha256 || "") || !SHA256.test(payload.verification_report_sha256 || "")) fail("RECOVERY_CERTIFICATION_BINDING_HASH_INVALID", "Recovery certification binding hashes are invalid.");
  if (payload.production_live_enabled !== false || payload.production_mutation_performed !== false || payload.local_connector_production_authority !== false) fail("RECOVERY_CERTIFICATION_PRODUCTION_BOUNDARY_INVALID", "Recovery certification attempted to cross the Production boundary.");
  if (!/^[A-Za-z0-9_-]{86}$/u.test(record.signature || "")) fail("RECOVERY_CERTIFICATION_SIGNATURE_INVALID", "Recovery certification signature encoding is invalid.");

  const key = normalizePublicKey(trust.publicKey, "RECOVERY_CERTIFICATION_PUBLIC_KEY_INVALID");
  const valid = verify(null, Buffer.from(readinessEvidencePayload(payload)), key, Buffer.from(record.signature, "base64url"));
  if (!valid) fail("RECOVERY_CERTIFICATION_SIGNATURE_INVALID", "Recovery certification signature is invalid.");
  const payloadSha256 = createHash("sha256").update(readinessEvidencePayload(payload)).digest("hex");
  if (record.payload_sha256 !== payloadSha256) fail("RECOVERY_CERTIFICATION_PAYLOAD_HASH_MISMATCH", "Recovery certification payload hash mismatch.");

  return Object.freeze({
    valid: true,
    payload,
    payload_sha256: payloadSha256,
    public_key_sha256: trust.public_key_sha256,
    ingress_key_separation_verified: true,
    secrets_included: false,
  });
}
