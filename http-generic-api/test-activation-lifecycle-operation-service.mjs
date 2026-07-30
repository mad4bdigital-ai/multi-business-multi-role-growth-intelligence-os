import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createActivationLifecycleOperationService } from "./activationLifecycleOperationService.js";
import {
  authorizeActivationRetryRequest,
  resolveActivationReconciliationOutcome,
} from "./activationRetryReconciliationPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "tenant-user-1";
const subject = { tenant_id: tenantId, user_id: userId, is_admin: false };

function operation(id, status, version = 0) {
  return {
    operation_id: id,
    tenant_id: tenantId,
    user_id: userId,
    current_stage: status,
    operation_status: status,
    optimistic_version: version,
  };
}

function createFakeRepository(initialOperations = []) {
  const state = {
    operations: new Map(initialOperations.map((item) => [item.operation_id, { ...item }])),
    stage_attempts: [],
    evidence: [],
    reconciliations: [],
  };

  const scopedOperation = ({ operation_id, tenant_id, user_id, is_admin }) => {
    const row = state.operations.get(operation_id) || null;
    if (!row || row.tenant_id !== tenant_id) return null;
    if (!is_admin && row.user_id !== user_id) return null;
    return row;
  };

  return {
    state,
    async readOperation(_pool, input) {
      const row = scopedOperation(input);
      return row ? { ...row } : null;
    },
    async updateOperation(_pool, input) {
      const row = scopedOperation(input);
      if (!row || Number(row.optimistic_version) !== Number(input.expected_version)) {
        const error = new Error("version conflict");
        error.code = "activation_operation_version_conflict";
        error.status = 409;
        throw error;
      }
      Object.assign(row, input.patch);
      row.optimistic_version += 1;
      return { updated: true, optimistic_version: row.optimistic_version };
    },
    async appendStageAttempt(_pool, input) {
      const duplicate = state.stage_attempts.find(
        (item) =>
          item.operation_id === input.operation_id &&
          item.stage_key === input.stage_key &&
          item.attempt_number === input.attempt_number,
      );
      if (duplicate) {
        const error = new Error("duplicate stage attempt");
        error.code = "activation_stage_attempt_conflict";
        error.status = 409;
        throw error;
      }
      const attempt_id = `20000000-0000-4000-8000-${String(state.stage_attempts.length + 1).padStart(12, "0")}`;
      state.stage_attempts.push({ attempt_id, ...input });
      return { attempt_id, affected_rows: 1 };
    },
    async nextStageAttemptNumber(_pool, input) {
      const numbers = state.stage_attempts
        .filter(
          (item) =>
            item.operation_id === input.operation_id &&
            item.tenant_id === input.tenant_id &&
            item.stage_key === input.stage_key,
        )
        .map((item) => item.attempt_number);
      return Math.max(0, ...numbers) + 1;
    },
    async readStageAttempt(_pool, input) {
      const row = state.stage_attempts.find(
        (item) =>
          item.attempt_id === input.attempt_id &&
          item.operation_id === input.operation_id &&
          item.tenant_id === input.tenant_id,
      );
      return row ? { ...row } : null;
    },
    async transitionStageAttempt(_pool, input) {
      const row = state.stage_attempts.find(
        (item) =>
          item.attempt_id === input.attempt_id &&
          item.operation_id === input.operation_id &&
          item.tenant_id === input.tenant_id,
      );
      if (!row) throw new Error("missing attempt");
      if (row.attempt_status === input.to_status) {
        return { updated: false, idempotent: true, state: input.to_status };
      }
      if (row.attempt_status !== input.from_status) {
        const error = new Error("stage transition conflict");
        error.code = "activation_stage_attempt_transition_conflict";
        error.status = 409;
        throw error;
      }
      Object.assign(row, {
        attempt_status: input.to_status,
        retryable: input.retryable === true,
        unknown_outcome: input.unknown_outcome === true,
        error_code: input.error_code || null,
        error_message: input.error_message || null,
        evidence_ref: input.evidence_ref || null,
      });
      return { updated: true, idempotent: false, state: input.to_status };
    },
    async appendEvidence(_pool, input) {
      const evidence_id = `30000000-0000-4000-8000-${String(state.evidence.length + 1).padStart(12, "0")}`;
      state.evidence.push({ evidence_id, ...input, secrets_included: false });
      return { evidence_id, affected_rows: 1, secrets_included: false };
    },
    async hasSameOperationEvidence(_pool, input) {
      return state.evidence.some(
        (item) =>
          item.operation_id === input.operation_id &&
          item.tenant_id === input.tenant_id &&
          item.secrets_included === false,
      );
    },
    async nextReconciliationAttemptNumber(_pool, input) {
      const numbers = state.reconciliations
        .filter(
          (item) =>
            item.operation_id === input.operation_id &&
            item.tenant_id === input.tenant_id,
        )
        .map((item) => item.attempt_number);
      return Math.max(0, ...numbers) + 1;
    },
    async appendReconciliation(_pool, input) {
      const reconciliation_id = `40000000-0000-4000-8000-${String(state.reconciliations.length + 1).padStart(12, "0")}`;
      state.reconciliations.push({ reconciliation_id, ...input });
      return { reconciliation_id, affected_rows: 1 };
    },
    async completeReconciliation(_pool, input) {
      const row = state.reconciliations.find(
        (item) =>
          item.reconciliation_id === input.reconciliation_id &&
          item.operation_id === input.operation_id &&
          item.tenant_id === input.tenant_id,
      );
      if (!row || row.reconciliation_status !== input.from_status) {
        const error = new Error("reconciliation transition conflict");
        error.code = "activation_reconciliation_transition_conflict";
        error.status = 409;
        throw error;
      }
      Object.assign(row, {
        reconciliation_status: input.to_status,
        outcome_code: input.outcome_code,
        evidence_ref: input.evidence_ref,
      });
      return { updated: true, idempotent: false, state: input.to_status };
    },
  };
}

function fakePool() {
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };
  return { async getConnection() { return connection; } };
}

assert.throws(
  () =>
    authorizeActivationRetryRequest({
      operation_status: "degraded",
      target_status: "executing",
      governed_retry_approved: false,
      approval_ref: "approval-1",
    }),
  (error) => error?.code === "activation_governed_retry_approval_required" && error?.status === 403,
);
assert.throws(
  () =>
    authorizeActivationRetryRequest({
      operation_status: "unknown_outcome",
      target_status: "executing",
      governed_retry_approved: true,
      approval_ref: "approval-1",
    }),
  (error) => error?.code === "activation_reconciliation_required" && error?.status === 409,
);
assert.deepEqual(
  authorizeActivationRetryRequest({
    operation_status: "degraded",
    target_status: "executing",
    governed_retry_approved: true,
    approval_ref: "approval-1",
  }),
  {
    allowed: true,
    source_status: "degraded",
    scheduled_status: "retry_scheduled",
    target_status: "executing",
    approval_ref: "approval-1",
    requires_new_stage_attempt: true,
    blind_replay_allowed: false,
  },
);
assert.throws(
  () => resolveActivationReconciliationOutcome({ outcome: "executed", operation_id: "op-1" }),
  (error) => error?.code === "activation_evidence_operation_id_required" || error?.code === "activation_evidence_operation_id_required",
);
assert.deepEqual(
  resolveActivationReconciliationOutcome({ outcome: "not_executed" }),
  {
    outcome: "not_executed",
    operation_status: "degraded",
    retry_allowed: true,
    governed_retry_required: true,
    reconciliation_required: false,
  },
);

const op1 = "10000000-0000-4000-8000-000000000001";
const op2 = "10000000-0000-4000-8000-000000000002";
const op3 = "10000000-0000-4000-8000-000000000003";
const op4 = "10000000-0000-4000-8000-000000000004";
const repository = createFakeRepository([
  operation(op1, "created"),
  operation(op2, "degraded"),
  operation(op3, "unknown_outcome"),
  operation(op4, "reconciling"),
]);
const service = createActivationLifecycleOperationService({ repository });
const pool = fakePool();

const authorized = await service.transitionOperation({
  pool,
  subject,
  operation_id: op1,
  expected_version: 0,
  to_status: "authorized",
  current_stage: "gateway",
});
assert.equal(authorized.optimistic_version, 1);

const stage = await service.startStageAttempt({
  pool,
  subject,
  operation_id: op1,
  stage_key: "session",
  operation_target_status: "resolving_session",
  expected_version: 1,
});
assert.equal(stage.attempt_number, 1);
assert.equal(stage.attempt_status, "running");
assert.equal(stage.optimistic_version, 2);

const completedStage = await service.completeStageAttempt({
  pool,
  subject,
  operation_id: op1,
  attempt_id: stage.attempt_id,
  to_status: "succeeded",
  evidence: {
    evidence_type: "session_resolution",
    source_type: "session_registry",
    evidence: { membership_verified: true, token: "must-be-sanitized-by-default-repository" },
  },
});
assert.equal(completedStage.to_status, "succeeded");
assert.ok(completedStage.evidence_id);

await service.transitionOperation({
  pool,
  subject,
  operation_id: op1,
  expected_version: 2,
  to_status: "bootstrapping",
  current_stage: "bootstrap",
});
await service.transitionOperation({
  pool,
  subject,
  operation_id: op1,
  expected_version: 3,
  to_status: "ready",
  current_stage: "ready",
});
const active = await service.transitionOperation({
  pool,
  subject,
  operation_id: op1,
  expected_version: 4,
  to_status: "active",
  current_stage: "active",
});
assert.equal(active.evidence_verified, true);
assert.equal(active.optimistic_version, 5);
assert.throws(
  () =>
    authorizeActivationRetryRequest({
      operation_status: repository.state.operations.get(op1).operation_status,
      target_status: "executing",
      governed_retry_approved: true,
      approval_ref: "approval-terminal",
    }),
  (error) => error?.code === "activation_retry_terminal",
);

await assert.rejects(
  service.scheduleRetry({
    pool,
    subject,
    operation_id: op2,
    expected_version: 0,
    target_status: "executing",
    governed_retry_approved: false,
    approval_ref: "approval-2",
  }),
  (error) => error?.code === "activation_governed_retry_approval_required",
);
const scheduled = await service.scheduleRetry({
  pool,
  subject,
  operation_id: op2,
  expected_version: 0,
  target_status: "executing",
  governed_retry_approved: true,
  approval_ref: "approval-2",
});
assert.equal(scheduled.scheduled_status, "retry_scheduled");
assert.equal(scheduled.optimistic_version, 1);
assert.equal(repository.state.operations.get(op2).operation_status, "retry_scheduled");
assert.equal(repository.state.evidence.at(-1).evidence_type, "governed_retry_authorization");

await assert.rejects(
  service.scheduleRetry({
    pool,
    subject,
    operation_id: op3,
    expected_version: 0,
    target_status: "executing",
    governed_retry_approved: true,
    approval_ref: "approval-3",
  }),
  (error) => error?.code === "activation_reconciliation_required",
);
const reconciliation = await service.beginReconciliation({
  pool,
  subject,
  operation_id: op3,
  expected_version: 0,
});
assert.equal(reconciliation.operation_status, "reconciling");
assert.equal(reconciliation.optimistic_version, 1);
const stillUnknown = await service.completeReconciliation({
  pool,
  subject,
  operation_id: op3,
  reconciliation_id: reconciliation.reconciliation_id,
  expected_version: 1,
  outcome: "still_unknown",
});
assert.equal(stillUnknown.operation_status, "unknown_outcome");
assert.equal(stillUnknown.reconciliation_required, true);

const reconciliation2 = await service.beginReconciliation({
  pool,
  subject,
  operation_id: op3,
  expected_version: 2,
});
const notExecuted = await service.completeReconciliation({
  pool,
  subject,
  operation_id: op3,
  reconciliation_id: reconciliation2.reconciliation_id,
  expected_version: 3,
  outcome: "not_executed",
});
assert.equal(notExecuted.operation_status, "degraded");
assert.equal(notExecuted.retry_allowed, true);
const safeRetry = await service.scheduleRetry({
  pool,
  subject,
  operation_id: op3,
  expected_version: 4,
  target_status: "executing",
  governed_retry_approved: true,
  approval_ref: "approval-after-readback",
});
assert.equal(safeRetry.optimistic_version, 5);

await assert.rejects(
  service.completeReconciliation({
    pool,
    subject,
    operation_id: op4,
    reconciliation_id: "40000000-0000-4000-8000-999999999999",
    expected_version: 0,
    outcome: "executed",
  }),
  (error) => error?.code === "activation_evidence_operation_id_required" || error?.code === "activation_evidence_operation_id_required",
);

for (const runtimeFile of [
  "server.js",
  "activationSessionLifecycleService.js",
  "activationHardResponseService.js",
]) {
  const source = fs.readFileSync(path.join(__dirname, runtimeFile), "utf8");
  assert.doesNotMatch(
    source,
    /activationLifecycleOperationService/,
    `${runtimeFile} must not wire the T027/T029 service before a governed runtime integration slice`,
  );
}
const ci = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
assert.match(ci, /node test-activation-lifecycle-operation-service\.mjs/);

console.log("activation lifecycle operation service tests passed");
