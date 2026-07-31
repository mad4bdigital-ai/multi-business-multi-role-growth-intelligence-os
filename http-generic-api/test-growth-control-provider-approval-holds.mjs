import assert from "node:assert/strict";

import { composeGrowthControlProviderApprovalPlan } from "./src/domain/growthControlPlane/growthControlProviderApproval.js";
import {
  bindGrowthControlProviderApprovalHold,
  persistGrowthControlProviderApprovalPlan,
  runGrowthControlProviderApprovalPlan,
} from "./src/application/growthControlPlane/growthControlProviderApprovalService.js";

const PLAN_ID = "123e4567-e89b-12d3-a456-426614174000";
const TENANT_ID = "923e4567-e89b-12d3-a456-426614174111";
const PLAN_HASH = "a".repeat(64);

function compiledPlan(overrides = {}) {
  return {
    contractVersion: "spec-006-workflow-compiled-plan-v1",
    workflowIdentity: {
      workflowKey: "content.release",
      workflowVersion: "1.0.0",
      workflowHashSha256: "b".repeat(64),
    },
    normalizedDag: {
      nodes: [
        {
          nodeId: "draft.copy",
          capabilityKey: "content.draft",
          executionClass: "internal_draft",
          dependsOn: [],
          approvalCheckpoint: null,
          verificationCheckpoint: null,
        },
        {
          nodeId: "publish.copy",
          capabilityKey: "content.publish",
          executionClass: "provider_write",
          dependsOn: ["draft.copy"],
          approvalCheckpoint: {
            required: true,
            checkpointKey: "approve.publish",
            policyKey: "policy.content.publish",
          },
          verificationCheckpoint: {
            required: true,
            checkpointKey: "readback.publish",
          },
        },
      ],
      edges: [{ from: "draft.copy", to: "publish.copy" }],
      topologicalOrder: ["draft.copy", "publish.copy"],
    },
    approvalCheckpoints: [
      {
        nodeId: "publish.copy",
        required: true,
        checkpointKey: "approve.publish",
        policyKey: "policy.content.publish",
      },
    ],
    canonicalHashSha256: PLAN_HASH,
    immutable: true,
    providerCalls: false,
    providerDispatchAllowed: false,
    providerApplyAllowed: false,
    externalWrites: false,
    secretsIncluded: false,
    ...overrides,
  };
}

const input = {
  compiledPlan: compiledPlan(),
  planId: PLAN_ID,
  tenantId: TENANT_ID,
  environment: "staging",
  resourceIdsByNode: {
    "publish.copy": ["provider:cms/site-01", "provider:cms/site-01"],
  },
  actionIdsByNode: {
    "publish.copy": ["content.publish", "publish.copy"],
  },
  approvalProfile: {
    requiredRole: "platform_admin",
    expiresInSeconds: 1800,
  },
};

const composed = composeGrowthControlProviderApprovalPlan(input);
const recomposed = composeGrowthControlProviderApprovalPlan({
  ...input,
  resourceIdsByNode: { "publish.copy": ["provider:cms/site-01"] },
  actionIdsByNode: { "publish.copy": ["publish.copy", "content.publish"] },
});
assert.equal(composed.contractVersion, "growth-control-provider-approval-plan-v1");
assert.equal(composed.planId, PLAN_ID);
assert.equal(composed.tenantId, TENANT_ID);
assert.equal(composed.providerEffectNodeCount, 1);
assert.equal(composed.sequentialSteps.length, 2);
assert.equal(composed.sequentialSteps[0].step_type, "analysis");
assert.equal(composed.sequentialSteps[1].step_type, "workflow");
assert.equal(composed.sequentialSteps[1].approval_policy.required, true);
assert.equal(composed.sequentialSteps[1].approval_policy.approved, false);
assert.equal(composed.sequentialSteps[1].approval_policy.plan_hash_sha256, PLAN_HASH);
assert.match(composed.sequentialSteps[1].approval_policy.request_hash_sha256, /^[a-f0-9]{64}$/);
assert.deepEqual(composed.sequentialSteps[1].approval_policy.resource_ids, ["provider:cms/site-01"]);
assert.deepEqual(composed.sequentialSteps[1].approval_policy.action_ids, ["content.publish", "publish.copy"]);
assert.equal(composed.sequentialSteps[1].approval_policy.environment, "staging");
assert.equal(composed.sequentialSteps[1].approval_policy.effect_class, "provider_write");
assert.equal(composed.sequentialSteps[1].approval_policy.expires_in_seconds, 1800);
assert.equal(composed.sequentialSteps[1].max_attempts, 1);
assert.equal(composed.sequentialSteps[1].input.provider_dispatch_allowed, false);
assert.equal(composed.sequentialSteps[1].input.external_writes, false);
assert.equal(composed.providerCalls, false);
assert.equal(composed.providerDispatchAllowed, false);
assert.equal(composed.providerApplyAllowed, false);
assert.equal(composed.externalWrites, false);
assert.equal(composed.secretsIncluded, false);
assert.equal(composed.canonicalHashSha256, recomposed.canonicalHashSha256);
assert.equal(Object.isFrozen(composed), true);
assert.equal(Object.isFrozen(composed.sequentialSteps), true);
assert.equal(Object.isFrozen(composed.sequentialSteps[1].approval_policy), true);

assert.throws(
  () => composeGrowthControlProviderApprovalPlan({
    ...input,
    compiledPlan: compiledPlan({
      approvalCheckpoints: [],
      normalizedDag: {
        ...compiledPlan().normalizedDag,
        nodes: compiledPlan().normalizedDag.nodes.map((node) => (
          node.nodeId === "publish.copy" ? { ...node, approvalCheckpoint: null } : node
        )),
      },
    }),
  }),
  (error) => error?.code === "GROWTH_CONTROL_PROVIDER_APPROVAL_REQUIRED",
);
assert.throws(
  () => composeGrowthControlProviderApprovalPlan({ ...input, resourceIdsByNode: {} }),
  (error) => error?.code === "GROWTH_CONTROL_PROVIDER_RESOURCE_REQUIRED",
);
assert.throws(
  () => composeGrowthControlProviderApprovalPlan({
    ...input,
    approvalProfile: { ...input.approvalProfile, api_key: "forbidden" },
  }),
  (error) => error?.code === "GROWTH_CONTROL_APPROVAL_SENSITIVE_INPUT",
);
assert.throws(
  () => composeGrowthControlProviderApprovalPlan({
    ...input,
    compiledPlan: compiledPlan({ immutable: false }),
  }),
  (error) => error?.code === "GROWTH_CONTROL_APPROVAL_PLAN_INVALID",
);
assert.throws(
  () => composeGrowthControlProviderApprovalPlan({
    ...input,
    approvalProfile: { ...input.approvalProfile, expiresInSeconds: 30 },
  }),
  (error) => error?.code === "GROWTH_CONTROL_APPROVAL_PLAN_INVALID",
);

const state = {
  plans: [{
    plan_id: PLAN_ID,
    tenant_id: TENANT_ID,
    user_id: "actor-owner",
    plan_status: "draft",
    runtime_status: "draft",
    service_mode: "managed",
  }],
  steps: [],
  events: [],
  holds: [],
  workflowRuns: [],
};

function rowResult(rows) {
  return [rows, []];
}

const connection = {
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {},
  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT plan_id, tenant_id, plan_status, runtime_status FROM execution_plans")) {
      return rowResult([state.plans[0]]);
    }
    if (text.startsWith("SELECT * FROM execution_plans WHERE plan_id") && text.includes("FOR UPDATE")) {
      return rowResult([state.plans[0]]);
    }
    if (text.startsWith("SELECT * FROM execution_plan_steps WHERE plan_id")) {
      return rowResult([...state.steps].sort((left, right) => left.step_order - right.step_order));
    }
    if (text.startsWith("SELECT * FROM execution_plan_steps WHERE plan_step_id") && text.includes("claim_token")) {
      return rowResult(state.steps.filter((step) => step.plan_step_id === params[0] && step.claim_token === params[1]));
    }
    if (text.startsWith("SELECT * FROM approval_holds WHERE hold_id")) {
      return rowResult(state.holds.filter((hold) => hold.hold_id === params[0]));
    }
    if (text.startsWith("SELECT plan_step_id, plan_id, tenant_id, status, step_key, approval_policy_json")) {
      return rowResult(state.steps.filter((step) => step.plan_step_id === params[0] && step.plan_id === params[1]));
    }
    if (text.startsWith("SELECT hold_id, run_id, step_run_id, tenant_id, status, required_role")) {
      return rowResult(state.holds.filter((hold) => hold.hold_id === params[0]));
    }
    if (text.startsWith("DELETE FROM execution_plan_steps")) {
      state.steps = [];
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("INSERT INTO execution_plan_steps")) {
      state.steps.push({
        plan_step_id: params[0],
        plan_id: params[1],
        tenant_id: params[2],
        step_order: params[3],
        step_key: params[4],
        step_type: params[5],
        workflow_id: params[6],
        workflow_key: params[7],
        depends_on_json: params[8],
        input_json: params[9],
        success_criteria_json: params[10],
        retry_policy_json: params[11],
        approval_policy_json: params[12],
        status: params[13],
        attempt_count: 0,
        max_attempts: params[14],
        idempotency_key: params[15],
        claim_token: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("INSERT INTO execution_plan_events")) {
      state.events.push({ params });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("INSERT INTO workflow_runs")) {
      const existing = state.workflowRuns.find((run) => run.run_id === params[0]);
      const run = {
        run_id: params[0],
        tenant_id: params[1],
        status: "awaiting_approval",
        current_step: params[5],
      };
      if (existing) Object.assign(existing, run); else state.workflowRuns.push(run);
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("INSERT INTO approval_holds")) {
      state.holds.push({
        hold_id: params[0],
        run_id: params[1],
        step_run_id: null,
        tenant_id: params[2],
        hold_type: "supervisor_approval",
        requested_by: params[3],
        required_role: params[4],
        status: "open",
        expires_at: null,
        execution_context_json: params[5],
      });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("UPDATE execution_plans SET plan_status = 'validated', runtime_status = 'validated'")) {
      state.plans[0].plan_status = "validated";
      state.plans[0].runtime_status = "validated";
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("UPDATE execution_plans SET plan_status = ?, runtime_status = ?")) {
      state.plans[0].plan_status = params[0];
      state.plans[0].runtime_status = params[1];
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("UPDATE execution_plan_steps SET status = 'ready'")) {
      const step = state.steps.find((item) => item.plan_step_id === params[0]);
      if (step) step.status = "ready";
      return [{ affectedRows: step ? 1 : 0 }];
    }
    if (text.startsWith("UPDATE execution_plan_steps SET status = 'awaiting_approval'")) {
      const step = state.steps.find((item) => item.plan_step_id === params[0]);
      if (step) step.status = "awaiting_approval";
      return [{ affectedRows: step ? 1 : 0 }];
    }
    if (text.includes("SET status = 'claimed'")) {
      const step = state.steps.find((item) => item.plan_step_id === params[1]);
      step.status = "claimed";
      step.claim_token = params[0];
      step.attempt_count += 1;
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("UPDATE execution_plan_steps SET status = ?, output_json")) {
      const step = state.steps.find((item) => item.plan_step_id === params[4] && item.claim_token === params[5]);
      if (step) {
        step.status = params[0];
        step.output_json = params[1];
        step.error_json = params[2];
        step.claim_token = null;
      }
      return [{ affectedRows: step ? 1 : 0 }];
    }
    if (text.startsWith("UPDATE approval_holds SET step_run_id = ?")) {
      const hold = state.holds.find((item) => item.hold_id === params[5] && item.status === "open");
      if (hold) {
        hold.step_run_id = params[0];
        hold.requested_by ||= params[1];
        hold.required_role = params[2];
        hold.expires_at = params[3];
        hold.execution_context_json = params[4];
      }
      return [{ affectedRows: hold ? 1 : 0 }];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  },
};
const pool = {
  async getConnection() { return connection; },
  query: connection.query.bind(connection),
};

const persisted = await persistGrowthControlProviderApprovalPlan({
  pool,
  ...input,
  actorId: "planner-actor",
});
assert.equal(persisted.ok, true);
assert.equal(persisted.provider_effect_node_count, 1);
assert.equal(persisted.provider_dispatch_allowed, false);
assert.equal(state.steps.length, 2);

const executed = [];
const execution = await runGrowthControlProviderApprovalPlan({
  pool,
  planId: PLAN_ID,
  actorId: "approval-requester",
  executeStep: async (step) => {
    executed.push(step.step_key);
    return { ok: true, output: { node_id: step.step_key } };
  },
  maxTicks: 10,
});
assert.deepEqual(executed, ["draft.copy"]);
assert.equal(execution.ok, true);
assert.equal(execution.execution.last_tick.reason, "awaiting_approval");
assert.equal(execution.provider_dispatch_before_approval, false);
assert.equal(state.holds.length, 1);
assert.equal(state.steps[1].status, "awaiting_approval");
assert.equal(state.plans[0].runtime_status, "awaiting_approval");
assert(execution.approval_hold);
assert.equal(execution.approval_hold.idempotent_replay, false);
assert.equal(execution.approval_hold.plan_hash_sha256, PLAN_HASH);
assert.deepEqual(execution.approval_hold.resource_ids, ["provider:cms/site-01"]);
assert.deepEqual(execution.approval_hold.action_ids, ["content.publish", "publish.copy"]);
assert.equal(execution.approval_hold.environment, "staging");
assert.equal(execution.approval_hold.effect_class, "provider_write");
assert.equal(execution.approval_hold.provider_dispatch_allowed, false);
assert.equal(state.holds[0].step_run_id, state.steps[1].plan_step_id);
assert(state.holds[0].expires_at instanceof Date);
const boundContext = JSON.parse(state.holds[0].execution_context_json);
assert.equal(boundContext.source, "growth_control_provider_effect");
assert.equal(boundContext.plan_id, PLAN_ID);
assert.equal(boundContext.plan_step_id, state.steps[1].plan_step_id);
assert.equal(boundContext.plan_hash_sha256, PLAN_HASH);
assert.equal(boundContext.request_hash_sha256, state.steps[1] && JSON.parse(state.steps[1].approval_policy_json).request_hash_sha256);
assert.match(boundContext.binding_sha256, /^[a-f0-9]{64}$/);
assert.equal(boundContext.provider_dispatch_allowed, false);
assert.equal(boundContext.external_writes, false);
assert.equal(boundContext.secrets_included, false);
assert.equal(JSON.stringify(boundContext).includes("credential"), false);
assert.equal(JSON.stringify(boundContext).includes("token"), false);

const replay = await bindGrowthControlProviderApprovalHold({
  pool,
  holdId: state.holds[0].hold_id,
  planId: PLAN_ID,
  planStepId: state.steps[1].plan_step_id,
  actorId: "approval-requester",
});
assert.equal(replay.idempotent_replay, true);
assert.equal(state.holds.length, 1);

const policy = JSON.parse(state.steps[1].approval_policy_json);
state.steps[1].approval_policy_json = JSON.stringify({ ...policy, request_hash_sha256: "c".repeat(64) });
await assert.rejects(
  () => bindGrowthControlProviderApprovalHold({
    pool,
    holdId: state.holds[0].hold_id,
    planId: PLAN_ID,
    planStepId: state.steps[1].plan_step_id,
    actorId: "approval-requester",
  }),
  (error) => error?.code === "growth_control_approval_binding_mismatch",
);
assert.deepEqual(executed, ["draft.copy"], "provider-effect executor must not run before approval");
assert.equal(state.holds.length, 1, "approval replay must not create duplicate holds");

console.log("growth control durable provider approval hold tests passed");
