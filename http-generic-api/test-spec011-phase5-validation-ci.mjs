import assert from "node:assert/strict";
import {
  PHASE5_GATE_IDS,
  STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
  assertStructuredDiagnosisCoverage,
  authorizeMigrationApply,
  buildStructuredDiagnosis,
  evaluateContractDriftGate,
  evaluateDelegationBoundaryGate,
  evaluateIdempotencyGate,
  evaluateSemanticMutationGate,
  evaluateStateMachineGate,
  evaluateValidationLabEvidence,
  runSpec011Phase5GateSuite,
  validateStructuredDiagnosis,
} from "./spec011Phase5ValidationCi.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-08-03T05:10:00.000Z";

function passingValidationLab() {
  return {
    engine: {
      family: "MariaDB",
      version: "11.4.8-MariaDB",
      sql_mode: "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION",
      character_set: "utf8mb4",
      collation: "utf8mb4_unicode_ci",
      check_constraints_enforced: true,
      transaction_isolation_verified: true,
      secrets_included: false,
    },
    constraints: [
      "PRIMARY:agent_delegations",
      "chk_repository_automation_receipts_no_secrets",
      "uq_repository_automation_receipt_id",
    ],
    indexes: [
      "ux_agent_delegations_tenant_user_idempotency",
      "ix_agent_delegations_canonical_active",
      "uq_repository_automation_receipt_request",
    ],
    schema_diff: {
      status: "pass",
      added_objects: 2,
      removed_objects: 0,
      destructive_change_detected: false,
    },
    rollback_assessment: {
      status: "pass",
      rollback_sql_required: false,
      rollback_plan_ref: "spec011://phase5/disposable-reset",
    },
    production_authorized: false,
    evidence_refs: ["artifact://spec011/delegation-mariadb-certification.json"],
    secrets_included: false,
  };
}

function passingSemanticFiles() {
  return [
    {
      path: "specs/011/example.json",
      format: "json",
      parse_ok: true,
      semantic_mutation: true,
      bounded: true,
    },
    {
      path: "specs/011/example.yaml",
      format: "yaml",
      parse_ok: true,
      semantic_mutation: true,
      bounded: true,
    },
    {
      path: "canonicals/openapi/custom-gpt-surfaces.yaml",
      format: "openapi",
      parse_ok: true,
      semantic_mutation: true,
      bounded: true,
    },
    {
      path: "specs/011/completion.json",
      format: "completion",
      parse_ok: true,
      semantic_mutation: true,
      bounded: true,
      completion_contract_valid: true,
    },
  ];
}

function passingSuiteInput() {
  return {
    validation_lab: passingValidationLab(),
    contract_drift: {
      expected_digest: HASH_A,
      observed_digest: HASH_A,
      bindings_complete: true,
      evidence_refs: ["contract://spec011/canonical"],
    },
    state_machine: {
      invalid_transitions_rejected: true,
      terminal_states_immutable: true,
      model_case_count: 48,
      evidence_refs: ["test://durable-operation-state-machine"],
    },
    idempotency: {
      duplicate_mutation_count: 0,
      read_before_retry_verified: true,
      unknown_outcome_retry_attempted: false,
      same_operation_evidence_verified: true,
      evidence_refs: ["test://governed-reconciliation-kernel"],
    },
    delegation_boundary: {
      cross_tenant_denied: true,
      self_approval_denied: true,
      renewal_widening_denied: true,
      policy_digest_match: true,
      evidence_refs: ["test://delegation-boundary"],
    },
    semantic_mutation: {
      files: passingSemanticFiles(),
      evidence_refs: ["ci://semantic-contract-gates"],
    },
  };
}

{
  const diagnosis = buildStructuredDiagnosis({
    gateId: PHASE5_GATE_IDS.CONTRACT_DRIFT,
    status: "fail",
    code: "CONTRACT_DRIFT_DETECTED",
    summary: "Canonical digest changed.",
    blockers: ["CONTRACT_DRIFT_DETECTED"],
    remediation: ["Regenerate the canonical contract and rerun exact-head CI."],
    evidenceRefs: ["contract://spec011/canonical"],
    metadata: { expected_digest: HASH_A, observed_digest: HASH_B },
    observedAt: NOW,
  });
  assert.equal(diagnosis.schema_version, STRUCTURED_DIAGNOSIS_SCHEMA_VERSION);
  assert.equal(diagnosis.status, "fail");
  assert.deepEqual(validateStructuredDiagnosis(diagnosis), {
    ok: true,
    status: "pass",
    blockers: [],
    secrets_included: false,
  });
}

assert.throws(
  () => buildStructuredDiagnosis({
    gateId: "unsafe",
    status: "fail",
    summary: "Missing structured remediation.",
    blockers: ["FAILED"],
    remediation: [],
  }),
  (error) => error?.code === "STRUCTURED_DIAGNOSIS_REMEDIATION_REQUIRED",
);

assert.throws(
  () => buildStructuredDiagnosis({
    gateId: "unsafe",
    status: "pass",
    summary: "Secret-like evidence must be rejected.",
    metadata: { api_key: "must-not-leak" },
  }),
  (error) => error?.code === "STRUCTURED_DIAGNOSIS_SECRET_FIELD_REJECTED",
);

{
  const validation = evaluateValidationLabEvidence(passingValidationLab());
  assert.equal(validation.status, "pass");
  assert.match(validation.evidence_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(validation.evidence.engine.family, "mariadb");
  assert.equal(validation.evidence.production_authorized, false);

  const authorized = authorizeMigrationApply({
    mode: "apply",
    validation,
    evidenceRef: "artifact://spec011/phase5-validation-lab.json",
  });
  assert.equal(authorized.decision, "authorized");
  assert.equal(authorized.apply_authorized, true);
  assert.equal(authorized.validation_fingerprint, validation.evidence_fingerprint);
}

{
  const blockedValidation = evaluateValidationLabEvidence({
    ...passingValidationLab(),
    engine: {
      ...passingValidationLab().engine,
      sql_mode: "NO_ENGINE_SUBSTITUTION",
      check_constraints_enforced: false,
    },
    constraints: [],
    indexes: [],
    schema_diff: {
      status: "fail",
      added_objects: -1,
      removed_objects: 1,
      destructive_change_detected: true,
    },
    rollback_assessment: {
      status: "blocked",
      rollback_sql_required: true,
      rollback_plan_ref: null,
    },
  });
  assert.equal(blockedValidation.status, "blocked");
  assert.equal(blockedValidation.evidence_fingerprint, null);
  assert.ok(blockedValidation.blockers.includes("VALIDATION_STRICT_SQL_MODE_REQUIRED"));
  assert.ok(blockedValidation.blockers.includes("VALIDATION_CHECK_CONSTRAINTS_REQUIRED"));
  assert.ok(blockedValidation.blockers.includes("VALIDATION_CONSTRAINT_INVENTORY_REQUIRED"));
  assert.ok(blockedValidation.blockers.includes("VALIDATION_INDEX_INVENTORY_REQUIRED"));
  assert.ok(blockedValidation.blockers.includes("VALIDATION_DESTRUCTIVE_SCHEMA_CHANGE_FORBIDDEN"));
  assert.ok(blockedValidation.blockers.includes("VALIDATION_ROLLBACK_ASSESSMENT_REQUIRED"));
  assert.ok(blockedValidation.blockers.includes("VALIDATION_ROLLBACK_PLAN_REFERENCE_REQUIRED"));

  const denied = authorizeMigrationApply({
    mode: "apply",
    validation: blockedValidation,
    evidenceRef: null,
  });
  assert.equal(denied.decision, "blocked");
  assert.equal(denied.apply_authorized, false);
  assert.ok(denied.blockers.includes("MIGRATION_ENGINE_VALIDATION_REQUIRED"));
  assert.ok(denied.blockers.includes("MIGRATION_ENGINE_VALIDATION_FINGERPRINT_REQUIRED"));
  assert.ok(denied.blockers.includes("MIGRATION_ENGINE_VALIDATION_REFERENCE_REQUIRED"));

  const noApply = authorizeMigrationApply({ mode: "dry_run", validation: blockedValidation });
  assert.equal(noApply.decision, "no_apply_requested");
  assert.equal(noApply.apply_authorized, false);
}

{
  const contract = evaluateContractDriftGate({
    expected_digest: HASH_A,
    observed_digest: HASH_B,
    bindings_complete: false,
  });
  assert.equal(contract.status, "fail");
  assert.ok(contract.blockers.includes("CONTRACT_DRIFT_DETECTED"));
  assert.ok(contract.blockers.includes("CONTRACT_BINDINGS_INCOMPLETE"));
  assert.ok(contract.remediation.length > 0);

  const stateMachine = evaluateStateMachineGate({
    invalid_transitions_rejected: false,
    terminal_states_immutable: false,
    model_case_count: 0,
  });
  assert.equal(stateMachine.status, "fail");
  assert.ok(stateMachine.blockers.includes("STATE_MACHINE_INVALID_TRANSITION_ACCEPTED"));
  assert.ok(stateMachine.blockers.includes("STATE_MACHINE_TERMINAL_STATE_MUTABLE"));
  assert.ok(stateMachine.blockers.includes("STATE_MACHINE_MODEL_CASES_REQUIRED"));
}

{
  const idempotency = evaluateIdempotencyGate({
    duplicate_mutation_count: 1,
    read_before_retry_verified: false,
    unknown_outcome_retry_attempted: true,
    same_operation_evidence_verified: false,
  });
  assert.equal(idempotency.status, "fail");
  assert.ok(idempotency.blockers.includes("IDEMPOTENCY_DUPLICATE_MUTATION_DETECTED"));
  assert.ok(idempotency.blockers.includes("IDEMPOTENCY_READ_BEFORE_RETRY_REQUIRED"));
  assert.ok(idempotency.blockers.includes("UNKNOWN_OUTCOME_AUTOMATIC_RETRY_FORBIDDEN"));
  assert.ok(idempotency.blockers.includes("IDEMPOTENCY_SAME_OPERATION_EVIDENCE_REQUIRED"));

  const delegation = evaluateDelegationBoundaryGate({
    cross_tenant_denied: false,
    self_approval_denied: false,
    renewal_widening_denied: false,
    policy_digest_match: false,
  });
  assert.equal(delegation.status, "fail");
  assert.ok(delegation.blockers.includes("DELEGATION_CROSS_TENANT_DENIAL_REQUIRED"));
  assert.ok(delegation.blockers.includes("DELEGATION_SELF_APPROVAL_DENIAL_REQUIRED"));
  assert.ok(delegation.blockers.includes("DELEGATION_RENEWAL_WIDENING_DENIAL_REQUIRED"));
  assert.ok(delegation.blockers.includes("DELEGATION_POLICY_DRIFT_DETECTED"));
}

{
  const semantic = evaluateSemanticMutationGate({
    files: [
      ...passingSemanticFiles().slice(0, 3),
      {
        path: "specs/011/completion.json",
        format: "completion",
        parse_ok: true,
        semantic_mutation: true,
        bounded: true,
        completion_contract_valid: false,
      },
    ],
  });
  assert.equal(semantic.status, "fail");
  assert.ok(semantic.blockers.includes("COMPLETION_CONTRACT_INVALID:specs/011/completion.json"));

  const missingCoverage = evaluateSemanticMutationGate({
    files: [passingSemanticFiles()[0]],
  });
  assert.equal(missingCoverage.status, "fail");
  assert.ok(missingCoverage.blockers.includes("SEMANTIC_MUTATION_FORMAT_COVERAGE_MISSING:yaml"));
  assert.ok(missingCoverage.blockers.includes("SEMANTIC_MUTATION_FORMAT_COVERAGE_MISSING:openapi"));
  assert.ok(missingCoverage.blockers.includes("SEMANTIC_MUTATION_FORMAT_COVERAGE_MISSING:completion"));
}

{
  const report = runSpec011Phase5GateSuite(passingSuiteInput());
  assert.equal(report.ok, true);
  assert.equal(report.status, "pass");
  assert.equal(report.gates.length, Object.keys(PHASE5_GATE_IDS).length);
  assert.equal(report.failed_gate_ids.length, 0);
  assert.match(report.engine_validation_fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(assertStructuredDiagnosisCoverage(report), {
    ok: true,
    gate_count: Object.keys(PHASE5_GATE_IDS).length,
    secrets_included: false,
  });
}

{
  const failedInput = passingSuiteInput();
  failedInput.idempotency = {
    duplicate_mutation_count: 2,
    read_before_retry_verified: false,
    unknown_outcome_retry_attempted: true,
    same_operation_evidence_verified: false,
  };
  const report = runSpec011Phase5GateSuite(failedInput);
  assert.equal(report.ok, false);
  assert.equal(report.status, "failed");
  assert.ok(report.failed_gate_ids.includes(PHASE5_GATE_IDS.IDEMPOTENCY));
  const failedGate = report.gates.find((gate) => gate.gate_id === PHASE5_GATE_IDS.IDEMPOTENCY);
  assert.ok(failedGate.blockers.length > 0);
  assert.ok(failedGate.remediation.length > 0);
  assert.equal(validateStructuredDiagnosis(failedGate).ok, true);
}

assert.throws(
  () => assertStructuredDiagnosisCoverage({
    gates: [evaluateContractDriftGate({
      expected_digest: HASH_A,
      observed_digest: HASH_A,
      bindings_complete: true,
    })],
  }),
  (error) => error?.code === "STRUCTURED_CI_DIAGNOSIS_INCOMPLETE",
);

console.log("Spec 011 Phase 5 validation and structured CI tests passed");
