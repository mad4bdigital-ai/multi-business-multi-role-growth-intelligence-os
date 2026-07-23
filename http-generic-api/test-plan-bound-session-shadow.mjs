import assert from "node:assert/strict";
import { readPlanBoundSessionShadow } from "./planBoundSessionShadow.js";

const PLAN_ID = "plan-0001";
const TENANT_ID = "tenant-0001";
const USER_ID = "user-0001";
const AGENT_ID = "agent-0001";
const RUN_ID = "run-0001";

function plan(overrides = {}) {
  return {
    plan_id: PLAN_ID,
    tenant_id: TENANT_ID,
    workspace_id: "workspace-0001",
    workspace_key: "workspace-main",
    user_id: USER_ID,
    actor_id: USER_ID,
    actor_type: "user",
    brand_id: "brand-0001",
    brand_key: "brand-main",
    intent_key: "publish_content",
    target_key: "article-0001",
    workflow_key: "content_publish",
    workflow_id: "workflow-0001",
    agent_id: AGENT_ID,
    route_key: "content.publish",
    service_mode: "assisted",
    access_decision: "REQUIRE_REVIEW",
    plan_status: "approved",
    runtime_status: "ready",
    execution_context_json: '{"resource":"article-0001","secret":"must-not-leak"}',
    steps_json: '[{"step":"draft"},{"step":"review"}]',
    preview_json: '{"summary":"safe preview","token":"must-not-leak"}',
    request_id: "request-0001",
    correlation_id: "correlation-0001",
    created_at: "2026-07-23T10:00:00.000Z",
    updated_at: "2026-07-23T10:05:00.000Z",
    ...overrides,
  };
}

function connectedSession(overrides = {}) {
  return {
    connected_session_id: "connected-0001",
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    root_plan_id: PLAN_ID,
    current_run_id: RUN_ID,
    current_step_run_id: null,
    mode: "connected_rounds",
    status: "ready",
    resume_policy_json: '{"mode":"manual"}',
    budget_policy_json: '{"max_tokens":1000}',
    checkpoint_policy_json: '{"frequency":1}',
    resume_cursor_json: '{"step":0}',
    last_checkpoint_json: '{"summary":"checkpoint"}',
    next_action_json: '{"action":"review"}',
    last_evidence_report_id: "evidence-0001",
    round_count: 1,
    max_rounds: 5,
    created_at: "2026-07-23T10:00:00.000Z",
    updated_at: "2026-07-23T10:05:00.000Z",
    last_activity_at: "2026-07-23T10:05:00.000Z",
    ...overrides,
  };
}

function delegation(overrides = {}) {
  return {
    delegation_id: "delegation-0001",
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    intent_key: "publish_content",
    brand_key: "brand-main",
    plan_id: PLAN_ID,
    status: "pending",
    expires_at: "2026-07-23T12:00:00.000Z",
    created_at: "2026-07-23T10:00:00.000Z",
    ...overrides,
  };
}

function approval(overrides = {}) {
  return {
    hold_id: "hold-0001",
    run_id: RUN_ID,
    step_run_id: null,
    tenant_id: TENANT_ID,
    workspace_id: "workspace-0001",
    workspace_key: "workspace-main",
    hold_type: "review",
    requested_by: USER_ID,
    user_id: USER_ID,
    actor_id: USER_ID,
    actor_type: "user",
    assigned_to: "reviewer-0001",
    required_role: "reviewer",
    status: "approved",
    decision_by: "reviewer-0001",
    expires_at: "2026-07-23T12:00:00.000Z",
    decided_at: "2026-07-23T10:10:00.000Z",
    created_at: "2026-07-23T10:06:00.000Z",
    ...overrides,
  };
}

class FakePool {
  constructor(options = {}) {
    this.options = options;
    this.queries = [];
  }

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ text, params });
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|REPLACE)\b/i);
    if (text.includes("FROM execution_plans") && text.includes("execution_context_json")) {
      return [this.options.planRows || [plan()]];
    }
    if (text.includes("FROM execution_plans")) {
      const p = plan();
      return [[{
        plan_id: p.plan_id,
        tenant_id: p.tenant_id,
        workspace_id: p.workspace_id,
        workspace_key: p.workspace_key,
        user_id: p.user_id,
        actor_id: p.actor_id,
        actor_type: p.actor_type,
        intent_key: p.intent_key,
        request_id: p.request_id,
        correlation_id: p.correlation_id,
        workflow_key: p.workflow_key,
        workflow_id: p.workflow_id,
        route_key: p.route_key,
        service_mode: p.service_mode,
        access_decision: p.access_decision,
        plan_status: p.plan_status,
        runtime_status: p.runtime_status,
        created_at: p.created_at,
        updated_at: p.updated_at,
      }]];
    }
    if (text.includes("FROM execution_plan_steps")) {
      return [[{
        plan_step_id: "step-0001",
        plan_id: PLAN_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        step_key: "review",
        step_type: "approval",
        workflow_id: "workflow-0001",
        workflow_key: "content_publish",
        status: "ready",
        attempt_count: 0,
        max_attempts: 1,
        idempotency_key: "step-idempotency-1",
        claimed_at: null,
        started_at: null,
        completed_at: null,
      }]];
    }
    if (text.includes("FROM execution_plan_events")) return [[]];
    if (text.includes("FROM connected_execution_sessions")) return [this.options.sessions || [connectedSession()]];
    if (text.includes("FROM agent_delegations")) return [this.options.delegations || [delegation()]];
    if (text.includes("FROM approval_holds")) return [this.options.approvals || [approval()]];
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

const resolved = await readPlanBoundSessionShadow({
  pool: new FakePool(),
  auth: { mode: "admin", user_id: "admin-0001" },
  planId: PLAN_ID,
  requireDelegation: true,
  agentId: AGENT_ID,
  intentKey: "publish_content",
  sessionTtlMinutes: 90,
});
assert.equal(resolved.decision, "resolved_preview");
assert.equal(resolved.session.rounds_remaining, 4);
assert.equal(resolved.delegation.delegation_id, "delegation-0001");
assert.equal(resolved.approval_independence.approved_independent_count, 1);
assert.equal(resolved.guarantees.database_writes_performed, false);
assert.equal(resolved.guarantees.delegation_activation_performed, false);
assert.equal(resolved.secrets_included, false);
assert.equal(JSON.stringify(resolved).includes("must-not-leak"), false);
assert.match(resolved.plan.plan_hash, /^[0-9a-f]{64}$/);
assert.match(resolved.resource_snapshot.resource_snapshot_hash, /^[0-9a-f]{64}$/);

const tenantPool = new FakePool();
await readPlanBoundSessionShadow({
  pool: tenantPool,
  auth: { mode: "user_jwt", tenant_id: TENANT_ID, user_id: USER_ID },
  planId: PLAN_ID,
  requireDelegation: true,
});
assert.deepEqual(tenantPool.queries[0].params, [PLAN_ID, TENANT_ID, USER_ID]);
assert.deepEqual(tenantPool.queries[1].params, [PLAN_ID, TENANT_ID]);
assert.deepEqual(tenantPool.queries[2].params, [PLAN_ID, TENANT_ID]);
assert.deepEqual(tenantPool.queries[3].params, [PLAN_ID, TENANT_ID, USER_ID]);
assert.deepEqual(tenantPool.queries[4].params, [PLAN_ID, TENANT_ID, USER_ID]);
assert.deepEqual(tenantPool.queries[5].params, [PLAN_ID, TENANT_ID, USER_ID]);
assert.deepEqual(tenantPool.queries[6].params, [RUN_ID, TENANT_ID]);

const selfApproval = await readPlanBoundSessionShadow({
  pool: new FakePool({ approvals: [approval({ assigned_to: USER_ID, decision_by: USER_ID })] }),
  auth: { mode: "admin" },
  planId: PLAN_ID,
  requireDelegation: true,
});
assert.equal(selfApproval.decision, "blocked");
assert.ok(selfApproval.blockers.includes("SELF_APPROVAL_DETECTED"));
assert.ok(selfApproval.blockers.includes("SELF_ASSIGNMENT_DETECTED"));

const agentSelfApproval = await readPlanBoundSessionShadow({
  pool: new FakePool({ approvals: [approval({ assigned_to: AGENT_ID, decision_by: AGENT_ID })] }),
  auth: { mode: "admin" },
  planId: PLAN_ID,
  requireDelegation: true,
});
assert.ok(agentSelfApproval.blockers.includes("AGENT_SELF_APPROVAL_DETECTED"));

const expired = await readPlanBoundSessionShadow({
  pool: new FakePool({ delegations: [delegation({ expires_at: "2026-07-23T09:00:00.000Z" })] }),
  auth: { mode: "admin" },
  planId: PLAN_ID,
  requireDelegation: true,
});
assert.ok(expired.blockers.includes("DELEGATION_EXPIRED"));

const exhausted = await readPlanBoundSessionShadow({
  pool: new FakePool({ sessions: [connectedSession({ round_count: 5, max_rounds: 5 })] }),
  auth: { mode: "admin" },
  planId: PLAN_ID,
  requireDelegation: true,
});
assert.ok(exhausted.blockers.includes("SESSION_ROUND_LIMIT_EXHAUSTED"));

await assert.rejects(
  () => readPlanBoundSessionShadow({
    pool: new FakePool({ delegations: [delegation(), delegation({ delegation_id: "delegation-0002" })] }),
    auth: { mode: "admin" },
    planId: PLAN_ID,
  }),
  (error) => error.status === 409 && error.code === "PLAN_BOUND_DELEGATION_AMBIGUOUS",
);

await assert.rejects(
  () => readPlanBoundSessionShadow({
    pool: new FakePool(),
    auth: { mode: "admin" },
    planId: PLAN_ID,
    expectedPlanHash: "0".repeat(64),
  }),
  (error) => error.status === 409 && error.code === "PLAN_BOUND_PLAN_HASH_STALE",
);

await assert.rejects(
  () => readPlanBoundSessionShadow({
    pool: new FakePool({ planRows: [] }),
    auth: { mode: "user_jwt", tenant_id: TENANT_ID, user_id: USER_ID },
    planId: PLAN_ID,
  }),
  (error) => error.status === 404 && error.code === "PLAN_BOUND_PLAN_NOT_FOUND",
);

console.log("plan-bound session shadow tests passed");
