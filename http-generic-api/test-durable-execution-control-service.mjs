import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertDurablePlanTransition,
  createDurableReceiptAwareExecutor,
  durableExecutionControlContract,
  projectDurableNextAction,
} from "./durableExecutionControlService.js";

function createReceiptPool(events = []) {
  const receipts = [];
  const query = async (sql, params = []) => {
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    if (normalized.includes("SELECT * FROM execution_plan_mutation_receipts")) {
      const [planStepId, requestSha256] = params;
      return [receipts.filter((row) => row.plan_step_id === planStepId && row.request_sha256 === requestSha256)];
    }
    if (normalized.startsWith("INSERT INTO execution_plan_mutation_receipts")) {
      const [receiptId, planId, planStepId, tenantId, operationKey, idempotencyKey, requestSha256] = params;
      events.push("receipt:pending");
      receipts.push({
        receipt_id: receiptId,
        plan_id: planId,
        plan_step_id: planStepId,
        tenant_id: tenantId,
        operation_key: operationKey,
        idempotency_key: idempotencyKey,
        request_sha256: requestSha256,
        dispatch_status: "pending",
        provider_receipt_json: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.includes("SET dispatch_status = 'pending'")) {
      const receipt = receipts.find((row) => row.receipt_id === params[0]);
      Object.assign(receipt, {
        dispatch_status: "pending",
        provider_receipt_json: null,
        readback_json: null,
        recovered_from_transport: 0,
      });
      return [{ affectedRows: 1 }];
    }
    if (normalized.startsWith("UPDATE execution_plan_mutation_receipts")) {
      const [dispatchStatus, providerStatus, providerReceiptJson, recoveredFromTransport, receiptId] = params;
      const receipt = receipts.find((row) => row.receipt_id === receiptId);
      Object.assign(receipt, {
        dispatch_status: dispatchStatus,
        provider_status: providerStatus,
        provider_receipt_json: providerReceiptJson,
        recovered_from_transport: recoveredFromTransport,
      });
      events.push(`receipt:${dispatchStatus}`);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL in receipt fake: ${normalized}`);
  };
  return {
    receipts,
    query,
    async getConnection() {
      return {
        query,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };
}

assert.equal(assertDurablePlanTransition("draft", "validated"), true);
assert.equal(assertDurablePlanTransition("executing", "completed"), true);
assert.equal(assertDurablePlanTransition("completed", "completed"), true);
assert.throws(
  () => assertDurablePlanTransition("completed", "executing"),
  (error) => error.code === "durable_execution_transition_forbidden" && error.status === 409,
);
assert.throws(
  () => assertDurablePlanTransition("cancelled", "validated"),
  (error) => error.code === "durable_execution_transition_forbidden",
);

assert.deepEqual(
  projectDurableNextAction({
    plan: { runtime_status: "awaiting_approval" },
    steps: [{ plan_step_id: "step-1", step_key: "approve", status: "awaiting_approval" }],
  }),
  { type: "approval_required", operation: "decide_approval", plan_step_id: "step-1", step_key: "approve" },
);
assert.equal(
  projectDurableNextAction({
    plan: { runtime_status: "blocked" },
    blockers: [{ code: "readback_required" }],
  }).blocker_code,
  "readback_required",
);
assert.equal(projectDurableNextAction({ plan: { runtime_status: "completed" } }), null);

const successEvents = [];
const successPool = createReceiptPool(successEvents);
let dispatchCount = 0;
const successExecutor = createDurableReceiptAwareExecutor({
  pool: successPool,
  executeStep: async () => {
    successEvents.push("provider:dispatch");
    dispatchCount += 1;
    return { ok: true, provider_status: 200, result_id: "result-1" };
  },
});
const workflowStep = {
  plan_id: "plan-1",
  plan_step_id: "step-1",
  tenant_id: "tenant-1",
  step_key: "publish",
  step_type: "workflow",
  workflow_key: "content_publish",
  workflow_id: null,
  idempotency_key: "idem-1",
  input_json: JSON.stringify({ post_id: "post-1" }),
};
const first = await successExecutor(workflowStep, {});
assert.equal(first.ok, true);
assert.equal(first.idempotent_replay, false);
assert.equal(dispatchCount, 1);
assert.deepEqual(successEvents.slice(0, 3), ["receipt:pending", "provider:dispatch", "receipt:succeeded"]);
assert.equal(successPool.receipts[0].dispatch_status, "succeeded");

const replay = await successExecutor(workflowStep, {});
assert.equal(replay.ok, true);
assert.equal(replay.idempotent_replay, true);
assert.equal(dispatchCount, 1, "successful mutation receipt must prevent duplicate dispatch");

const failureEvents = [];
const failurePool = createReceiptPool(failureEvents);
const unknownExecutor = createDurableReceiptAwareExecutor({
  pool: failurePool,
  executeStep: async () => {
    failureEvents.push("provider:dispatch");
    const error = new Error("transport disconnected after request");
    error.code = "transport_disconnected";
    throw error;
  },
});
await assert.rejects(
  () => unknownExecutor({ ...workflowStep, plan_step_id: "step-2", idempotency_key: "idem-2" }, {}),
  (error) => error.non_retryable === true && error.unknown_outcome === true && Boolean(error.receipt_id),
);
assert.deepEqual(failureEvents, ["receipt:pending", "provider:dispatch", "receipt:unknown_outcome"]);
assert.equal(failurePool.receipts[0].dispatch_status, "unknown_outcome");
await assert.rejects(
  () => unknownExecutor({ ...workflowStep, plan_step_id: "step-2", idempotency_key: "idem-2" }, {}),
  (error) => error.code === "durable_execution_readback_required" && error.non_retryable === true,
);

const internalEvents = [];
const internalPool = createReceiptPool(internalEvents);
const internalExecutor = createDurableReceiptAwareExecutor({
  pool: internalPool,
  executeStep: async () => ({ ok: true, execution_mode: "internal" }),
});
const internal = await internalExecutor({ ...workflowStep, plan_step_id: "step-3", step_type: "analysis" }, {});
assert.equal(internal.ok, true);
assert.equal(internalPool.receipts.length, 0, "read-only internal pilot must not create a mutation receipt");

const migration = await readFile(new URL("./migrations/20260730_spec011_durable_execution_control.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS execution_plan_mutation_receipts/);
assert.match(migration, /unknown_outcome/);
assert.match(migration, /CHECK \(secrets_included = 0\)/);

const orchestratorSource = await readFile(new URL("./sequentialPlanOrchestrator.js", import.meta.url), "utf8");
assert.match(orchestratorSource, /export async function defaultSequentialStepExecutor/);
assert.match(orchestratorSource, /!error\?\.non_retryable/);

const routesSource = await readFile(new URL("./routes/plannerRoutes.js", import.meta.url), "utf8");
for (const route of ["/planner/plans/:id/status", "/planner/plans/:id/explain", "/planner/plans/:id/cancel"]) {
  assert.ok(routesSource.includes(route), `missing durable route ${route}`);
}
assert.match(routesSource, /transitionDurableExecution/);
assert.match(routesSource, /tickDurableExecution/);
assert.match(routesSource, /runDurableExecution/);

assert.equal(durableExecutionControlContract.pending_mutation_receipt_required, true);
assert.equal(durableExecutionControlContract.read_before_retry_after_unknown_outcome, true);
assert.equal(durableExecutionControlContract.canonical_next_action, true);
assert.equal(durableExecutionControlContract.secrets_included, false);

console.log("durable execution control service tests passed");
