import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  RECOVERY_READINESS_EVIDENCE_CONTRACT,
  readinessEvidencePayload,
} from "../../http-generic-api/recoveryReadinessEvidence.js";
import { STAGING_RECOVERY_SIGNED_RECORD_CONTRACT } from "../../http-generic-api/stagingRecoveryCertificationPublicTrust.js";

export const STAGING_RECOVERY_GITHUB_SIGNING_AUTHORITY_CONTRACT = "mad4b.staging-recovery-github-signing-authority.v2";
export const STAGING_RECOVERY_GITHUB_VERIFICATION_REPORT_CONTRACT = "mad4b.staging-recovery-github-verification.v2";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:-]{8,160}$/u;
const REQUIRED_VERIFICATION_CHECKS = Object.freeze([
  "exact_main",
  "workflow_source_same_sha",
  "evidence_envelope_hash",
  "target_binding",
  "run_nonce_binding",
  "worker_provenance",
  "artifact_integrity",
  "evidence_freshness",
  "external_evidence",
  "production_boundary",
  "secret_scan",
]);

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
  if (!SHA40.test(String(env.GITHUB_SHA || ""))) {
    fail("RECOVERY_CERTIFICATION_SIGNER_SHA_INVALID", "GitHub workflow authority must expose an exact main SHA.");
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

function requiredSignerIdentity(env = process.env) {
  const issuer = String(env.RECOVERY_STAGING_CERTIFICATION_ISSUER || "").trim();
  const keyId = String(env.RECOVERY_STAGING_CERTIFICATION_KEY_ID || "").trim();
  if (!issuer || !SAFE_ID.test(keyId)) {
    fail("RECOVERY_CERTIFICATION_SIGNER_IDENTITY_MISSING", "Recovery certification issuer and key ID are required and must be governed.");
  }
  return { issuer, keyId };
}

function assertNoSecretShapedFields(value, path = "payload") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (normalized !== "secrets_included"
      && /(password|secret|credential|authorization|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)/u.test(normalized)) {
      fail("RECOVERY_CERTIFICATION_SECRET_SHAPED_FIELD_FORBIDDEN", `Signing payload contains forbidden secret-shaped field: ${path}.${key}`);
    }
    if (child && typeof child === "object") assertNoSecretShapedFields(child, `${path}.${key}`);
  }
}

function assertFreshness(payload, now = Date.now()) {
  const generated = Date.parse(payload.generated_at);
  const expires = Date.parse(payload.expires_at);
  if (!Number.isFinite(generated) || !Number.isFinite(expires)
    || generated > now + 60_000
    || expires <= now
    || expires <= generated
    || expires - generated > 24 * 60 * 60 * 1000) {
    fail("RECOVERY_CERTIFICATION_FRESHNESS_INVALID", "Certification payload freshness window is invalid.");
  }
}

function assertStagingCertification(certification, payload) {
  if (certification?.contract !== "mad4b.recovery-staging-certification.v1"
    || certification?.status !== "passed"
    || certification?.result !== "pass"
    || certification?.environment_key !== "staging"
    || certification?.branch !== "main"
    || certification?.deployment_sha !== payload.deployment_sha
    || certification?.target_fingerprint !== payload.target_fingerprint
    || certification?.secrets_included !== false
    || certification?.safety?.production_mutation_performed !== false
    || certification?.safety?.caller_credentials_accepted !== false
    || certification?.safety?.local_connector_production_authority !== false) {
    fail("RECOVERY_CERTIFICATION_STAGING_CERTIFICATE_INVALID", "Payload does not contain a genuine bounded Staging certification bound to the same SHA and target.");
  }
}

function assertPayload(payload, env) {
  if (!payload || payload.contract !== RECOVERY_READINESS_EVIDENCE_CONTRACT
    || payload.environment !== "staging"
    || payload.branch !== "main"
    || payload.secrets_included !== false) {
    fail("RECOVERY_CERTIFICATION_PAYLOAD_INVALID", "Certification payload must use the canonical readiness-evidence contract and be bounded to Staging/main.");
  }
  if (!SHA40.test(payload.deployment_sha || "") || payload.deployment_sha !== env.GITHUB_SHA) {
    fail("RECOVERY_CERTIFICATION_EXACT_MAIN_MISMATCH", "Certification payload SHA must equal the exact GitHub-hosted workflow main SHA.");
  }
  if (!SHA256.test(payload.target_fingerprint || "")
    || !SHA256.test(payload.evidence_envelope_sha256 || "")
    || !SHA256.test(payload.verification_report_sha256 || "")) {
    fail("RECOVERY_CERTIFICATION_PAYLOAD_BINDING_INVALID", "Certification payload exact target/evidence/report binding is invalid.");
  }
  if (!SAFE_ID.test(payload.certification_run_id || "") || !SAFE_ID.test(payload.nonce || "")) {
    fail("RECOVERY_CERTIFICATION_RUN_BINDING_INVALID", "Certification run ID and nonce must be explicit bounded identities.");
  }
  const { issuer, keyId } = requiredSignerIdentity(env);
  if (payload.issuer !== issuer || payload.key_id !== keyId) {
    fail("RECOVERY_CERTIFICATION_SIGNER_IDENTITY_MISMATCH", "Certification payload issuer/key ID does not match the governed signing authority.");
  }
  if (payload.production_live_enabled !== false
    || payload.production_mutation_performed !== false
    || payload.local_connector_production_authority !== false) {
    fail("RECOVERY_CERTIFICATION_PRODUCTION_BOUNDARY_INVALID", "Certification signer refuses Production authority claims.");
  }
  assertFreshness(payload);
  assertNoSecretShapedFields(payload);
  assertStagingCertification(payload.stagingCertification, payload);
}

function assertVerificationReport(report, { evidenceEnvelopeSha256, deploymentSha, targetFingerprint, certificationRunId, nonce }) {
  if (report?.contract !== STAGING_RECOVERY_GITHUB_VERIFICATION_REPORT_CONTRACT
    || report?.verified !== true
    || report?.secrets_included !== false) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_INVALID", "GitHub verification report is not signing-grade.");
  }
  if (report.evidence_envelope_sha256 !== evidenceEnvelopeSha256
    || report.deployment_sha !== deploymentSha
    || report.target_fingerprint !== targetFingerprint
    || report.certification_run_id !== certificationRunId
    || report.nonce !== nonce) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_BINDING_MISMATCH", "GitHub verification report is not bound to the same evidence envelope/target/run/nonce/SHA.");
  }
  if (!report.checks || REQUIRED_VERIFICATION_CHECKS.some((key) => report.checks[key] !== true)) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_CHECKS_INCOMPLETE", "GitHub verification report is missing a required independently verified check.");
  }
  if (!SHA256.test(report.verification_report_sha256 || "")) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_HASH_INVALID", "GitHub verification report hash is invalid.");
  }
  const unsigned = { ...report };
  delete unsigned.verification_report_sha256;
  const actual = createHash("sha256").update(readinessEvidencePayload(unsigned)).digest("hex");
  if (actual !== report.verification_report_sha256) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_HASH_MISMATCH", "GitHub verification report hash mismatch.");
  }
}

function assertDistinctIngressAuthority(publicKey, env = process.env) {
  const ingressFingerprint = String(env.ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_SHA256 || "").trim().toLowerCase();
  if (!SHA256.test(ingressFingerprint)) {
    fail("RECOVERY_CERTIFICATION_INGRESS_AUTHORITY_UNAVAILABLE", "Activation Gateway ingress public-key fingerprint is required before Recovery certification signing.");
  }
  const recoveryFingerprint = keyFingerprint(publicKey);
  if (ingressFingerprint === recoveryFingerprint) {
    fail("RECOVERY_CERTIFICATION_KEY_REUSE_FORBIDDEN", "Recovery certification key must remain distinct from Activation Gateway ingress key.");
  }
  return recoveryFingerprint;
}

export function signVerifiedRecoveryEvidence({ payload, verificationReport, env = process.env } = {}) {
  assertGitHubHostedRuntime(env);
  assertPayload(payload, env);
  assertVerificationReport(verificationReport, {
    evidenceEnvelopeSha256: payload.evidence_envelope_sha256,
    deploymentSha: payload.deployment_sha,
    targetFingerprint: payload.target_fingerprint,
    certificationRunId: payload.certification_run_id,
    nonce: payload.nonce,
  });
  if (payload.verification_report_sha256 !== verificationReport.verification_report_sha256) {
    fail("RECOVERY_CERTIFICATION_VERIFICATION_REPORT_BINDING_MISMATCH", "Certification payload is not bound to the exact verification report.");
  }

  const key = privateSigningKey(env);
  const publicKey = createPublicKey(key);
  const recoveryFingerprint = assertDistinctIngressAuthority(publicKey, env);
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

// Compatibility alias for the pre-workflow branch; callers must still pass the fully
// verified canonical evidence envelope and the v2 verification report.
export const signVerifiedStagingRecoveryCertification = signVerifiedRecoveryEvidence;

export const _testingStagingRecoverySigningAuthority = Object.freeze({
  REQUIRED_VERIFICATION_CHECKS,
  keyFingerprint,
  assertFreshness,
});
