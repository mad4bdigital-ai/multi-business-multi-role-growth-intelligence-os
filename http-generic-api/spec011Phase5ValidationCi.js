import { createHash } from "node:crypto";

export const SPEC011_PHASE5_VALIDATION_VERSION = "spec011-phase5-validation-ci-v1";
export const STRUCTURED_DIAGNOSIS_SCHEMA_VERSION = "spec011-structured-ci-diagnosis-v1";

export const PHASE5_GATE_IDS = Object.freeze({
  ENGINE_VALIDATION: "migration_engine_validation",
  CONTRACT_DRIFT: "contract_drift",
  STATE_MACHINE: "state_machine_model",
  IDEMPOTENCY: "idempotency_unknown_outcome",
  DELEGATION_BOUNDARY: "delegation_boundary_policy_drift",
  SEMANTIC_MUTATION: "semantic_file_mutation",
});

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_KEY = /(secret(?!s_included$)|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;
const ALLOWED_STATUSES = new Set(["pass", "fail", "blocked"]);
const REQUIRED_SEMANTIC_FORMATS = new Set(["json", "yaml", "openapi", "completion"]);
const MAX_DEPTH = 12;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function lower(value, max = 191) {
  return compact(value, max).toLowerCase();
}

function stringArray(value, max = 191) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((entry) => compact(entry, max))
    .filter(Boolean))];
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertSecretFree(value, path = "evidence", depth = 0) {
  if (depth > MAX_DEPTH) {
    throw fail("STRUCTURED_DIAGNOSIS_DEPTH_EXCEEDED", "Structured diagnosis exceeds the maximum depth.", { path });
  }
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw fail("STRUCTURED_DIAGNOSIS_SECRET_FIELD_REJECTED", "Structured diagnosis must not include secret-like fields.", {
        path: `${path}.${key}`,
      });
    }
    assertSecretFree(entry, `${path}.${key}`, depth + 1);
  }
}

export function buildStructuredDiagnosis({
  gateId,
  status,
  code,
  summary,
  blockers = [],
  evidenceRefs = [],
  remediation = [],
  metadata = {},
  observedAt = new Date().toISOString(),
} = {}) {
  const normalizedStatus = lower(status, 32);
  if (!compact(gateId, 128)) throw fail("STRUCTURED_DIAGNOSIS_GATE_ID_REQUIRED", "gateId is required.");
  if (!ALLOWED_STATUSES.has(normalizedStatus)) {
    throw fail("STRUCTURED_DIAGNOSIS_STATUS_INVALID", "status must be pass, fail, or blocked.", { status });
  }
  const normalizedBlockers = stringArray(blockers, 500);
  const normalizedRemediation = stringArray(remediation, 500);
  if (normalizedStatus !== "pass" && normalizedBlockers.length === 0) {
    throw fail("STRUCTURED_DIAGNOSIS_BLOCKER_REQUIRED", "Failed or blocked gates must emit at least one blocker.");
  }
  if (normalizedStatus !== "pass" && normalizedRemediation.length === 0) {
    throw fail("STRUCTURED_DIAGNOSIS_REMEDIATION_REQUIRED", "Failed or blocked gates must emit remediation.");
  }

  const diagnosis = {
    schema_version: STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
    gate_id: compact(gateId, 128),
    status: normalizedStatus,
    code: compact(code || (normalizedStatus === "pass" ? "PASS" : "GATE_FAILED"), 128),
    summary: compact(summary, 1000),
    blockers: normalizedBlockers,
    evidence_refs: stringArray(evidenceRefs, 500),
    remediation: normalizedRemediation,
    metadata: stable(metadata || {}),
    observed_at: new Date(observedAt).toISOString(),
    secrets_included: false,
  };
  assertSecretFree(diagnosis.metadata, "diagnosis.metadata");
  return Object.freeze(diagnosis);
}

export function validateStructuredDiagnosis(value) {
  const blockers = [];
  if (!value || typeof value !== "object") blockers.push("STRUCTURED_DIAGNOSIS_OBJECT_REQUIRED");
  if (value?.schema_version !== STRUCTURED_DIAGNOSIS_SCHEMA_VERSION) blockers.push("STRUCTURED_DIAGNOSIS_SCHEMA_VERSION_INVALID");
  if (!compact(value?.gate_id, 128)) blockers.push("STRUCTURED_DIAGNOSIS_GATE_ID_REQUIRED");
  if (!ALLOWED_STATUSES.has(lower(value?.status, 32))) blockers.push("STRUCTURED_DIAGNOSIS_STATUS_INVALID");
  if (!compact(value?.code, 128)) blockers.push("STRUCTURED_DIAGNOSIS_CODE_REQUIRED");
  if (!compact(value?.summary, 1000)) blockers.push("STRUCTURED_DIAGNOSIS_SUMMARY_REQUIRED");
  if (value?.status !== "pass" && (!Array.isArray(value?.blockers) || value.blockers.length === 0)) {
    blockers.push("STRUCTURED_DIAGNOSIS_BLOCKER_REQUIRED");
  }
  if (value?.status !== "pass" && (!Array.isArray(value?.remediation) || value.remediation.length === 0)) {
    blockers.push("STRUCTURED_DIAGNOSIS_REMEDIATION_REQUIRED");
  }
  if (value?.secrets_included !== false) blockers.push("STRUCTURED_DIAGNOSIS_SECRETS_FLAG_INVALID");
  try { assertSecretFree(value?.metadata || {}, "diagnosis.metadata"); } catch (error) { blockers.push(error.code); }
  return {
    ok: blockers.length === 0,
    status: blockers.length === 0 ? "pass" : "fail",
    blockers: [...new Set(blockers)],
    secrets_included: false,
  };
}

export function evaluateValidationLabEvidence(evidence = {}) {
  const blockers = [];
  const engine = evidence.engine || {};
  const schemaDiff = evidence.schema_diff || {};
  const rollback = evidence.rollback_assessment || {};
  const family = lower(engine.family || engine.engine_family, 64);
  const sqlMode = compact(engine.sql_mode, 2000).toUpperCase();
  const characterSet = lower(engine.character_set || engine.character_set_server, 64);
  const collation = lower(engine.collation || engine.collation_server, 64);
  const constraints = stringArray(evidence.constraints, 191);
  const indexes = stringArray(evidence.indexes, 191);

  if (!family.includes("mariadb") && !family.includes("mysql")) blockers.push("VALIDATION_ENGINE_FAMILY_INCOMPATIBLE");
  if (!compact(engine.version, 128)) blockers.push("VALIDATION_ENGINE_VERSION_REQUIRED");
  if (!sqlMode.includes("STRICT_TRANS_TABLES") && !sqlMode.includes("STRICT_ALL_TABLES")) {
    blockers.push("VALIDATION_STRICT_SQL_MODE_REQUIRED");
  }
  if (!characterSet.startsWith("utf8mb4")) blockers.push("VALIDATION_UTF8MB4_CHARACTER_SET_REQUIRED");
  if (!collation.startsWith("utf8mb4")) blockers.push("VALIDATION_UTF8MB4_COLLATION_REQUIRED");
  if (engine.check_constraints_enforced !== true) blockers.push("VALIDATION_CHECK_CONSTRAINTS_REQUIRED");
  if (engine.transaction_isolation_verified !== true) blockers.push("VALIDATION_TRANSACTION_ISOLATION_REQUIRED");
  if (constraints.length === 0) blockers.push("VALIDATION_CONSTRAINT_INVENTORY_REQUIRED");
  if (indexes.length === 0) blockers.push("VALIDATION_INDEX_INVENTORY_REQUIRED");
  if (schemaDiff.status !== "pass") blockers.push("VALIDATION_SCHEMA_DIFF_REQUIRED");
  if (schemaDiff.destructive_change_detected === true) blockers.push("VALIDATION_DESTRUCTIVE_SCHEMA_CHANGE_FORBIDDEN");
  if (!Number.isInteger(Number(schemaDiff.added_objects)) || Number(schemaDiff.added_objects) < 0) {
    blockers.push("VALIDATION_SCHEMA_DIFF_COUNT_REQUIRED");
  }
  if (rollback.status !== "pass") blockers.push("VALIDATION_ROLLBACK_ASSESSMENT_REQUIRED");
  if (rollback.rollback_sql_required === true && !compact(rollback.rollback_plan_ref, 500)) {
    blockers.push("VALIDATION_ROLLBACK_PLAN_REFERENCE_REQUIRED");
  }
  if (evidence.production_authorized !== false) blockers.push("VALIDATION_PRODUCTION_AUTHORIZATION_MUST_BE_FALSE");
  if (evidence.secrets_included !== false || engine.secrets_included !== false) {
    blockers.push("VALIDATION_SECRETS_FLAG_INVALID");
  }

  const normalized = {
    engine: {
      family,
      version: compact(engine.version, 128),
      sql_mode: compact(engine.sql_mode, 2000),
      character_set: characterSet,
      collation,
      check_constraints_enforced: engine.check_constraints_enforced === true,
      transaction_isolation_verified: engine.transaction_isolation_verified === true,
      secrets_included: false,
    },
    constraints: constraints.sort(),
    indexes: indexes.sort(),
    schema_diff: {
      status: lower(schemaDiff.status, 32),
      added_objects: Number.isInteger(Number(schemaDiff.added_objects)) ? Number(schemaDiff.added_objects) : null,
      removed_objects: Number.isInteger(Number(schemaDiff.removed_objects)) ? Number(schemaDiff.removed_objects) : null,
      destructive_change_detected: schemaDiff.destructive_change_detected === true,
    },
    rollback_assessment: {
      status: lower(rollback.status, 32),
      rollback_sql_required: rollback.rollback_sql_required === true,
      rollback_plan_ref: compact(rollback.rollback_plan_ref, 500) || null,
    },
    production_authorized: false,
    secrets_included: false,
  };
  const status = blockers.length === 0 ? "pass" : "blocked";
  return {
    ok: true,
    report_type: "spec011_validation_lab_evidence_evaluation",
    validation_version: SPEC011_PHASE5_VALIDATION_VERSION,
    status,
    blockers: [...new Set(blockers)],
    evidence_fingerprint: status === "pass" ? sha256(normalized) : null,
    evidence: normalized,
    secrets_included: false,
  };
}

export function authorizeMigrationApply({ mode = "apply", validation, evidenceRef } = {}) {
  const requestedMode = lower(mode, 32);
  const blockers = [];
  if (requestedMode !== "apply") {
    return {
      ok: true,
      decision: "no_apply_requested",
      apply_authorized: false,
      blockers: [],
      secrets_included: false,
    };
  }
  if (validation?.status !== "pass") blockers.push("MIGRATION_ENGINE_VALIDATION_REQUIRED");
  if (!HASH_PATTERN.test(compact(validation?.evidence_fingerprint, 64).toLowerCase())) {
    blockers.push("MIGRATION_ENGINE_VALIDATION_FINGERPRINT_REQUIRED");
  }
  if (!compact(evidenceRef, 500)) blockers.push("MIGRATION_ENGINE_VALIDATION_REFERENCE_REQUIRED");
  return {
    ok: true,
    decision: blockers.length === 0 ? "authorized" : "blocked",
    apply_authorized: blockers.length === 0,
    blockers: [...new Set(blockers)],
    validation_fingerprint: blockers.length === 0 ? validation.evidence_fingerprint : null,
    evidence_ref: blockers.length === 0 ? compact(evidenceRef, 500) : null,
    secrets_included: false,
  };
}

function gateDiagnosis(gateId, blockers, summary, evidenceRefs = [], metadata = {}) {
  const uniqueBlockers = [...new Set(blockers)];
  return buildStructuredDiagnosis({
    gateId,
    status: uniqueBlockers.length === 0 ? "pass" : "fail",
    code: uniqueBlockers.length === 0 ? "PASS" : `${gateId.toUpperCase()}_FAILED`,
    summary,
    blockers: uniqueBlockers,
    evidenceRefs,
    remediation: uniqueBlockers.length === 0 ? [] : ["Resolve every blocker and rerun the exact-head gate."],
    metadata,
  });
}

export function evaluateContractDriftGate(input = {}) {
  const blockers = [];
  const expected = lower(input.expected_digest, 64);
  const observed = lower(input.observed_digest, 64);
  if (!HASH_PATTERN.test(expected) || !HASH_PATTERN.test(observed)) blockers.push("CONTRACT_DIGEST_REQUIRED");
  if (expected && observed && expected !== observed) blockers.push("CONTRACT_DRIFT_DETECTED");
  if (input.bindings_complete !== true) blockers.push("CONTRACT_BINDINGS_INCOMPLETE");
  return gateDiagnosis(PHASE5_GATE_IDS.CONTRACT_DRIFT, blockers, "Validate canonical contract and binding parity.", input.evidence_refs, {
    expected_digest: expected || null,
    observed_digest: observed || null,
  });
}

export function evaluateStateMachineGate(input = {}) {
  const blockers = [];
  if (input.invalid_transitions_rejected !== true) blockers.push("STATE_MACHINE_INVALID_TRANSITION_ACCEPTED");
  if (input.terminal_states_immutable !== true) blockers.push("STATE_MACHINE_TERMINAL_STATE_MUTABLE");
  if (!Number.isInteger(Number(input.model_case_count)) || Number(input.model_case_count) < 1) {
    blockers.push("STATE_MACHINE_MODEL_CASES_REQUIRED");
  }
  return gateDiagnosis(PHASE5_GATE_IDS.STATE_MACHINE, blockers, "Validate model-based lifecycle invariants.", input.evidence_refs, {
    model_case_count: Number(input.model_case_count) || 0,
  });
}

export function evaluateIdempotencyGate(input = {}) {
  const blockers = [];
  if (Number(input.duplicate_mutation_count) !== 0) blockers.push("IDEMPOTENCY_DUPLICATE_MUTATION_DETECTED");
  if (input.read_before_retry_verified !== true) blockers.push("IDEMPOTENCY_READ_BEFORE_RETRY_REQUIRED");
  if (input.unknown_outcome_retry_attempted === true) blockers.push("UNKNOWN_OUTCOME_AUTOMATIC_RETRY_FORBIDDEN");
  if (input.same_operation_evidence_verified !== true) blockers.push("IDEMPOTENCY_SAME_OPERATION_EVIDENCE_REQUIRED");
  return gateDiagnosis(PHASE5_GATE_IDS.IDEMPOTENCY, blockers, "Validate replay safety and unknown-outcome handling.", input.evidence_refs, {
    duplicate_mutation_count: Number(input.duplicate_mutation_count) || 0,
  });
}

export function evaluateDelegationBoundaryGate(input = {}) {
  const blockers = [];
  if (input.cross_tenant_denied !== true) blockers.push("DELEGATION_CROSS_TENANT_DENIAL_REQUIRED");
  if (input.self_approval_denied !== true) blockers.push("DELEGATION_SELF_APPROVAL_DENIAL_REQUIRED");
  if (input.renewal_widening_denied !== true) blockers.push("DELEGATION_RENEWAL_WIDENING_DENIAL_REQUIRED");
  if (input.policy_digest_match !== true) blockers.push("DELEGATION_POLICY_DRIFT_DETECTED");
  return gateDiagnosis(PHASE5_GATE_IDS.DELEGATION_BOUNDARY, blockers, "Validate delegation boundaries and policy parity.", input.evidence_refs);
}

export function evaluateSemanticMutationGate(input = {}) {
  const blockers = [];
  const files = Array.isArray(input.files) ? input.files : [];
  const observedFormats = new Set();
  for (const file of files) {
    const format = lower(file?.format, 32);
    if (format) observedFormats.add(format);
    if (!compact(file?.path, 500)) blockers.push("SEMANTIC_MUTATION_PATH_REQUIRED");
    if (!REQUIRED_SEMANTIC_FORMATS.has(format)) blockers.push(`SEMANTIC_MUTATION_FORMAT_INVALID:${format || "missing"}`);
    if (file?.parse_ok !== true) blockers.push(`SEMANTIC_MUTATION_PARSE_FAILED:${compact(file?.path, 500) || "unknown"}`);
    if (file?.semantic_mutation !== true) blockers.push(`SEMANTIC_MUTATION_REQUIRED:${compact(file?.path, 500) || "unknown"}`);
    if (file?.bounded !== true) blockers.push(`SEMANTIC_MUTATION_UNBOUNDED:${compact(file?.path, 500) || "unknown"}`);
    if (format === "completion" && file?.completion_contract_valid !== true) {
      blockers.push(`COMPLETION_CONTRACT_INVALID:${compact(file?.path, 500) || "unknown"}`);
    }
  }
  for (const format of REQUIRED_SEMANTIC_FORMATS) {
    if (!observedFormats.has(format)) blockers.push(`SEMANTIC_MUTATION_FORMAT_COVERAGE_MISSING:${format}`);
  }
  return gateDiagnosis(PHASE5_GATE_IDS.SEMANTIC_MUTATION, blockers, "Validate semantic JSON, YAML, OpenAPI, and completion mutations.", input.evidence_refs, {
    file_count: files.length,
    formats: [...observedFormats].sort(),
  });
}

export function runSpec011Phase5GateSuite(input = {}) {
  const engineValidation = evaluateValidationLabEvidence(input.validation_lab || {});
  const engineDiagnosis = gateDiagnosis(
    PHASE5_GATE_IDS.ENGINE_VALIDATION,
    engineValidation.blockers,
    "Validate disposable MariaDB-compatible engine evidence before migration authorization.",
    input.validation_lab?.evidence_refs,
    { evidence_fingerprint: engineValidation.evidence_fingerprint },
  );
  const gates = [
    engineDiagnosis,
    evaluateContractDriftGate(input.contract_drift),
    evaluateStateMachineGate(input.state_machine),
    evaluateIdempotencyGate(input.idempotency),
    evaluateDelegationBoundaryGate(input.delegation_boundary),
    evaluateSemanticMutationGate(input.semantic_mutation),
  ];
  const invalid = gates.flatMap((gate) => validateStructuredDiagnosis(gate).blockers);
  const failed = gates.filter((gate) => gate.status !== "pass");
  const report = {
    ok: invalid.length === 0 && failed.length === 0,
    report_type: "spec011_phase5_structured_ci_report",
    schema_version: STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
    validation_version: SPEC011_PHASE5_VALIDATION_VERSION,
    status: invalid.length > 0 ? "invalid_diagnosis" : failed.length > 0 ? "failed" : "pass",
    gates,
    failed_gate_ids: failed.map((gate) => gate.gate_id),
    diagnosis_validation_blockers: [...new Set(invalid)],
    engine_validation_fingerprint: engineValidation.evidence_fingerprint,
    secrets_included: false,
  };
  assertSecretFree(report, "report");
  return report;
}

export function assertStructuredDiagnosisCoverage(report) {
  if (!report || typeof report !== "object") throw fail("STRUCTURED_CI_REPORT_REQUIRED", "Structured CI report is required.");
  const expected = new Set(Object.values(PHASE5_GATE_IDS));
  const observed = new Set((Array.isArray(report.gates) ? report.gates : []).map((gate) => gate?.gate_id));
  const missing = [...expected].filter((gateId) => !observed.has(gateId));
  const invalid = (Array.isArray(report.gates) ? report.gates : [])
    .flatMap((gate) => validateStructuredDiagnosis(gate).blockers);
  if (missing.length > 0 || invalid.length > 0) {
    throw fail("STRUCTURED_CI_DIAGNOSIS_INCOMPLETE", "Every Phase 5 check must emit a valid structured diagnosis.", {
      missing_gate_ids: missing,
      validation_blockers: [...new Set(invalid)],
    });
  }
  return {
    ok: true,
    gate_count: observed.size,
    secrets_included: false,
  };
}

export const _testingSpec011Phase5ValidationCi = {
  stable,
  sha256,
  assertSecretFree,
  REQUIRED_SEMANTIC_FORMATS,
};
