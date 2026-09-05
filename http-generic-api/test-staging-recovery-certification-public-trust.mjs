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
  signVerifiedRecoveryEvidence,
} from "../.github/scripts/staging-recovery-sign-certification.mjs";
import {
  RECOVERY_READINESS_EVIDENCE_CONTRACT,
  readinessEvidencePayload,
} from "./recoveryReadinessEvidence.js";

const recovery = generateKeyPairSync("ed25519");
const ingress = generateKeyPairSync("ed25519");
const privatePem = recovery.privateKey.export({ format: "pem", type: "pkcs8" });
const publicPem = recovery.publicKey.export({ format: "pem", type: "spki" });
const ingressPublicPem = ingress.publicKey.export({ format: "pem", type: "spki" });
const ingressFingerprint = createHash("sha256")
  .update(ingress.publicKey.export({ format: "der", type: "spki" }))
  .digest("hex");
const SHA = "a".repeat(40);
const TARGET = "b".repeat(64);
const RUN = "cert-run:phase-b-001";
const NONCE = "nonce:phase-b-001";
const EVIDENCE = "c".repeat(64);
const ISSUER = "mad4b://staging-recovery-certification";
const KEY_ID = "recovery-certification-test";

function validStagingCertification() {
  return {
    contract: "mad4b.recovery-staging-certification.v1",
    certification_id: "cert:staging:surface-001",
    status: "passed",
    result: "pass",
    environment_key: "staging",
    deployment_sha: SHA,
    runtime_sha: SHA,
    branch: "main",
    target_fingerprint: TARGET,
    server_identity_fingerprint: "server:" + "d".repeat(64),
    provider_environment: "staging",
    authority_graph: { ready: true, test_or_mock_adapter_detected: false },
    lifecycle_trace: { durable_inspection: { status: "pass" } },
    negative_tests: { all_passed: true, cases: {} },
    audit_evidence: { durable: true, evidence_hash: "e".repeat(64), canonical_payload_hash: "f".repeat(64) },
    artifact_integrity: { valid: true },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    safety: {
      production_mutation_performed: false,
      secrets_included: false,
      caller_credentials_accepted: false,
      local_connector_production_authority: false,
    },
    secrets_included: false,
  };
}

function report() {
  const base = {
    contract: STAGING_RECOVERY_GITHUB_VERIFICATION_REPORT_CONTRACT,
    verified: true,
    evidence_envelope_sha256: EVIDENCE,
    deployment_sha: SHA,
    target_fingerprint: TARGET,
    certification_run_id: RUN,
    nonce: NONCE,
    checks: {
      exact_main: true,
      workflow_source_same_sha: true,
      evidence_envelope_hash: true,
      target_binding: true,
      run_nonce_binding: true,
      worker_provenance: true,
      artifact_integrity: true,
      evidence_freshness: true,
      external_evidence: true,
      production_boundary: true,
      secret_scan: true,
    },
    secrets_included: false,
  };
  return { ...base, verification_report_sha256: createHash("sha256").update(readinessEvidencePayload(base)).digest("hex") };
}

function payload(verificationReport) {
  return {
    contract: RECOVERY_READINESS_EVIDENCE_CONTRACT,
    issuer: ISSUER,
    key_id: KEY_ID,
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
    stagingCertification: validStagingCertification(),
    secrets_included: false,
  };
}

test("private signer is denied outside GitHub-hosted Actions", () => {
  const verificationReport = report();
  assert.throws(
    () => signVerifiedRecoveryEvidence({ payload: payload(verificationReport), verificationReport, env: {} }),
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
    RECOVERY_STAGING_CERTIFICATION_ISSUER: ISSUER,
    RECOVERY_STAGING_CERTIFICATION_KEY_ID: KEY_ID,
    ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_SHA256: ingressFingerprint,
  };
  const signed = signVerifiedRecoveryEvidence({ payload: payload(verificationReport), verificationReport, env });
  assert.equal(signed.signer_runtime, "github_hosted_actions");
  assert.equal(JSON.stringify(signed).includes("PRIVATE KEY"), false);

  const trust = loadStagingRecoveryCertificationPublicTrust({
    RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY: publicPem,
    RECOVERY_STAGING_CERTIFICATION_KEY_ID: KEY_ID,
    RECOVERY_STAGING_CERTIFICATION_ISSUER: ISSUER,
    REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: ingressPublicPem,
  });
  assert.equal(trust.contract, STAGING_RECOVERY_CERTIFICATION_TRUST_CONTRACT);
  assert.equal(trust.separation_verified, true);
  const verified = verifyStagingRecoverySignedCertificationRecord(signed, {
    trust,
    expectedSha: SHA,
    expectedTargetFingerprint: TARGET,
    expectedRunId: RUN,
    expectedNonce: NONCE,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.ingress_key_separation_verified, true);
});

test("Recovery certification trust fails closed when Activation Gateway ingress trust is unavailable", () => {
  assert.throws(
    () => loadStagingRecoveryCertificationPublicTrust({
      RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY: publicPem,
      RECOVERY_STAGING_CERTIFICATION_KEY_ID: KEY_ID,
      RECOVERY_STAGING_CERTIFICATION_ISSUER: ISSUER,
    }),
    (error) => error?.code === "RECOVERY_CERTIFICATION_INGRESS_TRUST_UNAVAILABLE",
  );
});

test("Recovery certification trust rejects Activation Gateway ingress key reuse", () => {
  assert.throws(
    () => loadStagingRecoveryCertificationPublicTrust({
      RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY: publicPem,
      RECOVERY_STAGING_CERTIFICATION_KEY_ID: KEY_ID,
      RECOVERY_STAGING_CERTIFICATION_ISSUER: ISSUER,
      REMOTE_MCP_TRUSTED_INGRESS_PUBLIC_KEY: publicPem,
    }),
    (error) => error?.code === "RECOVERY_CERTIFICATION_KEY_REUSE_FORBIDDEN",
  );
});
