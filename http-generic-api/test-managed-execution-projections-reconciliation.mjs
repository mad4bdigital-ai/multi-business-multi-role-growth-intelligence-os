import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  analyzeManagedExecutionState,
  projectManagedExecutionForAdmin,
  projectManagedExecutionForTenant,
  reconcileManagedExecutionState,
} from "./managedExecutionLifecycleService.js";

function run(status = "running") {
  return {
    run_id: "run-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workflow_key: "wordpress_health_check",
    service_mode: "managed",
    status,
    input_json: JSON.stringify({ private_note: "not-for-projection" }),
    output_json: JSON.stringify({ internal_result: "not-for-projection" }),
    error_json: JSON.stringify({ code: "internal_failure", message: "not-for-projection" }),
    execution_context_json: JSON.stringify({
      contract: "tenant-managed-execution-v1",
      authority_snapshot: { credential_ref: "must-not-leak" },
    }),
    started_at: "2026-08-02T10:00:00Z",
    completed_at: null,
  };
}

function binding(overrides = {}) {
  return {
    id: 1,
    binding_id: "binding-1",
    run_id: "run-1",
    tenant_id: "tenant-1",
    parent_ticket_id: "parent-1",
    task_ticket_id: "task-1",
    capability_key: "tenant_tool.wordpress_health_check",
    resource_type: "site",
    resource_ref: "site:example.test",
    effect_class: "state_change",
    lifecycle_state: "executing",
    customer_status: "in_progress",
    approval_hold_id: null,
    authority_fingerprint_sha256: "f".repeat(64),
    authority_snapshot_json: JSON.stringify({
      fingerprint_sha256: "f".repeat(64),
      capability_key: "tenant_tool.wordpress_health_check",
      effect_class: "state_change",
      resource: { type: "site", ref: "site:example.test" },
      approval: { required: false, required_role: null },
      resource_grant: { grant_id: "grant-1", source: "owner_assignment" },
      credential_ref: "must-not-leak",
    }),
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    ticket_id: "task-1",
    tenant_id: "tenant-1",
    title: "Managed WordPress health check",
    status: "in_review",
    lifecycle_state: "executing",
    customer_status: "in_progress",
    parent_ticket_id: "parent-1",
    target_capability: "tenant_tool.wordpress_health_check",
    assigned_to: "operator-1",
    updated_at: "2026-08-02T10:00:00Z",
    metadata_json: JSON.stringify({ internal: "not-for-projection" }),
    ...overrides,
  };
}

function parent(overrides = {}) {
  return {
    ticket_id: "parent-1",
    tenant_id: "tenant-1",
    title: "Original support request",
    status: "open",
    lifecycle_state: "received",
    customer_status: "received",
    parent_ticket_id: null,
    updated_at: "2026-08-02T09:00:00Z",
    ...overrides,
  };
}

function step(overrides = {}) {
  return {
    id: 1,
    step_run_id: "step-1",
    run_id: "run-1",
    tenant_id: "tenant-1",
    step_key: "health-check",
    step_type: "action",
    assigned_to: "operator-1",
    status: "running",
    attempt: 1,
    input_json: JSON.stringify({ private: "not-for-projection" }),
    output_json: null,
    error_message: null,
    started_at: "2026-08-02T10:01:00Z",
    completed_at: null,
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    event_id: "event-1",
    event_type: "managed_step_created",
    from_state: "ready",
    to_state: "executing",
    actor_id: "operator-1",
    evidence_json: JSON.stringify({
      step_run_id: "step-1",
      step_key: "health-check",
      idempotency_key: "raw-key-must-not-leak",
      credential_ref: "must-not-leak",
      reason: "A safe bounded reason.",
    }),
    created_at: "2026-08-02T10:01:00Z",
    ...overrides,
  };
}

function state(overrides = {}) {
  const baseBinding = binding();
  const baseTask = task();
  const baseParent = parent();
  return {
    run: run(),
    bindingRows: [baseBinding],
    binding: baseBinding,
    taskRows: [baseTask],
    task: baseTask,
    parentRows: [baseParent],
    parent: baseParent,
    holds: [],
    steps: [step()],
    events: [event()],
    ...overrides,
  };
}

const consistent = state();
const consistentAnalysis = analyzeManagedExecutionState(consistent);
assert.equal(consistentAnalysis.contradictions.length, 0);
assert.equal(consistentAnalysis.reconciliation.action_count, 0);
assert.equal(consistentAnalysis.reconciliation.auto_applicable, true);

const tenantProjection = projectManagedExecutionForTenant({ state: consistent, analysis: consistentAnalysis });
assert.equal(tenantProjection.contract, "managed_execution_tenant_projection.v1");
assert.equal(tenantProjection.progress.active_steps, 1);
assert.equal(tenantProjection.next_action, "continue_execution");
const tenantJson = JSON.stringify(tenantProjection);
for (const forbidden of ["authority_snapshot", "credential_ref", "input_json", "output_json", "error_json", "raw-key-must-not-leak", "internal_result"]) {
  assert.equal(tenantJson.includes(forbidden), false, `Tenant projection leaked ${forbidden}.`);
}

const adminProjection = projectManagedExecutionForAdmin({ state: consistent, analysis: consistentAnalysis });
assert.equal(adminProjection.contract, "managed_execution_admin_projection.v1");
assert.equal(adminProjection.binding.authority.capability_key, "tenant_tool.wordpress_health_check");
assert.equal(adminProjection.interventions.length, 1);
assert.equal(adminProjection.interventions[0].evidence_summary.step_run_id, "step-1");
assert.match(adminProjection.interventions[0].evidence_sha256, /^[0-9a-f]{64}$/);
const adminJson = JSON.stringify(adminProjection);
for (const forbidden of ["credential_ref", "raw-key-must-not-leak", "not-for-projection", "authority_snapshot_json", "execution_context_json"]) {
  assert.equal(adminJson.includes(forbidden), false, `Admin projection leaked ${forbidden}.`);
}

const approvedHold = {
  id: 1,
  hold_id: "hold-1",
  run_id: "run-1",
  tenant_id: "tenant-1",
  hold_type: "managed_operation_approval",
  required_role: "certified_reviewer",
  status: "approved",
  decided_at: "2026-08-02T10:05:00Z",
};
const driftBinding = binding({ lifecycle_state: "awaiting_approval", customer_status: "waiting_for_approval", approval_hold_id: "hold-1" });
const driftTask = task({ status: "awaiting_approval", lifecycle_state: "awaiting_approval", customer_status: "waiting_for_approval" });
const drift = state({
  run: run("awaiting_approval"),
  bindingRows: [driftBinding],
  binding: driftBinding,
  taskRows: [driftTask],
  task: driftTask,
  holds: [approvedHold],
  steps: [],
});
const driftAnalysis = analyzeManagedExecutionState(drift);
assert.equal(driftAnalysis.blocking_contradictions.length, 0);
assert.equal(driftAnalysis.reconciliation.auto_applicable, true);
assert(driftAnalysis.reconciliation.action_count >= 4);
assert.equal(driftAnalysis.canonical.run_status, "running");
assert.equal(driftAnalysis.canonical.lifecycle_state, "executing");
assert.match(driftAnalysis.reconciliation.plan_fingerprint_sha256, /^[0-9a-f]{64}$/);
assert.equal(
  driftAnalysis.reconciliation.required_confirmation,
  `RECONCILE_MANAGED_EXECUTION:run-1:${driftAnalysis.reconciliation.plan_fingerprint_sha256}`,
);

const structurallyBlocked = state({
  run: { ...run("completed"), completed_at: "2026-08-02T11:00:00Z" },
  steps: [step({ status: "pending" })],
});
const blockedAnalysis = analyzeManagedExecutionState(structurallyBlocked);
assert(blockedAnalysis.blocking_contradictions.some((item) => item.code === "managed_execution_terminal_run_has_active_steps"));
assert.equal(blockedAnalysis.reconciliation.auto_applicable, false);
assert.equal(blockedAnalysis.reconciliation.action_count, 0);

const rollbackBinding = binding({ lifecycle_state: "rolled_back", customer_status: "cancelled" });
const rollbackTask = task({ status: "resolved", lifecycle_state: "rolled_back", customer_status: "cancelled" });
const rolledBack = state({
  run: { ...run("cancelled"), completed_at: "2026-08-02T11:00:00Z" },
  bindingRows: [rollbackBinding],
  binding: rollbackBinding,
  taskRows: [rollbackTask],
  task: rollbackTask,
  steps: [step({ step_run_id: "rollback-step", step_key: "__managed_rollback__", step_type: "managed_op", status: "completed", completed_at: "2026-08-02T10:59:00Z" })],
});
const rollbackAnalysis = analyzeManagedExecutionState(rolledBack);
assert.equal(rollbackAnalysis.contradictions.length, 0);
assert.equal(rollbackAnalysis.canonical.lifecycle_state, "rolled_back");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutablePool(initialState) {
  const db = {
    run: clone(initialState.run),
    binding: clone(initialState.binding),
    task: clone(initialState.task),
    parent: clone(initialState.parent),
    holds: clone(initialState.holds),
    steps: clone(initialState.steps),
    events: clone(initialState.events),
  };
  const writes = [];

  const connection = {
    writes,
    db,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      if (sql.includes("FROM workflow_runs") && sql.includes("WHERE run_id = ?")) return [[clone(db.run)]];
      if (sql.includes("FROM managed_execution_bindings") && sql.includes("WHERE run_id = ?")) return [[clone(db.binding)]];
      if (sql.includes("FROM tickets") && sql.includes("ticket_id = ?")) {
        return [[clone(params[0] === db.task.ticket_id ? db.task : db.parent)]];
      }
      if (sql.includes("FROM approval_holds") && sql.includes("WHERE run_id = ?")) return [[...clone(db.holds)]];
      if (sql.includes("FROM step_runs") && sql.includes("WHERE run_id = ?")) return [[...clone(db.steps)]];
      if (sql.includes("FROM managed_execution_events") && sql.includes("WHERE run_id = ?")) return [[...clone(db.events)]];
      if (sql.startsWith("UPDATE workflow_runs")) {
        db.run.status = params[0];
        db.run.completed_at = ["completed", "failed", "cancelled"].includes(params[0]) ? (db.run.completed_at || "2026-08-02T12:00:00Z") : null;
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE managed_execution_bindings")) {
        [db.binding.lifecycle_state, db.binding.customer_status, db.binding.approval_hold_id] = params.slice(0, 3);
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE tickets")) {
        [db.task.lifecycle_state, db.task.customer_status, db.task.status] = params.slice(0, 3);
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("INSERT INTO managed_execution_events")) {
        db.events.unshift({
          event_id: params[0],
          event_type: params[4],
          from_state: params[5],
          to_state: params[6],
          actor_id: params[7],
          evidence_json: params[8],
          created_at: "2026-08-02T12:00:00Z",
        });
        writes.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected reconciliation query: ${sql}`);
    },
  };
  return {
    db,
    writes,
    async query(sql, params) { return connection.query(sql, params); },
    async getConnection() { return connection; },
  };
}

const dryRunPool = mutablePool(drift);
const dryRun = await reconcileManagedExecutionState({
  pool: dryRunPool,
  runId: "run-1",
  mode: "dry_run",
  actorId: "admin-1",
  isAdmin: true,
});
assert.equal(dryRun.mode, "dry_run");
assert.equal(dryRun.applied, false);
assert.equal(dryRun.reconciliation.auto_applicable, true);
assert.equal(dryRunPool.writes.length, 0);

await assert.rejects(
  reconcileManagedExecutionState({ pool: dryRunPool, runId: "run-1", mode: "dry_run", isAdmin: false }),
  (error) => error.code === "managed_execution_reconciliation_admin_required",
);
await assert.rejects(
  reconcileManagedExecutionState({ pool: mutablePool(drift), runId: "run-1", mode: "apply", confirmation: "wrong", isAdmin: true }),
  (error) => error.code === "managed_execution_reconciliation_confirmation_required",
);

const applyPool = mutablePool(drift);
const applied = await reconcileManagedExecutionState({
  pool: applyPool,
  runId: "run-1",
  mode: "apply",
  confirmation: driftAnalysis.reconciliation.required_confirmation,
  actorId: "admin-1",
  isAdmin: true,
});
assert.equal(applied.applied, true);
assert.equal(applyPool.db.run.status, "running");
assert.equal(applyPool.db.binding.lifecycle_state, "executing");
assert.equal(applyPool.db.binding.customer_status, "in_progress");
assert.equal(applyPool.db.task.status, "in_review");
assert.equal(applyPool.db.task.lifecycle_state, "executing");
assert.equal(applied.projection.contradictions.length, 0);
assert(applyPool.writes.some(({ sql }) => sql.includes("managed_execution_events")));

const blockedPool = mutablePool(structurallyBlocked);
await assert.rejects(
  reconcileManagedExecutionState({
    pool: blockedPool,
    runId: "run-1",
    mode: "apply",
    confirmation: blockedAnalysis.reconciliation.required_confirmation,
    isAdmin: true,
  }),
  (error) => error.code === "managed_execution_reconciliation_blocked",
);
assert.equal(blockedPool.writes.length, 0);

const routeSource = readFileSync("routes/managedExecutionRoutes.js", "utf8");
const lifecycleSource = readFileSync("managedExecutionLifecycleService.js", "utf8");
assert.ok(routeSource.includes('router.get("/managed-execution-runs/:id"'));
assert.ok(routeSource.includes('router.post("/managed-execution-runs/:id/reconcile"'));
assert.ok(routeSource.includes('view: principalIsAdmin(req) ? "admin" : "tenant"'));
assert.ok(routeSource.includes("isAdmin: principalIsAdmin(req)"));
assert.equal(routeSource.includes("authority_snapshot_json = JSON.parse"), false);
assert.equal(routeSource.includes("projectManagedExecutionState"), false);
assert.ok(lifecycleSource.includes('export * from "./managedExecutionProjectionService.js"'));

console.log(JSON.stringify({
  ok: true,
  contract: "managed_execution_projections_reconciliation.v1",
  tenant_projection_secret_safe: true,
  admin_evidence_summary_safe: true,
  structural_contradictions_block_apply: true,
  deterministic_reconciliation_verified: true,
  confirmation_bound_to_plan_sha256: true,
  transactional_readback_verified: true,
  provider_call_executed: false,
  external_write_executed: false,
  secrets_included: false,
}, null, 2));
