import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_SAFE_EVIDENCE_REDACTION_STATES,
  ACTIVATION_STAGE_ATTEMPT_TRANSITIONS,
  createActivationOperationPersistenceRepository,
  hasScopedActivationEvidenceItem,
  nextActivationReconciliationAttemptNumber,
  nextActivationStageAttemptNumber,
  readActivationEvidenceItem,
  readActivationReconciliationAttempt,
  readActivationStageAttempt,
  transitionActivationStageAttempt,
} from "./activationOperationPersistenceRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const operationId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const reconciliationId = "44444444-4444-4444-8444-444444444444";
const evidenceId = "55555555-5555-4555-8555-555555555555";

assert.deepEqual([...ACTIVATION_SAFE_EVIDENCE_REDACTION_STATES].sort(), [
  "reference_only",
  "sanitized",
]);
assert.deepEqual(ACTIVATION_STAGE_ATTEMPT_TRANSITIONS.pending, ["running", "cancelled"]);
assert(ACTIVATION_STAGE_ATTEMPT_TRANSITIONS.running.includes("unknown_outcome"));
assert.equal(Object.isFrozen(ACTIVATION_STAGE_ATTEMPT_TRANSITIONS), true);

const numberCalls = [];
const numberPool = {
  async query(sql, params) {
    numberCalls.push({ sql, params });
    if (/FROM activation_operation_projections/.test(sql)) {
      return [[{ operation_id: operationId }]];
    }
    if (/FROM activation_stage_attempts/.test(sql)) {
      return [[{ next_attempt_number: 3 }]];
    }
    if (/FROM activation_reconciliation_attempts/.test(sql)) {
      return [[{ next_attempt_number: 2 }]];
    }
    throw new Error(`unexpected number query: ${sql}`);
  },
};
assert.equal(
  await nextActivationStageAttemptNumber(numberPool, {
    operation_id: operationId,
    tenant_id: tenantId,
    stage_key: "provider_bootstrap",
  }),
  3,
);
assert.equal(
  await nextActivationReconciliationAttemptNumber(numberPool, {
    operation_id: operationId,
    tenant_id: tenantId,
  }),
  2,
);
assert.equal(numberCalls.length, 4);
const lockCalls = numberCalls.filter(({ sql }) => /FROM activation_operation_projections/.test(sql));
assert.equal(lockCalls.length, 2);
for (const call of lockCalls) {
  assert.match(call.sql, /FOR UPDATE/);
  assert.deepEqual(call.params, [operationId, tenantId]);
}
const stageNumberCall = numberCalls.find(({ sql }) => /FROM activation_stage_attempts/.test(sql));
const reconciliationNumberCall = numberCalls.find(({ sql }) =>
  /FROM activation_reconciliation_attempts/.test(sql),
);
for (const call of [stageNumberCall, reconciliationNumberCall]) {
  assert.match(call.sql, /COALESCE\(MAX\(attempt_number\), 0\) \+ 1/);
  assert.doesNotMatch(call.sql, /FOR UPDATE/);
  assert.match(call.sql, /operation_id = \?/);
  assert.match(call.sql, /tenant_id = \?/);
  assert(call.params.includes(operationId));
  assert(call.params.includes(tenantId));
}
assert.match(stageNumberCall.sql, /stage_key = \?/);
assert(stageNumberCall.params.includes("provider_bootstrap"));

await assert.rejects(
  () =>
    nextActivationStageAttemptNumber({ async query() { return [[]]; } }, {
      operation_id: operationId,
      tenant_id: tenantId,
      stage_key: "provider_bootstrap",
    }),
  (error) => error?.code === "activation_operation_not_found" && error?.status === 404,
);

const stageRow = {
  attempt_id: attemptId,
  operation_id: operationId,
  tenant_id: tenantId,
  stage_key: "provider_bootstrap",
  attempt_number: 1,
  source_type: "platform_native",
  attempt_status: "running",
  retryable: 0,
  unknown_outcome: 0,
  error_code: null,
};
const stageReadCalls = [];
const stageReadPool = {
  async query(sql, params) {
    stageReadCalls.push({ sql, params });
    return [[stageRow]];
  },
};
assert.deepEqual(
  await readActivationStageAttempt(stageReadPool, {
    attempt_id: attemptId,
    operation_id: operationId,
    tenant_id: tenantId,
  }),
  stageRow,
);
assert.match(stageReadCalls[0].sql, /FROM activation_stage_attempts/);
assert.doesNotMatch(stageReadCalls[0].sql, /error_message|evidence_ref/);
assert.deepEqual(stageReadCalls[0].params, [attemptId, operationId, tenantId]);

const reconciliationRow = {
  reconciliation_id: reconciliationId,
  operation_id: operationId,
  tenant_id: tenantId,
  attempt_number: 1,
  reason_code: "unknown_outcome",
  source_type: "platform_native",
  reconciliation_status: "pending",
};
const reconciliationReadCalls = [];
const reconciliationReadPool = {
  async query(sql, params) {
    reconciliationReadCalls.push({ sql, params });
    return [[reconciliationRow]];
  },
};
assert.deepEqual(
  await readActivationReconciliationAttempt(reconciliationReadPool, {
    reconciliation_id: reconciliationId,
    operation_id: operationId,
    tenant_id: tenantId,
  }),
  reconciliationRow,
);
assert.match(reconciliationReadCalls[0].sql, /FROM activation_reconciliation_attempts/);
assert.doesNotMatch(reconciliationReadCalls[0].sql, /evidence_ref/);
assert.deepEqual(reconciliationReadCalls[0].params, [
  reconciliationId,
  operationId,
  tenantId,
]);

const evidenceRow = {
  evidence_id: evidenceId,
  operation_id: operationId,
  attempt_id: attemptId,
  tenant_id: tenantId,
  evidence_type: "activation_success_readback",
  source_type: "runtime_readback",
  evidence_sha256: "a".repeat(64),
  summary_json: { status: "active" },
  summary_bytes: 19,
  redaction_state: "sanitized",
};
const evidenceReadCalls = [];
const evidenceReadPool = {
  async query(sql, params) {
    evidenceReadCalls.push({ sql, params });
    return [[evidenceRow]];
  },
};
assert.deepEqual(
  await readActivationEvidenceItem(evidenceReadPool, {
    evidence_id: evidenceId,
    operation_id: operationId,
    tenant_id: tenantId,
  }),
  evidenceRow,
);
assert.match(evidenceReadCalls[0].sql, /secrets_included = 0/);
assert.match(evidenceReadCalls[0].sql, /redaction_state IN \('sanitized', 'reference_only'\)/);
assert.match(evidenceReadCalls[0].sql, /summary_bytes <= \?/);
assert.doesNotMatch(
  evidenceReadCalls[0].sql,
  /source_ref|authorization|credential|password|token/i,
);
assert.deepEqual(evidenceReadCalls[0].params, [evidenceId, operationId, tenantId, 32768]);

const evidenceExistenceCalls = [];
const evidenceExistencePool = {
  async query(sql, params) {
    evidenceExistenceCalls.push({ sql, params });
    return [[{ evidence_id: evidenceId }]];
  },
};
assert.equal(
  await hasScopedActivationEvidenceItem(evidenceExistencePool, {
    evidence_id: evidenceId,
    operation_id: operationId,
    tenant_id: tenantId,
    evidence_types: ["activation_success_readback", "reconciliation_readback"],
  }),
  true,
);
assert.match(evidenceExistenceCalls[0].sql, /evidence_id = \?/);
assert.match(evidenceExistenceCalls[0].sql, /evidence_type IN \(\?,\?\)/);
assert.deepEqual(evidenceExistenceCalls[0].params, [
  evidenceId,
  operationId,
  tenantId,
  32768,
  "activation_success_readback",
  "reconciliation_readback",
]);
assert.equal(
  await hasScopedActivationEvidenceItem({ async query() { return [[]]; } }, {
    evidence_id: evidenceId,
    operation_id: operationId,
    tenant_id: tenantId,
  }),
  false,
);
await assert.rejects(
  () =>
    hasScopedActivationEvidenceItem(evidenceExistencePool, {
      evidence_id: evidenceId,
      operation_id: operationId,
      tenant_id: tenantId,
      evidence_types: [],
    }),
  (error) => error?.code === "activation_evidence_types_invalid",
);

const transitionCalls = [];
const transitionPool = {
  async query(sql, params) {
    transitionCalls.push({ sql, params });
    if (/^UPDATE activation_stage_attempts/.test(sql.trim())) return [{ affectedRows: 1 }];
    throw new Error(`unexpected transition query: ${sql}`);
  },
};
assert.deepEqual(
  await transitionActivationStageAttempt(transitionPool, {
    attempt_id: attemptId,
    operation_id: operationId,
    tenant_id: tenantId,
    from_status: "running",
    to_status: "unknown_outcome",
    retryable: false,
    error_code: "provider_timeout",
    error_message: "provider outcome is unknown",
    evidence_ref: `evidence:${evidenceId}`,
  }),
  { updated: true, idempotent: false, state: "unknown_outcome" },
);
assert.match(transitionCalls[0].sql, /completed_at = CASE/);
assert.match(transitionCalls[0].sql, /attempt_id = \?/);
assert.match(transitionCalls[0].sql, /operation_id = \?/);
assert.match(transitionCalls[0].sql, /tenant_id = \?/);
assert.equal(transitionCalls[0].params[0], "unknown_outcome");
assert.equal(transitionCalls[0].params[2], 1);
assert.equal(transitionCalls[0].params[6], 1);
await assert.rejects(
  () =>
    transitionActivationStageAttempt(transitionPool, {
      attempt_id: attemptId,
      operation_id: operationId,
      tenant_id: tenantId,
      from_status: "succeeded",
      to_status: "running",
    }),
  (error) => error?.code === "activation_stage_attempt_transition_invalid",
);

let idempotentQueryCount = 0;
const idempotentPool = {
  async query(sql) {
    idempotentQueryCount += 1;
    if (/^UPDATE activation_stage_attempts/.test(sql.trim())) return [{ affectedRows: 0 }];
    return [[{ ...stageRow, attempt_status: "succeeded" }]];
  },
};
assert.deepEqual(
  await transitionActivationStageAttempt(idempotentPool, {
    attempt_id: attemptId,
    operation_id: operationId,
    tenant_id: tenantId,
    from_status: "running",
    to_status: "succeeded",
  }),
  { updated: false, idempotent: true, state: "succeeded" },
);
assert.equal(idempotentQueryCount, 2);

const conflictPool = {
  async query(sql) {
    if (/^UPDATE activation_stage_attempts/.test(sql.trim())) return [{ affectedRows: 0 }];
    return [[{ ...stageRow, attempt_status: "failed" }]];
  },
};
await assert.rejects(
  () =>
    transitionActivationStageAttempt(conflictPool, {
      attempt_id: attemptId,
      operation_id: operationId,
      tenant_id: tenantId,
      from_status: "running",
      to_status: "succeeded",
    }),
  (error) =>
    error?.code === "activation_stage_attempt_transition_conflict" &&
    error?.status === 409,
);

const repository = createActivationOperationPersistenceRepository();
for (const method of [
  "createOperation",
  "readOperation",
  "updateOperation",
  "appendStageAttempt",
  "nextStageAttemptNumber",
  "readStageAttempt",
  "transitionStageAttempt",
  "appendEvidence",
  "readEvidence",
  "hasEvidence",
  "hasSameOperationSuccessEvidence",
  "appendReconciliation",
  "nextReconciliationAttemptNumber",
  "readReconciliation",
  "completeReconciliation",
]) {
  assert.equal(typeof repository[method], "function", `${method} must be available`);
}
assert.equal(Object.isFrozen(repository), true);

const serviceSource = fs.readFileSync(
  path.join(__dirname, "activationLifecycleOperationService.js"),
  "utf8",
);
assert.match(serviceSource, /createActivationLifecycleOperationService/);
for (const runtimeFile of [
  "server.js",
  "activationSessionLifecycleService.js",
  "activationHardResponseService.js",
]) {
  const source = fs.readFileSync(path.join(__dirname, runtimeFile), "utf8");
  assert.doesNotMatch(
    source,
    /activationOperationPersistenceRepository/,
    `${runtimeFile} must not wire the persistence repository before migration apply/readback`,
  );
}
const migration = fs.readFileSync(
  path.join(__dirname, "migrations", "20260724_activation_operation_projection_foundation.sql"),
  "utf8",
);
assert.match(migration, /not authorized for apply by this PR/i);
assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE|ALTER)\b/im);

console.log("activation operation persistence repository tests passed");
