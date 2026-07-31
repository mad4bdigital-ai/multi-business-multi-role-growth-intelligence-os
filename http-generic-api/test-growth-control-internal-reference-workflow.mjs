import assert from "node:assert/strict";

import {
  _testingGrowthControlInternalReferenceWorkflow,
  composeGrowthControlInternalReferenceWorkflow,
  persistGrowthControlInternalReferenceWorkflow,
  readGrowthControlInternalReferenceWorkflow,
  runGrowthControlInternalReferenceWorkflow,
} from "./src/application/growthControlPlane/growthControlInternalReferenceWorkflowService.js";

const PLAN_ID = "223e4567-e89b-12d3-a456-426614174000";
const TENANT_ID = "823e4567-e89b-12d3-a456-426614174111";
const PLAN_HASH = "d".repeat(64);

function compiledPlan({ nodes = null } = {}) {
  const workflowNodes = nodes || [
    {
      nodeId: "context.prepare",
      capabilityKey: "context.prepare",
      executionClass: "internal_draft",
      dependsOn: [],
      approvalCheckpoint: null,
      verificationCheckpoint: null,
    },
    {
      nodeId: "artifact.compose",
      capabilityKey: "artifact.compose",
      executionClass: "analysis",
      dependsOn: ["context.prepare"],
      approvalCheckpoint: null,
      verificationCheckpoint: null,
    },
    {
      nodeId: "artifact.verify",
      capabilityKey: "artifact.verify",
      executionClass: "verification",
      dependsOn: ["artifact.compose"],
      approvalCheckpoint: null,
      verificationCheckpoint: {
        required: true,
        checkpointKey: "artifact.verify.readback",
      },
    },
  ];
  return {
    contractVersion: "spec-006-workflow-compiled-plan-v1",
    workflowIdentity: {
      workflowKey: "internal.reference.artifact",
      workflowVersion: "1.0.0",
      workflowHashSha256: "e".repeat(64),
    },
    normalizedDag: {
      nodes: workflowNodes,
      edges: workflowNodes.flatMap((node) => node.dependsOn.map((dependency) => ({
        from: dependency,
        to: node.nodeId,
      }))),
      topologicalOrder: workflowNodes.map((node) => node.nodeId),
    },
    approvalCheckpoints: [],
    canonicalHashSha256: PLAN_HASH,
    immutable: true,
    providerCalls: false,
    providerDispatchAllowed: false,
    providerApplyAllowed: false,
    externalWrites: false,
    secretsIncluded: false,
  };
}

const input = {
  compiledPlan: compiledPlan(),
  planId: PLAN_ID,
  tenantId: TENANT_ID,
  environment: "development",
};

const composed = composeGrowthControlInternalReferenceWorkflow(input);
assert.equal(composed.contractVersion, "growth-control-internal-reference-workflow-v1");
assert.equal(composed.stepCount, 3);
assert.deepEqual(composed.sequentialSteps.map((step) => step.step_type), ["analysis", "analysis", "checkpoint"]);
assert.equal(composed.providerEffectNodeCount, 0);
assert.equal(composed.providerDispatchAllowed, false);
assert.equal(composed.externalWrites, false);
assert.equal(composed.secretsIncluded, false);
assert.match(composed.canonicalHashSha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(composed), true);
assert.equal(Object.isFrozen(composed.sequentialSteps), true);

assert.throws(
  () => composeGrowthControlInternalReferenceWorkflow({
    ...input,
    compiledPlan: compiledPlan({
      nodes: compiledPlan().normalizedDag.nodes.slice(0, 2),
    }),
  }),
  (error) => error?.code === "growth_control_internal_reference_step_count_invalid",
);

assert.throws(
  () => composeGrowthControlInternalReferenceWorkflow({
    ...input,
    compiledPlan: compiledPlan({
      nodes: [
        compiledPlan().normalizedDag.nodes[0],
        compiledPlan().normalizedDag.nodes[1],
        {
          nodeId: "artifact.publish",
          capabilityKey: "artifact.publish",
          executionClass: "provider_write",
          dependsOn: ["artifact.compose"],
          approvalCheckpoint: {
            required: true,
            checkpointKey: "artifact.publish.approval",
          },
          verificationCheckpoint: {
            required: true,
            checkpointKey: "artifact.publish.readback",
          },
        },
      ],
    }),
    resourceIdsByNode: { "artifact.publish": ["provider:reference/site-01"] },
  }),
  (error) => error?.code === "growth_control_internal_reference_provider_effect_forbidden",
);

assert.throws(
  () => _testingGrowthControlInternalReferenceWorkflow.boundedArtifact({ api_key: "forbidden" }),
  (error) => error?.code === "growth_control_internal_artifact_sensitive",
);
assert.throws(
  () => _testingGrowthControlInternalReferenceWorkflow.evidenceReference(""),
  (error) => error?.code === "growth_control_internal_readback_invalid",
);

const state = {
  plans: [{
    plan_id: PLAN_ID,
    tenant_id: TENANT_ID,
    user_id: "reference-owner",
    plan_status: "draft",
    runtime_status: "draft",
    service_mode: "managed",
  }],
  steps: [],
  events: [],
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
    if (text.startsWith("SELECT plan_id, tenant_id, plan_status, runtime_status FROM execution_plans") && text.includes("FOR UPDATE")) {
      return rowResult([state.plans[0]]);
    }
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
    if (text.startsWith("SELECT plan_step_id, plan_id, tenant_id, step_order, step_key, step_type, depends_on_json")) {
      return rowResult([...state.steps].sort((left, right) => left.step_order - right.step_order));
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
        output_json: null,
        error_json: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("INSERT INTO execution_plan_events")) {
      state.events.push({ params });
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
    if (text.includes("SET status = 'claimed'")) {
      const step = state.steps.find((item) => item.plan_step_id === params[1]);
      if (step) {
        step.status = "claimed";
        step.claim_token = params[0];
        step.attempt_count += 1;
      }
      return [{ affectedRows: step ? 1 : 0 }];
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
    throw new Error(`Unexpected SQL: ${text}`);
  },
};

const pool = {
  async getConnection() { return connection; },
  query: connection.query.bind(connection),
};

const persisted = await persistGrowthControlInternalReferenceWorkflow({
  pool,
  ...input,
  actorId: "reference-planner",
});
assert.equal(persisted.ok, true);
assert.equal(persisted.step_count, 3);
assert.equal(persisted.provider_dispatch_allowed, false);
assert.equal(state.steps.length, 3);

const executed = [];
const result = await runGrowthControlInternalReferenceWorkflow({
  pool,
  ...input,
  actorId: "reference-runner",
  executeInternalStep: async (step) => {
    const stepInput = JSON.parse(step.input_json);
    executed.push(step.step_key);
    const artifact = {
      artifact_key: `${step.step_key}.artifact`,
      artifact_type: "internal_reference_test",
      node_id: stepInput.node_id,
      capability_key: stepInput.capability_key,
      source_plan_hash_sha256: stepInput.plan_hash_sha256,
      ordinal: executed.length,
    };
    return {
      ok: true,
      output: artifact,
      readback: { evidence_ref: `evidence://internal-reference/${step.step_key}` },
    };
  },
});
assert.equal(result.ok, true);
assert.deepEqual(executed, ["context.prepare", "artifact.compose", "artifact.verify"]);
assert.equal(result.execution.last_tick.reason, "completed");
assert.equal(result.execution.tick_count, 4);
assert.equal(result.provider_dispatch_allowed, false);
assert.equal(result.external_writes, false);
assert.equal(result.readback.contract_version, "growth-control-internal-reference-readback-v1");
assert.equal(result.readback.plan_status, "completed");
assert.equal(result.readback.artifact_count, 3);
assert.equal(result.readback.artifacts.length, 3);
assert.equal(result.readback.lineage.length, 3);
assert.deepEqual(result.readback.lineage.map((item) => item.step_key), executed);
assert.deepEqual(result.readback.lineage[1].depends_on, ["context.prepare"]);
assert.deepEqual(result.readback.lineage[2].depends_on, ["artifact.compose"]);
assert(result.readback.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.output_sha256)));
assert(result.readback.artifacts.every((item) => item.evidence_ref.startsWith("evidence://internal-reference/")));
assert(result.readback.lineage.every((item) => item.source_plan_hash_sha256 === PLAN_HASH));
assert.match(result.readback.readback_sha256, /^[a-f0-9]{64}$/);
assert.equal(result.readback.provider_calls, false);
assert.equal(result.readback.provider_dispatch_allowed, false);
assert.equal(result.readback.external_writes, false);
assert.equal(result.readback.secrets_included, false);
assert.equal(JSON.stringify(result.readback).includes("api_key"), false);
assert.equal(state.events.length > 0, true);
assert.equal(state.steps.every((step) => step.status === "completed"), true);

const stableReadback = await readGrowthControlInternalReferenceWorkflow({
  pool,
  planId: PLAN_ID,
  tenantId: TENANT_ID,
  expectedPlanHashSha256: PLAN_HASH,
});
assert.equal(stableReadback.readback_sha256, result.readback.readback_sha256);

const originalOutput = state.steps[1].output_json;
const tampered = JSON.parse(originalOutput);
tampered.output.ordinal = 999;
state.steps[1].output_json = JSON.stringify(tampered);
await assert.rejects(
  () => readGrowthControlInternalReferenceWorkflow({
    pool,
    planId: PLAN_ID,
    tenantId: TENANT_ID,
    expectedPlanHashSha256: PLAN_HASH,
  }),
  (error) => error?.code === "growth_control_internal_readback_hash_mismatch",
);
state.steps[1].output_json = originalOutput;

console.log("growth control internal reference workflow tests passed");
