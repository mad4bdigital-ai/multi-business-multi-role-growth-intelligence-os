import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compileSequentialPlanSteps,
  persistCompiledSequentialPlan,
  runSequentialPlan,
  tickSequentialPlan,
  verifySequentialStepResult,
} from "./sequentialPlanOrchestrator.js";

const compiled = compileSequentialPlanSteps([
  { step_key: "discover", step_type: "analysis", input: { task: "discover" } },
  { step_key: "prepare", step_type: "checkpoint", depends_on: ["discover"] },
  { step_key: "apply", step_type: "workflow", workflow_key: "wf_apply", depends_on: ["prepare"], approval_policy: { required: true } },
], { planId: "plan-1", tenantId: "tenant-1" });
assert.equal(compiled.length, 3);
assert.equal(compiled[0].status, "ready");
assert.equal(compiled[1].status, "pending");
assert.deepEqual(compiled[2].depends_on, ["prepare"]);
assert.throws(
  () => compileSequentialPlanSteps([{ step_key: "bad", depends_on: ["future"] }], { planId: "plan-1", tenantId: "tenant-1" }),
  /unknown or later step/
);
assert.equal(verifySequentialStepResult({ success_criteria: { result_ok: true, required_output_fields: ["output.id"] } }, { ok: true, output: { id: "x" } }).passed, true);
assert.deepEqual(
  verifySequentialStepResult({ success_criteria: { result_ok: true, required_output_fields: ["output.id"] } }, { ok: true, output: {} }).failures,
  ["missing_output_field:output.id"]
);

const state = {
  plans: [{ plan_id: "plan-1", tenant_id: "tenant-1", plan_status: "draft", runtime_status: "draft" }],
  steps: [],
  events: [],
  holds: [],
};

const connection = {
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {},
  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (text.startsWith("SELECT plan_id, tenant_id, plan_status, runtime_status FROM execution_plans")) return [[state.plans[0]]];
    if (text.startsWith("SELECT * FROM execution_plans WHERE plan_id")) return [[state.plans[0]]];
    if (text.startsWith("SELECT * FROM execution_plan_steps WHERE plan_id")) return [[...state.steps].sort((a, b) => a.step_order - b.step_order)];
    if (text.startsWith("SELECT * FROM execution_plan_steps WHERE plan_step_id")) {
      return [[state.steps.find((step) => step.plan_step_id === params[0] && step.claim_token === params[1])].filter(Boolean)];
    }
    if (text.startsWith("DELETE FROM execution_plan_steps")) { state.steps = []; return [{ affectedRows: 1 }]; }
    if (text.startsWith("INSERT INTO execution_plan_steps")) {
      state.steps.push({
        plan_step_id: params[0], plan_id: params[1], tenant_id: params[2], step_order: params[3],
        step_key: params[4], step_type: params[5], workflow_id: params[6], workflow_key: params[7],
        depends_on_json: params[8], input_json: params[9], success_criteria_json: params[10],
        retry_policy_json: params[11], approval_policy_json: params[12], status: params[13],
        attempt_count: 0, max_attempts: params[14], idempotency_key: params[15], claim_token: null,
      });
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("INSERT INTO execution_plan_events")) { state.events.push({ params }); return [{ affectedRows: 1 }]; }
    if (text.startsWith("INSERT INTO approval_holds")) { state.holds.push({ hold_id: params[0], plan_step_id: params[2] }); return [{ affectedRows: 1 }]; }
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
      state.steps.find((step) => step.plan_step_id === params[0]).status = "awaiting_approval";
      return [{ affectedRows: 1 }];
    }
    if (text.includes("SET status = 'claimed'")) {
      const step = state.steps.find((item) => item.plan_step_id === params[1]);
      step.status = "claimed"; step.claim_token = params[0]; step.attempt_count += 1;
      return [{ affectedRows: 1 }];
    }
    if (text.startsWith("UPDATE execution_plan_steps SET status = ?, output_json")) {
      const step = state.steps.find((item) => item.plan_step_id === params[4] && item.claim_token === params[5]);
      step.status = params[0]; step.output_json = params[1]; step.error_json = params[2]; step.claim_token = null;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${text}`);
  },
};
const pool = { async getConnection() { return connection; }, query: connection.query.bind(connection) };

await persistCompiledSequentialPlan({
  pool,
  planId: "plan-1",
  tenantId: "tenant-1",
  steps: [
    { step_key: "first", step_type: "analysis" },
    { step_key: "second", step_type: "checkpoint", depends_on: ["first"] },
    { step_key: "approval", step_type: "workflow", workflow_key: "wf_apply", depends_on: ["second"], approval_policy: { required: true } },
  ],
});
assert.equal(state.steps.length, 3);

const executed = [];
const run = await runSequentialPlan({
  pool,
  planId: "plan-1",
  executeStep: async (step) => { executed.push(step.step_key); return { ok: true, step_key: step.step_key }; },
});
assert.deepEqual(executed, ["first", "second"]);
assert.equal(run.last_tick.reason, "awaiting_approval");
assert.equal(state.plans[0].plan_status, "validated");
assert.equal(state.plans[0].runtime_status, "awaiting_approval");
assert.equal(state.holds.length, 1);
assert.equal(state.steps[2].status, "awaiting_approval");

const duplicateTick = await tickSequentialPlan({
  pool,
  planId: "plan-1",
  executeStep: async () => { throw new Error("must not execute"); },
});
assert.equal(duplicateTick.reason, "awaiting_approval");
assert.equal(duplicateTick.plan_status, "awaiting_approval");
assert.equal(state.plans[0].plan_status, "validated");
assert.equal(state.plans[0].runtime_status, "awaiting_approval");

const migration = readFileSync("migrations/244_sprint68_sequential_plan_orchestrator.sql", "utf8");
const plannerRoutes = readFileSync("routes/plannerRoutes.js", "utf8");
const approvalRoutes = readFileSync("routes/workflowOrchestrationRoutes.js", "utf8");
const jobRunner = readFileSync("jobRunner.js", "utf8");
const sequentialRuntime = readFileSync("sequentialPlanOrchestrator.js", "utf8");
const governedMigrationRunner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
assert.match(migration, /ADD COLUMN IF NOT EXISTS runtime_status/);
const openapi = readFileSync("openapi.yaml", "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS execution_plan_steps/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS execution_plan_events/);
assert.match(plannerRoutes, /\/planner\/plans\/:id\/compile/);
assert.match(plannerRoutes, /\/planner\/plans\/:id\/tick/);
assert.match(plannerRoutes, /\/planner\/plans\/:id\/run/);
assert.match(plannerRoutes, /\/planner\/plans\/:id\/enqueue/);
assert.match(plannerRoutes, /\/planner\/plans\/:id\/resume/);
assert.match(plannerRoutes, /\/planner\/plans\/:id\/timeline/);
assert.match(approvalRoutes, /sequential_plan_orchestrator/);
assert.match(jobRunner, /SEQUENTIAL_PLAN_RUN_JOB_TYPE/);
assert.match(plannerRoutes, /function principalActor\(req\)/);
assert.equal(plannerRoutes.includes("req.body?.actor_id"), false, "planner routes must derive audit actor from authenticated principal");
assert.match(approvalRoutes, /LIMIT 1 FOR UPDATE/);
assert.match(approvalRoutes, /hold_decision_race/);
assert.match(approvalRoutes, /step_status: nextStepStatus/);
assert.equal(approvalRoutes.includes("const { decision, decision_by"), false, "approval actor must not come from request body");
assert.match(sequentialRuntime, /claim_token_hash: sha256\(claimToken\)/);
assert.equal(sequentialRuntime.includes("evidence: { claim_token: claimToken }"), false, "raw claim token must never enter audit evidence");
assert.match(jobRunner, /runSequentialPlan/);
const sequentialOpenApiSection = openapi.slice(
  openapi.indexOf("  /planner/plans/{plan_id}/compile:"),
  openapi.indexOf("  /planner/plans/{plan_id}/timeline:") + 1200
);
assert.equal(sequentialOpenApiSection.includes("actor_id:"), false, "Sequential Plan OpenAPI must derive audit actor from authentication");
assert.match(governedMigrationRunner, /244_sprint68_sequential_plan_orchestrator\.sql/);
for (const operationId of ["compileSequentialPlan", "tickSequentialPlan", "runSequentialPlan", "enqueueSequentialPlan", "resumeSequentialPlan", "getSequentialPlanTimeline"]) {
  assert.match(openapi, new RegExp(`operationId: ${operationId}`));
}

console.log("sequential plan orchestrator tests passed");
