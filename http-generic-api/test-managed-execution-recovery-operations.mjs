import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MANAGED_EXECUTION_MAX_RETRY_ATTEMPTS,
  MANAGED_ROLLBACK_STEP_KEY,
  assertManagedExecutionRetryBound,
  assertManagedExecutionStepTransition,
  cancelManagedExecutionRun,
  retryManagedExecutionStep,
  sha256Json,
} from "./managedExecutionLifecycleService.js";

assert.equal(MANAGED_EXECUTION_MAX_RETRY_ATTEMPTS, 3);
assert.equal(MANAGED_ROLLBACK_STEP_KEY, "__managed_rollback__");
assert.equal(assertManagedExecutionStepTransition({ current_status: "pending", next_status: "running" }), true);
assert.equal(assertManagedExecutionStepTransition({ current_status: "running", next_status: "failed" }), true);
assert.equal(assertManagedExecutionStepTransition({ current_status: "awaiting", next_status: "pending" }), true);
assert.throws(
  () => assertManagedExecutionStepTransition({ current_status: "failed", next_status: "running" }),
  (error) => error.code === "managed_execution_step_transition_forbidden",
);
assert.deepEqual(
  assertManagedExecutionRetryBound({ attempt: 1 }),
  { attempt: 1, next_attempt: 2, max_attempts: 3 },
);
assert.deepEqual(
  assertManagedExecutionRetryBound({ attempt: 2 }),
  { attempt: 2, next_attempt: 3, max_attempts: 3 },
);
assert.throws(
  () => assertManagedExecutionRetryBound({ attempt: 3 }),
  (error) => error.code === "managed_execution_retry_limit_reached",
);

function authoritySnapshot() {
  const payload = {
    contract: "tenant-managed-execution-v1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    parent_ticket_id: "ticket-parent",
    workflow_key: "wordpress_health_check",
    capability_key: "tenant_tool.wordpress_health_check",
    resource: { type: "site", ref: "site:example.test" },
    effect_class: "state_change",
    idempotency_key: "run-request-1",
    access_decision: "ALLOW_SELF_SERVE",
    access_reason: "test",
    risk_level: "medium",
    service_mode: "managed",
    plan_key: null,
    resolved_at: "2026-08-02T00:00:00.000Z",
    approval: { required: false, hold_type: null, required_role: null },
    capability_authority: {
      capability_key: "tenant_tool.wordpress_health_check",
      operation_class: "action",
      risk_class: "medium",
      runtime_status: "certified",
      exposure_scope: "tenant",
      resource_authority_required: true,
      dispatch_allowed: true,
      apply_allowed: true,
      requires_audit_evidence: true,
      requires_readback: true,
      evidence_ref: "tool_dispatch_binding:binding-1:readback:test",
    },
    resource_grant: {
      grant_id: "grant-1",
      resource_type: "site",
      resource_ref: "site:example.test",
      permission: "operate",
      source: "owner_assignment",
      granted_by: "owner-1",
      granted_at: "2026-08-01T00:00:00Z",
      expires_at: null,
      required_permission: "edit",
      exact_resource: true,
    },
    authority_resolved_at: "2026-08-02T00:00:00.000Z",
    secrets_included: false,
  };
  return { ...payload, fingerprint_sha256: sha256Json(payload) };
}

function managedRun(status = "paused") {
  return {
    run_id: "run-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    status,
    execution_context_json: JSON.stringify({
      contract: "tenant-managed-execution-v1",
      authority_snapshot: authoritySnapshot(),
    }),
  };
}

function fakePool(connection) {
  return {
    async getConnection() {
      return {
        ...connection,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };
}

function retryConnection() {
  const writes = [];
  return {
    writes,
    async query(sql, params = []) {
      if (sql.includes("FROM workflow_runs") && sql.includes("FOR UPDATE")) return [[managedRun("paused")]];
      if (sql.includes("FROM managed_execution_bindings") && sql.includes("FOR UPDATE")) {
        return [[{
          binding_id: "binding-1",
          run_id: "run-1",
          tenant_id: "tenant-1",
          task_ticket_id: "task-1",
          lifecycle_state: "blocked",
          customer_status: "blocked",
        }]];
      }
      if (sql.includes("FROM approval_holds")) return [[]];
      if (sql.includes("FROM step_runs") && sql.includes("FOR UPDATE")) {
        return [[{
          step_run_id: "step-1",
          run_id: "run-1",
          step_key: "action-1",
          step_type: "action",
          status: "failed",
          attempt: 2,
          assigned_to: "operator-1",
        }]];
      }
      if (sql.includes("FROM managed_execution_events")) return [[]];
      if (sql.includes("v_platform_capabilities_effective_evidence")) {
        return [[{
          capability_key: "tenant_tool.wordpress_health_check",
          operation_class: "action",
          risk_class: "medium",
          runtime_status: "certified",
          exposure_scope: "tenant",
          resource_authority_required: 1,
          dispatch_allowed: 1,
          apply_allowed: 1,
          requires_audit_evidence: 1,
          requires_readback: 1,
          evidence_ref: "tool_dispatch_binding:binding-1:readback:test",
        }]];
      }
      if (sql.includes("v_workspace_resource_grant_effective")) {
        return [[{
          grant_id: "grant-1",
          tenant_id: "tenant-1",
          grantee_user_id: "user-1",
          resource_type: "site",
          resource_ref: "site:example.test",
          permission: "operate",
          grant_status: "active",
          source: "owner_assignment",
          granted_by: "owner-1",
          granted_at: "2026-08-01T00:00:00Z",
          expires_at: null,
        }]];
      }
      if (/^(UPDATE|INSERT)/m.test(sql.trim())) {
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected retry query: ${sql}`);
    },
  };
}

const retryDb = retryConnection();
const retry = await retryManagedExecutionStep({
  pool: fakePool(retryDb),
  runId: "run-1",
  stepRunId: "step-1",
  idempotencyKey: "retry-request-1",
  actorId: "operator-1",
  reason: "Transient provider-independent failure.",
});
assert.equal(retry.reused, false);
assert.equal(retry.attempt, 3);
assert.equal(retry.max_attempts, 3);
assert.equal(retry.status, "pending");
assert(retryDb.writes.some(({ sql }) => sql.includes("attempt = ?")));
assert(retryDb.writes.some(({ sql }) => sql.includes("managed_execution_events")));
assert(retryDb.writes.every(({ sql }) => !/provider|external_send/i.test(sql)));

function cancellationConnection() {
  const writes = [];
  return {
    writes,
    async query(sql, params = []) {
      if (sql.includes("FROM workflow_runs") && sql.includes("FOR UPDATE")) return [[managedRun("running")]];
      if (sql.includes("FROM managed_execution_bindings") && sql.includes("FOR UPDATE")) {
        return [[{
          binding_id: "binding-1",
          run_id: "run-1",
          tenant_id: "tenant-1",
          task_ticket_id: "task-1",
          lifecycle_state: "executing",
          customer_status: "in_progress",
        }]];
      }
      if (sql.includes("FROM approval_holds")) {
        return [[{ hold_id: "hold-1", status: "open", required_role: "supervisor" }]];
      }
      if (sql.includes("FROM step_runs") && sql.includes("FOR UPDATE")) {
        return [[
          { step_run_id: "step-1", status: "running", attempt: 1 },
          { step_run_id: "step-2", status: "pending", attempt: 1 },
        ]];
      }
      if (/^(UPDATE|INSERT)/m.test(sql.trim())) {
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected cancellation query: ${sql}`);
    },
  };
}

const cancelDb = cancellationConnection();
const cancelled = await cancelManagedExecutionRun({
  pool: fakePool(cancelDb),
  runId: "run-1",
  actorId: "operator-1",
  reason: "Tenant requested cancellation.",
});
assert.equal(cancelled.reused, false);
assert.equal(cancelled.status, "cancelled");
assert.equal(cancelled.skipped_step_count, 2);
assert.equal(cancelled.rejected_hold_count, 1);
assert(cancelDb.writes.some(({ sql }) => sql.includes("SET status = 'skipped'")));
assert(cancelDb.writes.some(({ sql }) => sql.includes("SET status = 'rejected'")));
assert(cancelDb.writes.some(({ sql }) => sql.includes("SET status = 'cancelled'")));

const serviceSource = readFileSync("managedExecutionRecoveryService.js", "utf8");
const routesSource = readFileSync("routes/managedExecutionRoutes.js", "utf8");
const lifecycleSource = readFileSync("managedExecutionLifecycleService.js", "utf8");

for (const contract of [
  "assertManagedExecutionAuthorityStillEffective",
  "managed_execution_step_retry_requested",
  "idempotency_key_sha256",
  "managed_execution_assignee_active_membership_required",
  "supervisor_approval",
  "managed_execution_cancelled",
  "managed_execution_rollback_requested",
  "managed_execution_rollback_completed",
  "rollback_executing",
  "rolled_back",
  MANAGED_ROLLBACK_STEP_KEY,
]) {
  assert.ok(serviceSource.includes(contract), `Recovery service is missing ${contract}.`);
}

for (const route of [
  'router.patch("/managed-execution-runs/:id/steps/:stepId/status"',
  'router.post("/managed-execution-runs/:id/steps/:stepId/retry"',
  'router.patch("/managed-execution-runs/:id/steps/:stepId/assignment"',
  'router.post("/managed-execution-runs/:id/escalate"',
  'router.post("/managed-execution-runs/:id/cancel"',
  'router.post("/managed-execution-runs/:id/rollback"',
  'router.post("/managed-execution-runs/:id/rollback/finalize"',
]) {
  assert.ok(routesSource.includes(route), `Managed execution routes are missing ${route}.`);
}

assert.ok(lifecycleSource.includes('export * from "./managedExecutionRecoveryService.js"'));
assert.doesNotMatch(serviceSource, /fetch\(|provider_call|external_send|credential_ref|secret_value/);
assert.match(serviceSource, /MANAGED_EXECUTION_MAX_RETRY_ATTEMPTS = 3/);
assert.match(serviceSource, /step\.step_key !== MANAGED_ROLLBACK_STEP_KEY/);
assert.match(serviceSource, /normalized\(step\.status\) !== "completed"/);

console.log(JSON.stringify({
  ok: true,
  contract: "managed_execution_recovery_operations.v1",
  bounded_retry_max_attempts: 3,
  retry_behavior_verified: true,
  cancellation_behavior_verified: true,
  reassignment_requires_active_membership: true,
  escalation_requires_supervisor_hold: true,
  rollback_requires_completed_compensation_step: true,
  route_count: 7,
  provider_call_executed: false,
  external_write_executed: false,
  secrets_included: false,
}, null, 2));
