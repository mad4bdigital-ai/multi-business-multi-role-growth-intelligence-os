import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readinessEvidencePayload } from "../../http-generic-api/recoveryReadinessEvidence.js";
import { STAGING_RECOVERY_SIGNED_RECORD_CONTRACT } from "../../http-generic-api/stagingRecoveryCertificationPublicTrust.js";

export const STAGING_RECOVERY_GITHUB_SIGNING_AUTHORITY_CONTRACT = "mad4b.staging-recovery-github-signing-authority.v1";
export const STAGING_RECOVERY_GITHUB_VERIFICATION_REPORT_CONTRACT = "mad4b.staging-recovery-github-verification.v1";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function fail(code, message) {
  throw Object.assign(new Error(message), { code, details: { secrets_included: false } });
}

function assertGitHubHostedRuntime(env = process.env) {
  if (String(env.GITHUB_ACTIONS || "").toLowerCase() !== "true"
    || String(env.RUNNER_ENVIRONMENT || "").toLowerCase() !== "github-hosted") {
    fail("RECOVERY_CERTIFICATION_SIGNER_RUNTIME_DENIED", "Recovery certification private signing authority is restricted to GitHub-hosted Actions.");
  }
  if (env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REF_NAME !== "main") {
    fail("RECOVERY_CERTIFICATION_SIGNER_REF_DENIED", "Recovery certification signing is restricted to the main branch workflow authority.");
  }
}

function keyFingerprint(key) {
  return createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
}

function privateSigningKey(env = process.env) {
  const pem = String(env.RECOVERY_STAGING_CERTIFICATION_PRIVATE_KEY || "").trim();
  if (!pem) fail("RECOVERY_CERTIFICATION_PRIVATE_KEY_MISSING", "Recovery certification private key is unavailable to the GitHub-hosted signing step.");
  let key;
  try { key = createPrivateKey(pem); }
  catch { fail("RECOVERY_CERTIFICATION_PRIVATE_KEY_INVALID", "Recovery certification private key is invalid."); }
  if (key.asymmetricKeyType !== "ed25519") fail("RECOVERY_CERTIFICATION_PRIVATE_KEY_INVALID", "Recovery certification private key must use Ed25519.");
  return key;
}

function assertVerificationReport(report, { evidenceEnvelopeSha256, deploymentSha, certificationRunId, nonce }) {
  if (report?.contract !== STAGING_RECOVERY_GITHUB_VERIFICATION_REPORT_CONTRACT || report?.verified !== true || report?.secrets_included !== false) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_INVALID", "GitHub verification report is not signing-grade.");
  }
  if (report.evidence_envelope_sha256 !== evidenceEnvelopeSha256
    || report.deployment_sha !== deploymentSha
    || report.certification_run_id !== certificationRunId
    || report.nonce !== nonce) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_BINDING_MISMATCH", "GitHub verification report is not bound to the same evidence envelope/run/nonce/SHA.");
  }
  if (!SHA256.test(report.verification_report_sha256 || "")) fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_HASH_INVALID", "GitHub verification report hash is invalid.");
  const unsigned = { ...report };
  delete unsigned.verification_report_sha256;
  const actual = createHash("sha256").update(readinessEvidencePayload(unsigned)).digest("hex");
  if (actual !== report.verification_report_sha256) fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_HASH_MISMATCH", "GitHub verification report hash mismatch.");
}

export function signVerifiedStagingRecoveryCertification({ payload, verificationReport, env = process.env } = {}) {
  assertGitHubHostedRuntime(env);
  if (!payload || payload.environment !== "staging" || payload.branch !== "main" || payload.secrets_included !== false) {
    fail("RECOVERY_CERTIFICATION_PAYLOAD_INVALID", "Certification payload must be bounded to Staging/main and secret-free.");
  }
  if (!SHA40.test(payload.deployment_sha || "") || payload.deployment_sha !== env.GITHUB_SHA) {
    fail("RECOVERY_CERTIFICATION_EXACT_MAIN_MISMATCH", "Certification payload SHA must equal the exact GitHub-hosted workflow main SHA.");
  }
  if (!SHA256.test(payload.target_fingerprint || "") || !SHA256.test(payload.evidence_envelope_sha256 || "")) {
    fail("RECOVERY_CERTIFICATION_PAYLOAD_BINDING_INVALID", "Certification payload exact target/evidence binding is invalid.");
  }
  if (payload.production_live_enabled !== false || payload.production_mutation_performed !== false || payload.local_connector_production_authority !== false) {
    fail("RECOVERY_CERTIFICATION_PRODUCTION_BOUNDARY_INVALID", "Certification signer refuses Production authority claims.");
  }
  assertVerificationReport(verificationReport, {
    evidenceEnvelopeSha256: payload.evidence_envelope_sha256,
    deploymentSha: payload.deployment_sha,
    certificationRunId: payload.certification_run_id,
    nonce: payload.nonce,
  });
  if (payload.verification_report_sha256 !== verificationReport.verification_report_sha256) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_BINDING_MISMATCH", "Certification payload is not bound to the exact verification report.");
  }

  const key = privateSigningKey(env);
  const publicKey = createPublicKey(key);
  const ingressFingerprint = String(env.ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_SHA256 || "").trim().toLowerCase();
  const recoveryFingerprint = keyFingerprint(publicKey);
  if (ingressFingerprint && ingressFingerprint === recoveryFingerprint) {
    fail("RECOVERY_CERTIFICATION_KEY_REUSE_FORBIDDEN", "Recovery certification key must remain distinct from Activation Gateway ingress key.");
  }
  const encoded = readinessEvidencePayload(payload);
  const signature = sign(null, Buffer.from(encoded), key).toString("base64url");
  return Object.freeze({
    contract: STAGING_RECOVERY_SIGNED_RECORD_CONTRACT,
    authority_contract: STAGING_RECOVERY_GITHUB_SIGNING_AUTHORITY_CONTRACT,
    payload,
    payload_sha256: createHash("sha256").update(encoded).digest("hex"),
    signature,
    signing_public_key_sha256: recoveryFingerprint,
    signer_runtime: "github_hosted_actions",
    secrets_included: false,
  });
}
