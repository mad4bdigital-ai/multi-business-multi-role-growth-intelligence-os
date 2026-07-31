import assert from "node:assert/strict";

import {
  classifyGrowthControlProviderEffectReadback,
  compileGrowthControlRollbackContract,
  growthControlProviderEffectReconciliationContract,
  growthControlProviderRollbackContract,
} from "./src/domain/growthControlPlane/growthControlProviderEffectReconciliation.js";
import {
  growthControlProviderEffectReconciliationServiceContract,
  readGrowthControlMutationReconciliation,
  reconcileGrowthControlMutationReceipt,
} from "./src/application/growthControlPlane/growthControlProviderEffectReconciliationService.js";

const RECEIPT_ID = "receipt-reconciliation-01";
const PLAN_ID = "plan-reconciliation-01";
const STEP_ID = "step-reconciliation-01";
const TENANT_ID = "tenant-reconciliation-01";
const REQUEST_HASH = "a".repeat(64);
const PLAN_HASH = "b".repeat(64);
const PROVIDER_STATE_HASH = "c".repeat(64);
const RESULT_HASH = "d".repeat(64);
const CERTIFICATION_HASH = "e".repeat(64);
const ACTION_IDS = ["asset.attach", "content.publish"];
const RESOURCE_IDS = ["provider:cms/site-01"];

const receiptBinding = Object.freeze({
  receiptId: RECEIPT_ID,
  planId: PLAN_ID,
  planStepId: STEP_ID,
  tenantId: TENANT_ID,
  operationKey: "content.publish",
  idempotencyKey: "idempotency-reconciliation-01",
  requestSha256: REQUEST_HASH,
  planHashSha256: PLAN_HASH,
  nodeId: "content.publish",
  capabilityKey: "content.publish",
  actionIds: ACTION_IDS,
  resourceIds: RESOURCE_IDS,
  environment: "production",
  effectClass: "provider_write",
});

function readback({
  effectState,
  appliedActionIds,
  unappliedActionIds,
  resultSha256 = null,
  providerStateSha256 = PROVIDER_STATE_HASH,
  evidenceRef = "evidence://provider/readback-01",
} = {}) {
  return {
    contractVersion: "provider-effect-readback-v1",
    effectState,
    requestSha256: REQUEST_HASH,
    planHashSha256: PLAN_HASH,
    actionIds: [...ACTION_IDS].reverse(),
    resourceIds: RESOURCE_IDS,
    appliedActionIds,
    unappliedActionIds,
    providerOperationRef: "provider-operation://cms/publish-01",
    evidenceRef,
    observedAt: "2030-01-01T00:10:00.000Z",
    providerStateSha256,
    resultSha256,
    certificationSha256: CERTIFICATION_HASH,
    readbackContractKey: "cms.publish.readback",
    secretsIncluded: false,
  };
}

const appliedReadback = readback({
  effectState: "applied",
  appliedActionIds: ACTION_IDS,
  unappliedActionIds: [],
  resultSha256: RESULT_HASH,
});
const applied = classifyGrowthControlProviderEffectReadback({ receiptBinding, readback: appliedReadback });
assert.equal(applied.outcome, "confirmed_applied");
assert.equal(applied.receipt_transition, "reconciled");
assert.equal(applied.step_disposition, "complete_from_readback");
assert.equal(applied.retry_disposition, "forbidden");
assert.equal(applied.automatic_retry_allowed, false);
assert.equal(applied.provider_dispatch_performed, false);
assert.equal(applied.secrets_included, false);
assert.match(applied.reconciliation_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(applied), true);
assert.equal(Object.isFrozen(applied.readback), true);

const notApplied = classifyGrowthControlProviderEffectReadback({
  receiptBinding,
  readback: readback({
    effectState: "not_applied",
    appliedActionIds: [],
    unappliedActionIds: ACTION_IDS,
  }),
});
assert.equal(notApplied.outcome, "confirmed_not_applied");
assert.equal(notApplied.new_request_required, true);
assert.equal(notApplied.retry_disposition, "new_request_only");
assert.equal(notApplied.automatic_retry_allowed, false);

const partialReadback = readback({
  effectState: "partial",
  appliedActionIds: ["content.publish"],
  unappliedActionIds: ["asset.attach"],
  resultSha256: RESULT_HASH,
});
const partial = classifyGrowthControlProviderEffectReadback({ receiptBinding, readback: partialReadback });
assert.equal(partial.outcome, "partial_effect");
assert.equal(partial.rollback_required, true);
assert.equal(partial.step_disposition, "rollback_or_manual_repair_required");

const unknownReadback = readback({
  effectState: "unknown",
  appliedActionIds: [],
  unappliedActionIds: [],
});
const unknown = classifyGrowthControlProviderEffectReadback({ receiptBinding, readback: unknownReadback });
assert.equal(unknown.outcome, "inconclusive");
assert.equal(unknown.receipt_transition, "unknown_outcome");
assert.equal(unknown.step_disposition, "readback_required");
assert.equal(unknown.retry_disposition, "forbidden");

const rollbackContract = compileGrowthControlRollbackContract({
  reconciliation: partial,
  compensation: {
    rollbackCapabilityKey: "content.rollback",
    rollbackActionIds: ["content.publish"],
    resourceIds: RESOURCE_IDS,
    environment: "production",
    endpointKey: "content.rollback",
    certificationKey: "cms.rollback.v1",
    approvalProfileKey: "production.rollback.approval",
    readbackKey: "cms.rollback.readback",
    expiresInSeconds: 900,
    maxAttempts: 1,
  },
});
assert.equal(rollbackContract.contract_version, "growth-control-provider-rollback-contract-v1");
assert.deepEqual(rollbackContract.rollback_action_ids, ["content.publish"]);
assert.equal(rollbackContract.approval_required, true);
assert.equal(rollbackContract.final_boundary_required, true);
assert.equal(rollbackContract.certification_required, true);
assert.equal(rollbackContract.resource_authority_required, true);
assert.equal(rollbackContract.readback_required, true);
assert.equal(rollbackContract.new_mutation_receipt_required, true);
assert.equal(rollbackContract.max_attempts, 1);
assert.equal(rollbackContract.blind_retry_allowed, false);
assert.equal(rollbackContract.automatic_rollback_allowed, false);
assert.equal(rollbackContract.execution_authorized, false);
assert.equal(rollbackContract.provider_dispatch_performed, false);
assert.match(rollbackContract.rollback_request_sha256, /^[a-f0-9]{64}$/);
assert.match(rollbackContract.idempotency_key, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(rollbackContract), true);

assert.throws(
  () => compileGrowthControlRollbackContract({
    reconciliation: partial,
    compensation: {
      rollbackCapabilityKey: "content.rollback",
      rollbackActionIds: ACTION_IDS,
      resourceIds: RESOURCE_IDS,
      environment: "production",
      endpointKey: "content.rollback",
      certificationKey: "cms.rollback.v1",
      approvalProfileKey: "production.rollback.approval",
      readbackKey: "cms.rollback.readback",
    },
  }),
  (error) => error?.code === "GROWTH_CONTROL_ROLLBACK_SCOPE_MISMATCH",
);
assert.throws(
  () => classifyGrowthControlProviderEffectReadback({
    receiptBinding,
    readback: { ...appliedReadback, requestSha256: "f".repeat(64) },
  }),
  (error) => error?.code === "GROWTH_CONTROL_RECONCILIATION_BINDING_MISMATCH",
);
assert.throws(
  () => classifyGrowthControlProviderEffectReadback({
    receiptBinding,
    readback: readback({
      effectState: "partial",
      appliedActionIds: ACTION_IDS,
      unappliedActionIds: ["content.publish"],
      resultSha256: RESULT_HASH,
    }),
  }),
  (error) => error?.code === "GROWTH_CONTROL_RECONCILIATION_PARTITION_INVALID",
);
assert.throws(
  () => classifyGrowthControlProviderEffectReadback({
    receiptBinding,
    readback: { ...appliedReadback, api_key: "forbidden" },
  }),
  (error) => error?.code === "GROWTH_CONTROL_RECONCILIATION_SENSITIVE_INPUT",
);

function createState({ effectStatus = "unknown_outcome" } = {}) {
  return {
    receipt: {
      receipt_id: RECEIPT_ID,
      plan_id: PLAN_ID,
      plan_step_id: STEP_ID,
      tenant_id: TENANT_ID,
      operation_key: "content.publish",
      idempotency_key: "idempotency-reconciliation-01",
      request_sha256: REQUEST_HASH,
      dispatch_status: effectStatus,
      provider_status: 503,
      provider_receipt_json: JSON.stringify({ ok: false, code: "transport_failure", secrets_included: false }),
      readback_json: null,
      recovered_from_transport: 1,
      updated_at: "2030-01-01T00:00:00.000Z",
    },
    step: {
      plan_step_id: STEP_ID,
      plan_id: PLAN_ID,
      tenant_id: TENANT_ID,
      step_key: "content.publish",
      workflow_key: "content.publish",
      status: "failed",
      input_json: JSON.stringify({
        plan_hash_sha256: PLAN_HASH,
        node_id: "content.publish",
        capability_key: "content.publish",
        action_ids: ACTION_IDS,
        resource_ids: RESOURCE_IDS,
        environment: "production",
        effect_class: "provider_write",
      }),
      output_json: null,
      error_json: JSON.stringify({ code: "durable_execution_dispatch_failed" }),
      claim_token: null,
      completed_at: null,
    },
    plan: {
      plan_id: PLAN_ID,
      tenant_id: TENANT_ID,
      plan_status: "failed",
      runtime_status: "blocked",
    },
    otherBlockerCount: 0,
    events: [],
  };
}

function createPool(state) {
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (text.startsWith("SELECT * FROM execution_plan_mutation_receipts")) {
        const matches = state.receipt.receipt_id === params[0]
          && state.receipt.plan_id === params[1]
          && state.receipt.plan_step_id === params[2]
          && state.receipt.tenant_id === params[3];
        return [matches ? [state.receipt] : [], []];
      }
      if (text.startsWith("SELECT * FROM execution_plan_steps")) {
        const matches = state.step.plan_step_id === params[0]
          && state.step.plan_id === params[1]
          && state.step.tenant_id === params[2];
        return [matches ? [state.step] : [], []];
      }
      if (text.startsWith("UPDATE execution_plan_mutation_receipts") && text.includes("provider_receipt_json")) {
        if (!["pending", "unknown_outcome"].includes(state.receipt.dispatch_status)) return [{ affectedRows: 0 }];
        state.receipt.dispatch_status = "reconciled";
        state.receipt.provider_receipt_json = params[0];
        state.receipt.readback_json = params[1];
        state.receipt.recovered_from_transport = 1;
        return [{ affectedRows: 1 }];
      }
      if (text.startsWith("UPDATE execution_plan_mutation_receipts") && text.includes("dispatch_status = 'unknown_outcome'")) {
        if (!["pending", "unknown_outcome"].includes(state.receipt.dispatch_status)) return [{ affectedRows: 0 }];
        state.receipt.dispatch_status = "unknown_outcome";
        state.receipt.readback_json = params[0];
        state.receipt.recovered_from_transport = 1;
        return [{ affectedRows: 1 }];
      }
      if (text.startsWith("UPDATE execution_plan_steps") && text.includes("status = 'completed'")) {
        if (!["failed", "blocked"].includes(state.step.status)) return [{ affectedRows: 0 }];
        state.step.status = "completed";
        state.step.output_json = params[0];
        state.step.error_json = null;
        state.step.claim_token = null;
        state.step.completed_at = state.step.completed_at || "2030-01-01T00:10:00.000Z";
        return [{ affectedRows: 1 }];
      }
      if (text.startsWith("SELECT COUNT(*) AS blocker_count")) {
        return [[{ blocker_count: state.otherBlockerCount }], []];
      }
      if (text.startsWith("UPDATE execution_plan_steps") && text.includes("status = 'blocked'")) {
        if (!["failed", "blocked"].includes(state.step.status)) return [{ affectedRows: 0 }];
        state.step.status = "blocked";
        state.step.error_json = params[0];
        state.step.claim_token = null;
        return [{ affectedRows: 1 }];
      }
      if (text.startsWith("UPDATE execution_plans SET plan_status = ?, runtime_status = ?")) {
        state.plan.plan_status = params[0];
        state.plan.runtime_status = params[1];
        return [{ affectedRows: 1 }];
      }
      if (text.startsWith("UPDATE execution_plans SET plan_status = 'failed', runtime_status = 'blocked'")) {
        state.plan.plan_status = "failed";
        state.plan.runtime_status = "blocked";
        return [{ affectedRows: 1 }];
      }
      if (text.startsWith("INSERT INTO execution_plan_events")) {
        state.events.push({
          plan_event_id: params[0],
          plan_id: params[1],
          plan_step_id: params[2],
          tenant_id: params[3],
          event_type: params[4],
          from_status: params[5],
          to_status: params[6],
          actor_id: params[7],
          evidence_json: params[8],
        });
        return [{ affectedRows: 1 }];
      }
      if (text.startsWith("SELECT receipt_id, plan_id, plan_step_id")) {
        return [[state.receipt], []];
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  return {
    async getConnection() { return connection; },
    query: connection.query.bind(connection),
  };
}

const appliedState = createState();
const appliedPool = createPool(appliedState);
const appliedResult = await reconcileGrowthControlMutationReceipt({
  pool: appliedPool,
  receiptId: RECEIPT_ID,
  planId: PLAN_ID,
  planStepId: STEP_ID,
  tenantId: TENANT_ID,
  readback: appliedReadback,
  actorId: "operator-reconciliation-01",
});
assert.equal(appliedResult.ok, true);
assert.equal(appliedResult.idempotent_replay, false);
assert.equal(appliedResult.dispatch_status, "reconciled");
assert.equal(appliedResult.reconciliation.outcome, "confirmed_applied");
assert.equal(appliedResult.step_status, "completed");
assert.equal(appliedResult.plan_status, "validated");
assert.equal(appliedResult.retry_allowed, false);
assert.equal(appliedResult.provider_call_made, false);
assert.equal(appliedResult.provider_dispatch_performed, false);
assert.equal(appliedState.receipt.dispatch_status, "reconciled");
assert.equal(appliedState.step.status, "completed");
assert.equal(appliedState.plan.plan_status, "validated");
assert.equal(appliedState.plan.runtime_status, "validated");
assert.equal(appliedState.events.length, 1);
assert.equal(appliedState.events[0].event_type, "provider_effect_reconciled_applied");

const appliedReplay = await reconcileGrowthControlMutationReceipt({
  pool: appliedPool,
  receiptId: RECEIPT_ID,
  planId: PLAN_ID,
  planStepId: STEP_ID,
  tenantId: TENANT_ID,
  readback: appliedReadback,
});
assert.equal(appliedReplay.idempotent_replay, true);
assert.equal(appliedReplay.dispatch_status, "reconciled");
assert.equal(appliedState.events.length, 1, "idempotent replay must not append another event");

await assert.rejects(
  () => reconcileGrowthControlMutationReceipt({
    pool: appliedPool,
    receiptId: RECEIPT_ID,
    planId: PLAN_ID,
    planStepId: STEP_ID,
    tenantId: TENANT_ID,
    readback: { ...appliedReadback, providerStateSha256: "f".repeat(64) },
  }),
  (error) => error?.code === "growth_control_reconciliation_conflict",
);

const projection = await readGrowthControlMutationReconciliation({
  pool: appliedPool,
  receiptId: RECEIPT_ID,
  planId: PLAN_ID,
  planStepId: STEP_ID,
  tenantId: TENANT_ID,
});
assert.equal(projection.dispatch_status, "reconciled");
assert.equal(projection.reconciliation.outcome, "confirmed_applied");
assert.equal(projection.retry_allowed, false);
assert.equal(projection.provider_dispatch_performed, false);
assert.equal(projection.secrets_included, false);

const unknownState = createState();
const unknownResult = await reconcileGrowthControlMutationReceipt({
  pool: createPool(unknownState),
  receiptId: RECEIPT_ID,
  planId: PLAN_ID,
  planStepId: STEP_ID,
  tenantId: TENANT_ID,
  readback: unknownReadback,
});
assert.equal(unknownResult.dispatch_status, "unknown_outcome");
assert.equal(unknownResult.reconciliation.outcome, "inconclusive");
assert.equal(unknownResult.step_status, "blocked");
assert.equal(unknownResult.next_action, "readback_required");
assert.equal(unknownState.receipt.dispatch_status, "unknown_outcome");
assert.equal(unknownState.step.status, "blocked");
assert.equal(JSON.parse(unknownState.step.error_json).unknown_outcome, true);
assert.equal(unknownState.events[0].event_type, "provider_effect_reconciliation_inconclusive");

const partialState = createState();
const partialResult = await reconcileGrowthControlMutationReceipt({
  pool: createPool(partialState),
  receiptId: RECEIPT_ID,
  planId: PLAN_ID,
  planStepId: STEP_ID,
  tenantId: TENANT_ID,
  readback: partialReadback,
  compensation: {
    rollbackCapabilityKey: "content.rollback",
    rollbackActionIds: ["content.publish"],
    resourceIds: RESOURCE_IDS,
    environment: "production",
    endpointKey: "content.rollback",
    certificationKey: "cms.rollback.v1",
    approvalProfileKey: "production.rollback.approval",
    readbackKey: "cms.rollback.readback",
  },
});
assert.equal(partialResult.dispatch_status, "reconciled");
assert.equal(partialResult.reconciliation.outcome, "partial_effect");
assert.equal(partialResult.step_status, "blocked");
assert.equal(partialResult.next_action, "rollback_or_manual_repair_required");
assert.match(partialResult.rollback_contract.rollback_request_sha256, /^[a-f0-9]{64}$/);
assert.equal(partialResult.rollback_contract.execution_authorized, false);
assert.equal(partialState.receipt.dispatch_status, "reconciled");
assert.equal(partialState.step.status, "blocked");
assert.equal(JSON.parse(partialState.step.error_json).rollback_required, true);
assert.equal(partialState.events[0].event_type, "provider_effect_reconciled_partial");

assert.equal(growthControlProviderEffectReconciliationContract.blind_retry_allowed, false);
assert.equal(growthControlProviderEffectReconciliationContract.automatic_rollback_allowed, false);
assert.equal(growthControlProviderRollbackContract.separate_approval_required, true);
assert.equal(growthControlProviderRollbackContract.max_attempts, 1);
assert.equal(growthControlProviderEffectReconciliationServiceContract.receipt_authority, "execution_plan_mutation_receipts");
assert.equal(growthControlProviderEffectReconciliationServiceContract.automatic_retry_allowed, false);
assert.equal(growthControlProviderEffectReconciliationServiceContract.automatic_rollback_allowed, false);
assert.equal(growthControlProviderEffectReconciliationServiceContract.provider_dispatch_performed, false);

console.log("growth control provider effect reconciliation tests passed");
