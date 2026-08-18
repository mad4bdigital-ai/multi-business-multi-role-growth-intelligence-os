import assert from "node:assert/strict";
import {
  RUNTIME_READINESS_EVIDENCE_CLOSEOUT_CONTRACT,
  buildEmptyRuntimeReadinessEvidenceCloseout,
  buildRuntimeReadinessEvidenceCloseout,
  validateRuntimeReadinessEvidenceCloseout,
} from "./runtimeReadinessEvidenceCloseout.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const roles = {
  runtime: {
    expected_database: "runtime_db",
    observed_database: "runtime_db",
    expected_principal: "runtime_principal",
    observed_principal: "runtime_principal",
    readback_complete: true,
    privilege_matrix_exact: true,
    schema_readback: true,
  },
  governance: {
    expected_database: "governance_db",
    observed_database: "governance_db",
    expected_principal: "governance_principal",
    observed_principal: "governance_principal",
    readback_complete: true,
    privilege_matrix_exact: true,
    schema_readback: true,
  },
  runtime_persistence: {
    expected_database: "persistence_db",
    observed_database: "persistence_db",
    expected_principal: "persistence_principal",
    observed_principal: "persistence_principal",
    readback_complete: true,
    privilege_matrix_exact: true,
    schema_readback: true,
  },
};
const staging = {
  expected_sha: SHA_A,
  observed_sha: SHA_A,
  reachable: true,
  clean_readback: true,
  rollback_rehearsal_ready: true,
};

{
  const empty = buildEmptyRuntimeReadinessEvidenceCloseout({ expected_sha: SHA_A, observed_sha: SHA_B });
  assert.equal(empty.contract, RUNTIME_READINESS_EVIDENCE_CLOSEOUT_CONTRACT);
  assert.equal(empty.status, "blocked_pending_evidence");
  assert.equal(empty.checks.exact_head_binding, false);
  assert.equal(empty.production_promotion_authorized, false);
  assert.equal(empty.migration_apply_performed, false);
  assert.equal(empty.database_mutated, false);
  assert.equal(empty.secrets_included, false);
}

{
  const ready = buildRuntimeReadinessEvidenceCloseout({
    expected_sha: SHA_A,
    observed_sha: SHA_A,
    source_branch: "main",
    generated_at: "2026-08-18T00:00:00.000Z",
    database_roles: roles,
    staging,
    ci: { all_required_checks_passed: true },
    rollback: { rehearsal_ready: true },
  });
  assert.equal(ready.status, "ready_for_review");
  assert.equal(ready.release_readiness, "staging_evidence_ready_production_separate");
  assert.equal(ready.checks.database_roles_complete, true);
  assert.equal(ready.checks.staging_readback_ready, true);
  assert.equal(ready.environments.production.status, "blocked");
  assert.equal(ready.production_deployed, false);
  assert.equal(validateRuntimeReadinessEvidenceCloseout(ready).valid, true);
  assert.match(ready.evidence_digest_sha256, /^[a-f0-9]{64}$/u);
}

{
  const blocked = buildRuntimeReadinessEvidenceCloseout({
    expected_sha: SHA_A,
    observed_sha: SHA_B,
    database_roles: { ...roles, governance: { ...roles.governance, privilege_matrix_exact: false } },
    staging: { ...staging, clean_readback: false },
    ci: { all_required_checks_passed: false },
    rollback: { rehearsal_ready: false },
  });
  assert.equal(blocked.status, "blocked_pending_evidence");
  assert.equal(blocked.checks.exact_head_binding, false);
  assert.equal(blocked.checks.database_roles_complete, false);
  assert.equal(blocked.checks.staging_readback_ready, false);
  assert.equal(blocked.checks.ci_required_checks_passed, false);
}

{
  assert.throws(
    () => buildRuntimeReadinessEvidenceCloseout({ expected_sha: SHA_A, observed_sha: SHA_A, staging: { password: "redacted" } }),
    /forbidden credential-bearing keys/iu,
  );
  assert.equal(validateRuntimeReadinessEvidenceCloseout({
    contract: RUNTIME_READINESS_EVIDENCE_CLOSEOUT_CONTRACT,
    schema_version: 1,
    secrets_included: true,
    migration_apply_performed: false,
    database_mutated: false,
    provider_called: false,
    production_deployed: false,
    production_promotion_authorized: false,
  }).valid, false);
}

console.log(JSON.stringify({
  ok: true,
  contract: RUNTIME_READINESS_EVIDENCE_CLOSEOUT_CONTRACT,
  checks: 4,
  production_promotion_authorized: false,
  migration_apply_performed: false,
  database_mutated: false,
  provider_called: false,
  secrets_included: false,
}));
