import { createHash, createPublicKey, verify } from "node:crypto";
import { verifyRecoveryExternalEvidenceIntegrity } from "./recoveryReadinessEvidence.js";

export const RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT = "mad4b.recovery-external-acquisition-receipt.v1";
export const RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_CONTRACT = "mad4b.recovery-external-acquisition-authority.v1";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{8,200}$/u;
const B64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const authorities = new WeakSet();

const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;

export const recoveryExternalAcquisitionCanonicalJson = (value) => JSON.stringify(stable(value));
export const recoveryExternalAcquisitionHash = (value) => createHash("sha256")
  .update(recoveryExternalAcquisitionCanonicalJson(value))
  .digest("hex");

function receiptPayload(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
  const payload = { ...receipt };
  delete payload.signature_b64url;
  return payload;
}

function invalid(reasonCode, details = {}) {
  return Object.freeze({
    contract: RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_CONTRACT,
    verified: false,
    reason_code: reasonCode,
    details: Object.freeze({ ...details, secrets_included: false }),
    secrets_included: false,
  });
}

function validateFreshness(receipt, now) {
  const issued = Date.parse(receipt?.issued_at || "");
  const expires = Date.parse(receipt?.expires_at || "");
  return Number.isFinite(issued)
    && Number.isFinite(expires)
    && issued <= now + 60_000
    && expires > now
    && expires > issued
    && expires - issued <= 3_600_000;
}

function expectedObservation(kind) {
  return {
    registration: { source: "chatgpt_live_readback", evidenceKind: "chatgpt_registration" },
    oauth: { source: "oauth_server_correlation", evidenceKind: "oauth_browser_round_trip" },
    network: { source: "independent_network_probe", evidenceKind: "origin_network_isolation" },
  }[kind];
}

export function createRecoveryExternalAcquisitionAuthority({
  publicKey,
  keyId,
  issuer,
  now = () => Date.now(),
} = {}) {
  if (!publicKey || !keyId || !issuer) {
    throw Object.assign(new Error("Recovery external acquisition trust is incomplete."), {
      code: "RECOVERY_EXTERNAL_ACQUISITION_TRUST_UNAVAILABLE",
      status: 503,
    });
  }
  const verificationKey = createPublicKey(publicKey);
  if (verificationKey.asymmetricKeyType !== "ed25519") {
    throw Object.assign(new Error("Recovery external acquisition trust requires Ed25519."), {
      code: "RECOVERY_EXTERNAL_ACQUISITION_KEY_INVALID",
      status: 503,
    });
  }

  const authority = Object.freeze({
    contract: RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_CONTRACT,
    async verify({
      receipt,
      registrationEvidence,
      oauthEvidence,
      networkEvidence,
      expectedSha,
      expectedTargetFingerprint,
    } = {}) {
      if (!receipt || receipt.contract !== RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_CONTRACT) {
        return invalid("RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_REQUIRED");
      }
      if (receipt.environment !== "staging"
        || !SHA40.test(expectedSha || "")
        || !SHA256.test(expectedTargetFingerprint || "")
        || receipt.deployment_sha !== expectedSha
        || receipt.target_fingerprint !== expectedTargetFingerprint) {
        return invalid("RECOVERY_EXTERNAL_ACQUISITION_TARGET_MISMATCH");
      }
      if (receipt.issuer !== issuer || receipt.key_id !== keyId || !SAFE_ID.test(receipt.acquisition_run_id || "")) {
        return invalid("RECOVERY_EXTERNAL_ACQUISITION_TRUST_MISMATCH");
      }
      if (receipt.secrets_included !== false || !validateFreshness(receipt, now())) {
        return invalid("RECOVERY_EXTERNAL_ACQUISITION_RECEIPT_EXPIRED");
      }
      if (!B64URL_SIGNATURE.test(receipt.signature_b64url || "")) {
        return invalid("RECOVERY_EXTERNAL_ACQUISITION_SIGNATURE_INVALID");
      }
      const payload = receiptPayload(receipt);
      if (!verify(
        null,
        Buffer.from(recoveryExternalAcquisitionCanonicalJson(payload)),
        verificationKey,
        Buffer.from(receipt.signature_b64url, "base64url"),
      )) {
        return invalid("RECOVERY_EXTERNAL_ACQUISITION_SIGNATURE_INVALID");
      }

      const evidenceByKind = {
        registration: registrationEvidence,
        oauth: oauthEvidence,
        network: networkEvidence,
      };
      for (const kind of Object.keys(evidenceByKind)) {
        const evidence = evidenceByKind[kind];
        const observation = receipt.observations?.[kind];
        const expected = expectedObservation(kind);
        if (!observation || observation.verified !== true
          || observation.source !== expected.source
          || !SAFE_ID.test(observation.observation_id || "")
          || !SHA256.test(observation.evidence_hash || "")
          || !SHA256.test(observation.source_proof_hash || "")
          || evidence?.source_provenance?.observation_id !== observation.observation_id
          || evidence?.source_provenance?.source !== expected.source
          || evidence?.evidence_kind !== expected.evidenceKind
          || evidence?.evidence_hash !== observation.evidence_hash
          || evidence?.source_proof_hash !== observation.source_proof_hash
          || !verifyRecoveryExternalEvidenceIntegrity(evidence, {
            kind,
            expectedSha,
            expectedTargetFingerprint,
          })) {
          return invalid("RECOVERY_EXTERNAL_ACQUISITION_EVIDENCE_BINDING_INVALID", { kind });
        }
      }

      return Object.freeze({
        contract: RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_CONTRACT,
        verified: true,
        reason_code: null,
        acquisition_run_id: receipt.acquisition_run_id,
        issuer: receipt.issuer,
        key_id: receipt.key_id,
        receipt_sha256: recoveryExternalAcquisitionHash(receiptPayload(receipt)),
        deployment_sha: expectedSha,
        target_fingerprint: expectedTargetFingerprint,
        secrets_included: false,
      });
    },
  });
  authorities.add(authority);
  return authority;
}

export function isRecoveryExternalAcquisitionAuthority(value) {
  return authorities.has(value);
}

export function createRecoveryExternalAcquisitionAuthorityFromEnv(env = process.env) {
  const publicKey = String(env.STAGING_RECOVERY_ACQUISITION_PUBLIC_KEY || "").trim().replace(/\\n/g, "\n");
  const keyId = String(env.STAGING_RECOVERY_ACQUISITION_KEY_ID || "").trim();
  const issuer = String(env.STAGING_RECOVERY_ACQUISITION_ISSUER || "").trim();
  if (!publicKey && !keyId && !issuer) return null;
  return createRecoveryExternalAcquisitionAuthority({ publicKey, keyId, issuer });
}
