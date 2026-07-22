import assert from "node:assert/strict";
import {
  deriveDurableOperationState,
  isAllowedDurableTransition,
  projectDurableOperationShadow,
  readDurableOperationShadow,
} from "./durableExecutionShadowService.js";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

class FakePool {
  constructor({ found = true } = {}) {
    this.found = found;
    this.queries = [];
  }

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ text, params });
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    if (text.includes("FROM execution_plans")) {
      if (!this.found) return [[]];
      return [[{
        plan_id: PLAN_ID,
        tenant_id: TENANT_ID,
        workspace_id: "workspace-1",
        user_id: USER_ID,
        intent_key: "repo.change.preview",
        request_id: "request-shadow-001",
        service_mode: "assisted",
        access_decision: "REQUIRE_REVIEW",
        plan_status: "validated",
        runtime_status: "validated",
        created_at: "2026-07-22T00:00:00.000Z",
        updated_at: "2026-07-22T00:01:00.000Z",
      }]];
    }
    if (text.includes("FROM execution_plan_steps")) {
      return [[{
        plan_step_id: "44444444-4444-4444-8444-444444444444",
        plan_id: PLAN_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        step_key: "inspect_repository",
        step_type: "analysis",
        status: "ready",
        attempt_count: 0,
        max_attempts: 1,
        idempotency_key: "shadow-step-idempotency",
        input_json: JSON.stringify({ password: "must-not-leak" }),
      }]];
    }
    if (text.includes("FROM execution_plan_events")) {
      return [[{
        plan_event_id: "55555555-5555-4555-8555-555555555555",
        plan_step_id: null,
        event_type: "plan_compiled",
        from_status: "draft",
        to_status: "validated",
        created_at: "2026-07-22T00:01:00.000Z",
        evidence_json: JSON.stringify({ token: "must-not-leak" }),
      }]];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

assert.equal(deriveDurableOperationState({ plan_status: "draft" }, []), "requested");
assert.equal(deriveDurableOperationState({ plan_status: "validated" }, [{ status: "ready" }]), "ready");
assert.equal(deriveDurableOperationState({ runtime_status: "paused" }, [{ status: "blocked" }]), "failed_recoverable");
assert.equal(deriveDurableOperationState({ plan_status: "completed" }, [{ status: "completed" }]), "completed");

assert.equal(isAllowedDurableTransition("requested", "preflight"), true);
assert.equal(isAllowedDurableTransition("failed_recoverable", "ready"), true);
assert.equal(isAllowedDurableTransition("completed", "executing"), false);
assert.equal(isAllowedDurableTransition("cancelled", "requested"), false);

const directProjection = projectDurableOperationShadow({
  plan: {
    plan_id: PLAN_ID,
    tenant_id: TENANT_ID,
    intent_key: "repo.change.preview",
    plan_status: "awaiting_approval",
    runtime_status: "awaiting_approval",
    request_id: "request-shadow-002",
  },
  steps: [{
    plan_step_id: "66666666-6666-4666-8666-666666666666",
    step_order: 1,
    step_key: "approve_change",
    step_type: "approval",
    status: "awaiting_approval",
    attempt_count: 0,
    max_attempts: 1,
    idempotency_key: "approval-shadow-key",
  }],
  events: [],
  principal: { principal_type: "admin", principal_id: "admin", tenant_id: TENANT_ID, workspace_id: null },
});
assert.equal(directProjection.operation.state, "awaiting_approval");
assert.equal(directProjection.operation.next_action.action, "provide_approval");
assert.equal(directProjection.runtime_authority, false);

const tenantPool = new FakePool();
const tenantProjection = await readDurableOperationShadow({
  pool: tenantPool,
  auth: { mode: "user_jwt", tenant_id: TENANT_ID, user_id: USER_ID },
  operationId: PLAN_ID,
});
assert.equal(tenantProjection.operation.state, "ready");
assert.equal(tenantProjection.operation.next_action.action, "dispatch_next_step");
assert.equal(tenantProjection.operation.approval_mode, "user_approval_only");
assert.equal(tenantProjection.operation.risk_tier, "read_only");
assert.equal(tenantProjection.secrets_included, false);
assert.equal(JSON.stringify(tenantProjection).includes("must-not-leak"), false);
assert.ok(tenantPool.queries[0].text.includes("tenant_id = ? AND user_id = ?"));
assert.deepEqual(tenantPool.queries[0].params, [PLAN_ID, TENANT_ID, USER_ID]);
assert.ok(tenantPool.queries.slice(1).every((query) => query.text.includes("tenant_id = ?")));

const adminPool = new FakePool();
await readDurableOperationShadow({
  pool: adminPool,
  auth: { mode: "backend_api", is_admin: true, user_id: "admin-user" },
  operationId: PLAN_ID,
});
assert.equal(adminPool.queries[0].text.includes("user_id = ?"), false);

await assert.rejects(
  () => readDurableOperationShadow({
    pool: new FakePool({ found: false }),
    auth: { mode: "user_jwt", tenant_id: TENANT_ID, user_id: USER_ID },
    operationId: PLAN_ID,
  }),
  (error) => error.status === 404 && error.code === "DURABLE_OPERATION_NOT_FOUND",
);

await assert.rejects(
  () => readDurableOperationShadow({
    pool: new FakePool(),
    auth: {},
    operationId: PLAN_ID,
  }),
  (error) => error.status === 403 && error.code === "OPERATION_PRINCIPAL_NOT_ALLOWED",
);

console.log("durable execution shadow service tests passed");
