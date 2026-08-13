import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertDelegationApprovalDecision,
  delegationExecutionPolicyContract,
  evaluateDelegationExecutionPolicy,
  evaluateDelegationRenewalPolicy,
  evaluateSequentialStepDelegationPolicy,
} from "./delegationExecutionPolicyService.js";

const H = "a".repeat(64);
const R = "b".repeat(64);
const STEP = "c".repeat(64);
const NOW = "2026-07-31T08:00:00.000Z";

function grant(overrides = {}) {
  return {
    schema_version: "spec011-delegation-grant-v1",
    grant_id: "11111111-1111-4111-8111-111111111111",
    status: "active",
    delegated_by: "user-1",
    delegated_to: "agent-1",
    approval_mode: "delegated_plan_bound",
    plan_id: "22222222-2222-4222-8222-222222222222",
    plan_hash: H,
    resource_scope: [{ resource_uri: "repo://tenant/repository", snapshot_hash: R }],
    allowed_intents: ["repo.pr.prepare", "repo.pr.merge"],
    denied_intents: [],
    max_risk_tier: "medium",
    limits: { max_mutations: 4, max_retries: 2, max_pull_requests: 1 },
    require_readback: true,
    stop_on_drift: true,
    policy_version: "policy-v1",
    created_at: "2026-07-31T07:00:00.000Z",
    expires_at: "2026-07-31T10:00:00.000Z",
    revoked_at: null,
    secrets_included: false,
    ...overrides,
  };
}

function execution(overrides = {}) {
  return {
    plan_id: "22222222-2222-4222-8222-222222222222",
    plan_hash: H,
    intent_key: "repo.pr.prepare",
    resource_snapshot_hash: R,
    risk_tier: "low",
    operation_key: "prepare_pr",
    plan_step_id: "33333333-3333-4333-8333-333333333333",
    step_key: "prepare",
    step_fingerprint: STEP,
    is_mutation: true,
    readback_supported: true,
    certified_workflow: true,
    mutation_count: 0,
    retry_count: 0,
    pull_request_count: 0,
    ...overrides,
  };
}

function exactApproval(overrides = {}) {
  return {
    approved: true,
    approved_by: "user-1",
    expected_step_fingerprint: STEP,
    explicit_reserved_action_approval: false,
    ...overrides,
  };
}

const userOnly = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "user_approval_only" }),
  execution: execution(),
  now: NOW,
});
assert.equal(userOnly.decision, "user_approval_required");
assert.equal(userOnly.dispatch_allowed, false);
assert.equal(userOnly.approval_requirements.require_delegator_approval, true);

const userApproved = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "user_approval_only" }),
  execution: execution(),
  approval: exactApproval(),
  now: NOW,
});
assert.equal(userApproved.decision, "dispatch_allowed");
assert.equal(userApproved.dispatch_allowed, true);

const recommendOnly = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "agent_recommend_only", limits: { max_mutations: 0, max_retries: 0, max_pull_requests: 0 } }),
  execution: execution({ is_mutation: false, risk_tier: "read_only" }),
  now: NOW,
});
assert.equal(recommendOnly.decision, "recommend_only");
assert.equal(recommendOnly.dispatch_allowed, false);
assert.equal(recommendOnly.next_action.action, "present_agent_recommendation");

const queued = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "agent_queue_for_approval", limits: { max_mutations: 0, max_retries: 0, max_pull_requests: 0 } }),
  execution: execution({ is_mutation: false, risk_tier: "read_only" }),
  now: NOW,
});
assert.equal(queued.decision, "queued_for_approval");
assert.equal(queued.approval_required, true);

const lowRisk = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "delegated_low_risk", max_risk_tier: "low", allowed_intents: ["repo.pr.prepare"] }),
  execution: execution(),
  now: NOW,
});
assert.equal(lowRisk.decision, "dispatch_allowed");

const mediumDenied = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "delegated_low_risk", max_risk_tier: "medium", allowed_intents: ["repo.pr.prepare"] }),
  execution: execution({ risk_tier: "medium" }),
  now: NOW,
});
assert.equal(mediumDenied.decision, "blocked");
assert(mediumDenied.blockers.includes("DELEGATION_LOW_RISK_CEILING_EXCEEDED"));

const reservedNeedsApproval = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "delegated_plan_bound", allowed_intents: ["repo.pr.merge"], max_risk_tier: "high" }),
  execution: execution({ intent_key: "repo.pr.merge", risk_tier: "high" }),
  now: NOW,
});
assert.equal(reservedNeedsApproval.decision, "user_approval_required");

const reservedApproved = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "delegated_plan_bound", allowed_intents: ["repo.pr.merge"], max_risk_tier: "high" }),
  execution: execution({ intent_key: "repo.pr.merge", risk_tier: "high" }),
  approval: exactApproval({ explicit_reserved_action_approval: true }),
  now: NOW,
});
assert.equal(reservedApproved.decision, "dispatch_allowed");

const drifted = evaluateDelegationExecutionPolicy({
  grant: grant(),
  execution: execution({ plan_hash: "d".repeat(64) }),
  drift: { head_sha: { expected: "head-a", observed: "head-b" } },
  now: NOW,
});
assert.equal(drifted.decision, "paused_on_drift");
assert.equal(drifted.pause_required, true);
assert.equal(drifted.next_action.escalation_type, "delegation_boundary_drift");
assert(drifted.blockers.includes("DELEGATION_DRIFT_PLAN_HASH"));
assert(drifted.blockers.includes("DELEGATION_DRIFT_HEAD_SHA"));

const sodBlocked = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "multi_agent_approval" }),
  execution: execution({ separation_of_duties_required: true }),
  actors: { planner_agent_id: "agent-1", reviewer_agent_id: "agent-2", executor_agent_id: "agent-1" },
  now: NOW,
});
assert.equal(sodBlocked.decision, "blocked");
assert(sodBlocked.blockers.includes("DELEGATION_PLANNER_EXECUTOR_COLLISION"));

const selfApproved = evaluateDelegationExecutionPolicy({
  grant: grant({ approval_mode: "user_approval_only" }),
  execution: execution(),
  approval: exactApproval({ approved_by: "agent-1" }),
  now: NOW,
});
assert.equal(selfApproved.decision, "blocked");
assert(selfApproved.blockers.includes("DELEGATION_SELF_APPROVAL_FORBIDDEN"));

assert.throws(
  () => assertDelegationApprovalDecision({
    approvalPolicy: {
      delegation_grant: grant({ approval_mode: "user_approval_only" }),
      delegation_approval_requirements: { require_delegator_approval: true },
    },
    decision: "approved",
    decisionBy: "agent-1",
  }),
  (error) => error.code === "DELEGATION_SELF_APPROVAL_FORBIDDEN" && error.status === 403,
);

const sequentialProjection = evaluateSequentialStepDelegationPolicy({
  plan: {
    plan_id: "22222222-2222-4222-8222-222222222222",
    plan_hash: H,
    intent_key: "repo.pr.prepare",
    agent_id: "agent-1",
  },
  step: {
    plan_step_id: "33333333-3333-4333-8333-333333333333",
    step_key: "prepare",
    step_type: "workflow",
    workflow_key: "repo.pr.prepare",
    approval_policy_json: JSON.stringify({
      delegation_grant: grant({ approval_mode: "delegated_low_risk", max_risk_tier: "low", allowed_intents: ["repo.pr.prepare"] }),
      delegation_execution: {
        plan_hash: H,
        resource_snapshot_hash: R,
        risk_tier: "low",
        is_mutation: true,
        readback_supported: true,
        actors: { executor_agent_id: "agent-1" },
        now: NOW,
      },
    }),
  },
  actorId: "agent-1",
});
assert.equal(sequentialProjection.decision, "dispatch_allowed");

const renewal = evaluateDelegationRenewalPolicy({
  currentGrant: grant(),
  requestedGrant: grant({ expires_at: "2026-07-31T09:30:00.000Z", limits: { max_mutations: 3, max_retries: 1, max_pull_requests: 1 } }),
  approvedBy: "user-1",
});
assert.equal(renewal.decision, "renewal_allowed");

const widenedRenewal = evaluateDelegationRenewalPolicy({
  currentGrant: grant(),
  requestedGrant: grant({ expires_at: "2026-07-31T11:00:00.000Z" }),
  approvedBy: "agent-1",
});
assert.equal(widenedRenewal.decision, "blocked");
assert(widenedRenewal.blockers.includes("DELEGATION_RENEWAL_EXPIRY_EXTENDED"));
assert(widenedRenewal.blockers.includes("DELEGATION_RENEWAL_SELF_APPROVAL_FORBIDDEN"));

assert.equal(delegationExecutionPolicyContract.runtime_dispatch_gate, true);
assert.equal(delegationExecutionPolicyContract.human_on_drift, true);
assert.equal(delegationExecutionPolicyContract.separation_of_duties_foundation, true);
assert.equal(delegationExecutionPolicyContract.self_approval_forbidden, true);
assert.equal(delegationExecutionPolicyContract.renewal_no_widening, true);
assert.equal(delegationExecutionPolicyContract.secrets_included, false);

const orchestrator = await readFile(new URL("./sequentialPlanOrchestrator.js", import.meta.url), "utf8");
assert.match(orchestrator, /evaluateSequentialStepDelegationPolicy/);
assert.match(orchestrator, /assertDelegationApprovalDecision/);
assert.match(orchestrator, /delegation_policy_decided/);
assert.match(orchestrator, /delegation_boundary_drift/);

const legacyRoutes = await readFile(new URL("./routes/agentRegistryRoutes.js", import.meta.url), "utf8");
assert.match(legacyRoutes, /allowLegacyAgentDelegationMutation/);
assert.match(legacyRoutes, /canonical_delegation_grant_required/);
assert.match(legacyRoutes, /legacy_direct_mutation_enabled/);

const tasks = await readFile(new URL("../specs/011-durable-governed-execution-and-agent-delegation/tasks.md", import.meta.url), "utf8");
for (const task of ["T142", "T143", "T144", "T145", "T146", "T147", "T148", "T149"]) {
  assert.match(tasks, new RegExp(`- \\[x\\] ${task} `));
}
assert.match(tasks, /- \[ \] T141 /);

console.log("delegation execution policy runtime tests passed");
