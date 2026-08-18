import assert from "node:assert/strict";
import {
  SPEC018_RESIDUAL_READINESS_EVIDENCE_CONTRACT,
  buildSpec018ResidualReadinessEvidence,
  validateSpec018ResidualReadinessEvidence,
} from "./spec018ResidualReadinessEvidence.mjs";

const SHA = "a".repeat(40);

function readyInput() {
  return {
    generated_at: "2026-08-18T00:00:00Z",
    f09_attestation_parity: {
      expected_sha: SHA,
      observed_sha: SHA,
      attestation_generated: true,
      registry_revision: "registry-r17",
      runtime_readback_complete: true,
      parity_readback_complete: true,
      enforcement_mode: "shadow",
    },
    h06_security_review: {
      controls: Object.fromEntries([
        "authentication",
        "authorization",
        "object_scope",
        "replay",
        "injection",
        "path_traversal",
        "secret_exposure",
      ].map((control) => [control, {
        reviewed: true,
        evidence_ref: `security/${control}/r1`,
        findings_count: 0,
      }])),
    },
    h10_staging_verification: {
      expected_main_sha: SHA,
      observed_main_sha: SHA,
      all_required_checks_passed: true,
      staging_reachable: true,
      staging_clean_readback: true,
      runtime_integrity_readback: true,
      provider_called: false,
      database_mutated: false,
      migration_apply_performed: false,
    },
    h11_release_readiness: {
      expected_main_sha: SHA,
      observed_main_sha: SHA,
      release_readiness_checks_passed: true,
      rollback_readiness_complete: true,
      staging_evidence_ready: true,
      production_promotion_authorized: false,
      production_deployed: false,
    },
  };
}

{
  const report = buildSpec018ResidualReadinessEvidence(readyInput());
  assert.equal(report.contract, SPEC018_RESIDUAL_READINESS_EVIDENCE_CONTRACT);
  assert.equal(report.status, "ready_for_review_not_authorized");
  assert.equal(report.requirements.F09.status, "shadow_parity_ready");
  assert.equal(report.requirements.H06.status, "security_review_ready");
  assert.equal(report.requirements.H10.status, "staging_verification_ready");
  assert.equal(report.requirements.H11.status, "release_readiness_ready_for_review");
  assert.equal(report.production_promotion_authorized, false);
  assert.equal(report.provider_called, false);
  assert.equal(report.database_mutated, false);
  assert.equal(validateSpec018ResidualReadinessEvidence(report).valid, true);
}

{
  const report = buildSpec018ResidualReadinessEvidence({
    f09_attestation_parity: { enforcement_mode: "enforced" },
    h06_security_review: {},
    h10_staging_verification: {},
    h11_release_readiness: {},
  });
  assert.equal(report.status, "blocked_pending_residual_evidence");
  assert.equal(report.requirements.F09.status, "blocked_pending_parity");
  assert.equal(report.requirements.H06.status, "blocked_pending_security_review");
  assert.equal(report.requirements.H10.status, "blocked_pending_staging_verification");
  assert.equal(report.requirements.H11.status, "blocked_pending_release_readiness");
}

{
  assert.throws(
    () => buildSpec018ResidualReadinessEvidence({
      h06_security_review: { password: "must-not-enter-evidence" },
    }),
    /forbidden credential-bearing keys/,
  );
}

console.log(JSON.stringify({
  ok: true,
  test: "spec018_residual_readiness_evidence",
  requirements: ["F09", "H06", "H10", "H11"],
  promotion_authorized: false,
  mutations_performed: false,
  secrets_included: false,
}));
