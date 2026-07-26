import assert from "node:assert/strict";
import { dispatchChainEvent } from "./chainEventDispatcher.js";
import { consumeAgentHandoffState, revokeAgentHandoffState } from "./agentGovernanceRuntime.js";
import { normalizeLinkedWorkflowKeys } from "./outputSinkRouter.js";
import { tickSequentialPlan } from "./sequentialPlanOrchestrator.js";

class ChainMemoryPool {
  constructor(events = []) {
    this.events = new Map(events.map((event) => [event.event_id, { status: "pending", chain_depth: 0, max_chain_depth: 8, workflow_path_json: "[]", ...event }]));
    this.plans = [];
  }

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT * FROM `agent_chain_events`")) {
      const event = this.events.get(params[0]);
      return [[event ? { ...event } : undefined].filter(Boolean)];
    }
    if (text.includes("SET status = 'skipped'")) {
      const event = this.events.get(params[0]);
      if (event?.status === "pending") {
        event.status = "skipped";
        event.failure_reason = text.includes("chain_cycle_detected") ? "chain_cycle_detected" : "chain_depth_exceeded";
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 0 }];
    }
    if (text.includes("SET status = 'dispatched'")) {
      const event = this.events.get(params[0]);
      if (event?.status !== "pending") return [{ affectedRows: 0 }];
      event.status = "dispatched";
      event.dispatched_at = "2026-06-15T00:00:00.000Z";
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("SELECT agent_id FROM `agents`")) return [[{ agent_id: params[0] }]];
    if (text.startsWith("SELECT a.agent_id FROM `task_routes`")) return [[{ agent_id: "agent-primary" }]];
    if (text.startsWith("SELECT fallback.agent_id")) return [[{ agent_id: "agent-fallback" }]];
    if (text.startsWith("INSERT INTO `execution_plans`")) {
      this.plans.push({ plan_id: params[0], tenant_id: params[1], agent_id: params[3], workflow_key: params[4] });
      return [{ affectedRows: 1 }];
    }
    if (text.includes("SET dispatched_run_id = ?")) {
      this.events.get(params[1]).dispatched_run_id = params[0];
      return [{ affectedRows: 1 }];
    }
    if (text.includes("SET fallback_agent_id = ?, dispatched_run_id = ?")) {
      const event = this.events.get(params[2]);
      event.fallback_agent_id = params[0];
      event.dispatched_run_id = params[1];
      event.failure_reason = null;
      return [{ affectedRows: 1 }];
    }
    if (text.includes("SET status = 'failed'")) {
      const event = this.events.get(params[2]);
      event.status = "failed";
      event.fallback_agent_id = params[0];
      event.failure_reason = params[1];
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected chain certification SQL: ${text}`);
  }
}

const workflow = { workflow_id: "wf-cert", workflow_key: "supervisor_certification_workflow" };
const workflowResolver = async () => ({ ok: true, workflow });
const delegationRequest = {
  delegation_approved: true,
  delegation_mode: "manual_api",
  delegation_reason: "Controlled supervisor behavioral certification.",
};
let idCounter = 0;
const nextId = () => `cert-plan-${++idCounter}`;

const cyclePool = new ChainMemoryPool([{
  event_id: "cycle-event",
  tenant_id: "tenant-cert",
  target_workflow_key: workflow.workflow_key,
  workflow_path_json: JSON.stringify(["a", "a"]),
}]);
const cycle = await dispatchChainEvent("cycle-event", { pool: cyclePool, resolveRuntimeWorkflow: workflowResolver, randomUUID: nextId, delegationRequest });
assert.equal(cycle.reason, "chain_cycle_detected");
assert.equal(cyclePool.events.get("cycle-event").status, "skipped");

const depthPool = new ChainMemoryPool([{
  event_id: "depth-event",
  tenant_id: "tenant-cert",
  target_workflow_key: workflow.workflow_key,
  chain_depth: 9,
  max_chain_depth: 8,
}]);
const depth = await dispatchChainEvent("depth-event", { pool: depthPool, resolveRuntimeWorkflow: workflowResolver, randomUUID: nextId, delegationRequest });
assert.equal(depth.reason, "chain_depth_exceeded");
assert.equal(depthPool.events.get("depth-event").status, "skipped");

const claimPool = new ChainMemoryPool([{
  event_id: "claim-event",
  tenant_id: "tenant-cert",
  target_agent_id: "agent-primary",
  target_workflow_key: workflow.workflow_key,
}]);
const successfulDispatch = async () => ({ ok: true, run_id: "run-primary" });
const firstClaim = await dispatchChainEvent("claim-event", { pool: claimPool, dispatchPlan: successfulDispatch, resolveRuntimeWorkflow: workflowResolver, randomUUID: nextId, delegationRequest });
const duplicateClaim = await dispatchChainEvent("claim-event", { pool: claimPool, dispatchPlan: successfulDispatch, resolveRuntimeWorkflow: workflowResolver, randomUUID: nextId, delegationRequest });
assert.equal(firstClaim.ok, true);
assert.equal(firstClaim.run_id, "run-primary");
assert.equal(duplicateClaim.skipped, true);
assert.match(duplicateClaim.reason, /already in status 'dispatched'/);
assert.equal(claimPool.plans.length, 1, "an already-claimed event must not create another plan");

const fallbackPool = new ChainMemoryPool([{
  event_id: "fallback-event",
  tenant_id: "tenant-cert",
  source_agent_id: "agent-source",
  target_agent_id: "agent-primary",
  target_workflow_key: workflow.workflow_key,
}]);
const fallbackDelegationRequest = { ...delegationRequest, allow_fallback_agent: true };
const dispatchActors = [];
const fallbackDispatch = async (_planId, options) => {
  dispatchActors.push(options.actor_id);
  return dispatchActors.length === 1
    ? { ok: false, error: { code: "cert_primary_failure", message: "controlled primary failure" } }
    : { ok: true, run_id: "run-fallback" };
};
const fallback = await dispatchChainEvent("fallback-event", { pool: fallbackPool, dispatchPlan: fallbackDispatch, resolveRuntimeWorkflow: workflowResolver, randomUUID: nextId, delegationRequest: fallbackDelegationRequest });
assert.equal(fallback.ok, true);
assert.equal(fallback.agent_id, "agent-fallback");
assert.equal(fallback.fallback_agent_id, "agent-fallback");
assert.deepEqual(dispatchActors, ["chain:agent-source", "chain-fallback:agent-source"]);
assert.equal(fallbackPool.events.get("fallback-event").dispatched_run_id, "run-fallback");

assert.deepEqual(
  normalizeLinkedWorkflowKeys("content_generation_workflow; seo_strategy_workflow|publish_preflight_validation_workflow,wordpress_p"),
  ["content_generation_workflow", "seo_strategy_workflow", "publish_preflight_validation_workflow", "wordpress_p"],
);

const cancelledPlan = await tickSequentialPlan({
  planId: "cancelled-plan",
  pool: {
    async query(sql) {
      if (String(sql).includes("SELECT * FROM execution_plans")) {
        return [[{ plan_id: "cancelled-plan", tenant_id: "tenant-cert", plan_status: "cancelled", runtime_status: "cancelled" }]];
      }
      throw new Error(`Cancelled plan must stop before further SQL: ${sql}`);
    },
  },
  executeStep: async () => {
    throw new Error("Cancelled plan must never execute a step.");
  },
});
assert.equal(cancelledPlan.reason, "plan_terminal");
assert.equal(cancelledPlan.plan_status, "cancelled");

const handoffRow = {
  state_id: "handoff-cert",
  tenant_id: "tenant-cert",
  source_agent_id: "agent-source",
  target_agent_id: "agent-target",
  current_state_json: "{}",
  required_checks_json: "[]",
  allowed_actions_json: '["continue"]',
  one_time_use: 1,
  consumed_at: null,
  revoked_at: null,
};
const handoffPool = {
  async query(sql) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT * FROM agent_handoff_state_registry")) return [[{ ...handoffRow }]];
    if (text.startsWith("INSERT INTO agent_handoff_state_access_log")) return [{ affectedRows: 1 }];
    if (text.startsWith("UPDATE agent_handoff_state_registry SET consumed_at")) {
      if (handoffRow.consumed_at || handoffRow.revoked_at) return [{ affectedRows: 0 }];
      handoffRow.consumed_at = "2026-06-15T00:00:00.000Z";
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("UPDATE agent_handoff_state_registry SET revoked_at")) {
      if (handoffRow.revoked_at) return [{ affectedRows: 0 }];
      handoffRow.revoked_at = "2026-06-15T00:00:00.000Z";
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected handoff certification SQL: ${text}`);
  },
};
const handoffInput = { tenant_id: "tenant-cert", actor_id: "agent-target", requested_action: "continue" };
const consumed = await consumeAgentHandoffState("handoff-cert", handoffInput, { pool: handoffPool });
const consumedAgain = await consumeAgentHandoffState("handoff-cert", handoffInput, { pool: handoffPool });
assert.equal(consumed.consumed, true);
assert.equal(consumedAgain.reason, "already_consumed");

handoffRow.consumed_at = null;
const revoked = await revokeAgentHandoffState("handoff-cert", { tenant_id: "tenant-cert", actor_id: "agent-source" }, { pool: handoffPool });
const consumedAfterRevoke = await consumeAgentHandoffState("handoff-cert", handoffInput, { pool: handoffPool });
assert.equal(revoked.revoked, true);
assert.equal(consumedAfterRevoke.reason, "revoked");

console.log(JSON.stringify({
  ok: true,
  certification: "supervisor_behavioral_fixtures",
  checks: ["linked_workflow_normalization", "cycle_rejection", "depth_rejection", "atomic_event_claim", "fallback_dispatch", "cancelled_plan_terminal_guard", "one_time_handoff", "revoked_handoff"],
  provider_calls: 0,
  secrets_included: false,
}));
