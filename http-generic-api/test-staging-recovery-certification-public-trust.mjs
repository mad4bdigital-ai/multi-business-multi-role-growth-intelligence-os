import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  STAGING_RECOVERY_CERTIFICATION_TRUST_CONTRACT,
  loadStagingRecoveryCertificationPublicTrust,
  verifyStagingRecoverySignedCertificationRecord,
} from "./stagingRecoveryCertificationPublicTrust.js";
import {
  STAGING_RECOVERY_GITHUB_VERIFICATION_REPORT_CONTRACT,
  signVerifiedStagingRecoveryCertification,
} from "../.github/scripts/staging-recovery-sign-certification.mjs";
import { readinessEvidencePayload } from "./recoveryReadinessEvidence.js";

const recovery = generateKeyPairSync("ed25519");
const ingress = generateKeyPairSync("ed25519");
const privatePem = recovery.privateKey.export({ format: "pem", type: "pkcs8" });
const publicPem = recovery.publicKey.export({ format: "pem", type: "spki" });
const ingressPublicPem = ingress.publicKey.export({ format: "pem", type: "spki" });
const SHA = "a".repeat(40);
const TARGET = "b".repeat(64);
const RUN = "cert-run:phase-b-001";
const NONCE = "nonce:phase-b-001";
const EVIDENCE = "c".repeat(64);

function report() {
  const base = {
    contract: STAGING_RECOVERY_GITHUB_VERIFICATION_REPORT_CONTRACT,
    verified: true,
    evidence_envelope_sha256: EVIDENCE,
    deployment_sha: SHA,
    certification_run_id: RUN,
    nonce: NONCE,
    checks: { exact_main: true, evidence_binding: true, production_target_absent: true, secrets_absent: true },
    secrets_included: false,
  };
  return { ...base, verification_report_sha256: createHash("sha256").update(readinessEvidencePayload(base)).digest("hex") };
}

function payload(verificationReport) {
  return {
    contract: "mad4b.recovery-readiness-evidence.v1",
    issuer: "mad4b://staging-recovery-certification",
    key_id: "recovery-certification-test",
    environment: "staging",
    branch: "main",
    deployment_sha: SHA,
    target_fingerprint: TARGET,
    certification_run_id: RUN,
    nonce: NONCE,
    evidence_envelope_sha256: EVIDENCE,
    verification_report_sha256: verificationReport.verification_report_sha256,
    generated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    production_live_enabled: false,
    production_mutation_performed: false,
    local_connector_production_authority: false,
    secrets_included: false,
  };
}

test("private signer is denied outside GitHub-hosted Actions", () => {
  const verificationReport = report();
  assert.throws(
    () => signVerifiedStagingRecoveryCertification({ payload: payload(verificationReport), verificationReport, env: {} }),
    (error) => error?.code === "RECOVERY_CERTIFICATION_SIGNER_RUNTIME_DENIED",
  );
});

test("GitHub-hosted signer is exact-main bound and local verifier accepts only public trust", () => {
  const verificationReport = report();
  const env = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_NAME: "main",
    GITHUB_SHA: SHA,
    RECOVERY_STAGING_CERTIFICATION_PRIVATE_KEY: privatePem,
  };
  const signed = signVerifiedStagingRecoveryCertification({ payload: payload(verificationReport), verificationReport, env });
  assert.equal(signed.signer_runtime, "github_hosted_actions");
  assert.equal(JSON.stringify(signed).includes("PRIVATE KEY"), false);

  const trust = loadStagingRecoveryCertificationPublicTrust({
    RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY: publicPem,
    RECOVERY_STAGING_CERTIFICATION_KEY_ID: "recovery-certification-test",
    RECOVERY_STAGING_CERTIFICATION_ISSUER: "mad4b://staging-recovery-certification",
    REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: ingressPublicPem,
  });
  assert.equal(trust.contract, STAGING_RECOVERY_CERTIFICATION_TRUST_CONTRACT);
  const verified = verifyStagingRecoverySignedCertificationRecord(signed, {
    trust,
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
    expectedRunId: RUN,
    expectedNonce: NONCE,
  });
  assert.equal(verified.valid, true);
});

test("Recovery certification trust rejects Activation Gateway ingress key reuse", () => {
  assert.throws(
    () => loadStagingRecoveryCertificationPublicTrust({
      RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY: publicPem,
      RECOVERY_STAGING_CERTIFICATION_KEY_ID: "recovery-certification-test",
      RECOVERY_STAGING_CERTIFICATION_ISSUER: "mad4b://staging-recovery-certification",
      REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: publicPem,
    }),
    (error) => error?.code === "RECOVERY_CERTIFICATION_KEY_REUSE_FORBIDDEN",
  );
});
