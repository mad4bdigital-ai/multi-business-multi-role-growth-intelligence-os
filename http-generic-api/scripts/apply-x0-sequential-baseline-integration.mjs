#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const telemetryPath = path.join(apiRoot, "governedExecutionBaselineTelemetry.js");
const orchestratorPath = path.join(apiRoot, "sequentialPlanOrchestrator.js");
const testPath = path.join(apiRoot, "test-sequential-plan-orchestrator.mjs");

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source block is not unique`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

let telemetry = fs.readFileSync(telemetryPath, "utf8");
telemetry = replaceExactlyOnce(
  telemetry,
  `  function increment(counter, amount = 1) {\n    if (!observeCounter(counter)) return false;\n    counters[counter] = boundedCounterValue(counters[counter] + safeNumber(amount));\n    return true;\n  }`,
  `  function setCounter(counter, value) {\n    if (!observeCounter(counter)) return false;\n    counters[counter] = boundedCounterValue(value);\n    return true;\n  }\n\n  function maxCounter(counter, value) {\n    if (!observeCounter(counter)) return false;\n    counters[counter] = Math.max(counters[counter], boundedCounterValue(value));\n    return true;\n  }\n\n  function increment(counter, amount = 1) {\n    if (!observeCounter(counter)) return false;\n    counters[counter] = boundedCounterValue(counters[counter] + safeNumber(amount));\n    return true;\n  }`,
  "telemetry counter methods",
);
telemetry = replaceExactlyOnce(
  telemetry,
  `    increment,\n    observeCounter,\n    startStage,`,
  `    increment,\n    setCounter,\n    maxCounter,\n    observeCounter,\n    startStage,`,
  "telemetry public methods",
);

let orchestrator = fs.readFileSync(orchestratorPath, "utf8");
orchestrator = replaceExactlyOnce(
  orchestrator,
  `import { getPool } from "./db.js";`,
  `import { getPool } from "./db.js";\nimport {\n  createGovernedExecutionBaselineTrace,\n  emitGovernedExecutionBaselineSnapshot,\n} from "./governedExecutionBaselineTelemetry.js";`,
  "orchestrator telemetry import",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `async function claimNextStep({ pool, planId }) {`,
  `async function claimNextStep({ pool, planId, baselineTrace = null }) {`,
  "claim signature",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `    const steps = await loadPlanSteps(conn, planId, { forUpdate: true });\n    if (TERMINAL_PLAN_STATUSES.has(plan.plan_status)) {`,
  `    const steps = await loadPlanSteps(conn, planId, { forUpdate: true });\n    baselineTrace?.setCounter?.("plan_steps", steps.length);\n    if (TERMINAL_PLAN_STATUSES.has(plan.plan_status)) {`,
  "plan step gauge",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `    const ready = steps.filter((step) => step.status === "ready").sort((a, b) => Number(a.step_order) - Number(b.step_order));\n    if (!ready.length) {`,
  `    const ready = steps.filter((step) => step.status === "ready").sort((a, b) => Number(a.step_order) - Number(b.step_order));\n    baselineTrace?.maxCounter?.("ready_set_width", ready.length);\n    if (!ready.length) {`,
  "ready set gauge",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `export async function tickSequentialPlan({ pool = getPool(), planId, executeStep = null } = {}) {\n  const claim = await claimNextStep({ pool, planId });`,
  `export async function tickSequentialPlan({\n  pool = getPool(),\n  planId,\n  executeStep = null,\n  baselineTrace = null,\n} = {}) {\n  const finishClaimLedger = baselineTrace?.startStage?.("ledger");\n  let claim;\n  try {\n    claim = await claimNextStep({ pool, planId, baselineTrace });\n  } finally {\n    finishClaimLedger?.();\n  }`,
  "tick claim instrumentation",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `  const executor = executeStep || ((candidate) => defaultStepExecutor(candidate, { pool }));\n  let result;\n  try { result = await executor(step); }\n  catch (error) { result = { ok: false, error: String(error?.message || error) }; }\n  const verification = verifySequentialStepResult(step, result);\n  return finalizeClaimedStep({ pool, step, result, verification });`,
  `  const executor = executeStep || ((candidate) => defaultStepExecutor(candidate, { pool }));\n  const finishDispatch = step.step_type === "workflow"\n    ? baselineTrace?.startStage?.("provider_dispatch")\n    : null;\n  let result;\n  try { result = await executor(step); }\n  catch (error) { result = { ok: false, error: String(error?.message || error) }; }\n  finally { finishDispatch?.(); }\n  baselineTrace?.increment?.("critical_path_steps", 1);\n  const verification = verifySequentialStepResult(step, result);\n  const finishFinalizeLedger = baselineTrace?.startStage?.("ledger");\n  try {\n    return await finalizeClaimedStep({ pool, step, result, verification });\n  } finally {\n    finishFinalizeLedger?.();\n  }`,
  "tick execution instrumentation",
);
const oldRun = `export async function runSequentialPlan({\n  pool = getPool(),\n  planId,\n  executeStep = null,\n  maxTicks = 100,\n} = {}) {\n  const executor = executeStep || ((step) => defaultStepExecutor(step, { pool }));\n  let last = null;\n  for (let i = 0; i < maxTicks; i += 1) {\n    last = await tickSequentialPlan({ pool, planId, executeStep: executor });\n    if (["completed", "failed", "cancelled"].includes(last.plan_status) || ["awaiting_approval", "failed", "no_runnable_step"].includes(last.reason)) {\n      return { ok: true, ticks: i + 1, last_tick: last };\n    }\n  }\n  const err = new Error("Sequential plan exceeded maximum tick budget");\n  err.status = 409;\n  err.code = "sequential_plan_tick_budget_exceeded";\n  err.details = { plan_id: planId, max_ticks: maxTicks, last_tick: last };\n  throw err;\n}`;
const newRun = `export async function runSequentialPlan({\n  pool = getPool(),\n  planId,\n  executeStep = null,\n  maxTicks = 100,\n  baselineEmitter = null,\n  baselineTraceInput = {},\n} = {}) {\n  const executor = executeStep || ((step) => defaultStepExecutor(step, { pool }));\n  const baselineTrace = typeof baselineEmitter === "function"\n    ? createGovernedExecutionBaselineTrace({\n        ...baselineTraceInput,\n        plan_id: planId,\n        entry_point: "sequential_plan",\n      })\n    : null;\n  if (baselineTrace && !executeStep) baselineTrace.observeCounter("internal_http_hops");\n\n  let last = null;\n  let finalOutcome = "running";\n  let resultClassification = "sequential_plan_running";\n  try {\n    for (let i = 0; i < maxTicks; i += 1) {\n      last = await tickSequentialPlan({ pool, planId, executeStep: executor, baselineTrace });\n      if (["completed", "failed", "cancelled"].includes(last.plan_status) || ["awaiting_approval", "failed", "no_runnable_step"].includes(last.reason)) {\n        finalOutcome = last.plan_status === "completed"\n          ? "success"\n          : last.reason === "awaiting_approval"\n            ? "awaiting_approval"\n            : last.plan_status === "cancelled"\n              ? "cancelled"\n              : last.plan_status === "failed" || last.reason === "failed"\n                ? "failure"\n                : "blocked";\n        resultClassification = \`sequential_plan_\${last.reason || last.plan_status || "terminal"}\`;\n        return { ok: true, ticks: i + 1, last_tick: last };\n      }\n    }\n    const err = new Error("Sequential plan exceeded maximum tick budget");\n    err.status = 409;\n    err.code = "sequential_plan_tick_budget_exceeded";\n    err.details = { plan_id: planId, max_ticks: maxTicks, last_tick: last };\n    finalOutcome = "failure";\n    resultClassification = err.code;\n    throw err;\n  } catch (error) {\n    if (finalOutcome === "running") {\n      finalOutcome = "failure";\n      resultClassification = String(error?.code || "sequential_plan_failed");\n    }\n    throw error;\n  } finally {\n    if (baselineTrace) {\n      const snapshot = baselineTrace.finalize({\n        outcome: finalOutcome,\n        result_classification: resultClassification,\n      });\n      void emitGovernedExecutionBaselineSnapshot(snapshot, baselineEmitter);\n    }\n  }\n}`;
orchestrator = replaceExactlyOnce(orchestrator, oldRun, newRun, "runSequentialPlan integration");

let test = fs.readFileSync(testPath, "utf8");
test = replaceExactlyOnce(
  test,
  `const executed = [];\nconst run = await runSequentialPlan({\n  pool,\n  planId: "plan-1",\n  executeStep: async (step) => { executed.push(step.step_key); return { ok: true, step_key: step.step_key }; },\n});`,
  `const executed = [];\nlet firstBaselineSnapshot = null;\nconst run = await runSequentialPlan({\n  pool,\n  planId: "plan-1",\n  executeStep: async (step) => { executed.push(step.step_key); return { ok: true, step_key: step.step_key }; },\n  baselineEmitter: (snapshot) => { firstBaselineSnapshot = snapshot; },\n  baselineTraceInput: { trace_id: "sequential-trace-1", request_id: "request-1" },\n});`,
  "first sequential baseline fixture",
);
test = replaceExactlyOnce(
  test,
  `assert.equal(state.workflowRuns[0].status, "awaiting_approval");\nconst claimedEvent = state.events.find(({ params }) => params[4] === "step_claimed");`,
  `assert.equal(state.workflowRuns[0].status, "awaiting_approval");\nassert.deepEqual(Object.keys(run).sort(), ["last_tick", "ok", "ticks"]);\nassert(firstBaselineSnapshot, "baseline emitter must receive a snapshot without changing the run result");\nassert.equal(firstBaselineSnapshot.trace_id, "sequential-trace-1");\nassert.equal(firstBaselineSnapshot.request_id, "request-1");\nassert.equal(firstBaselineSnapshot.plan_id, "plan-1");\nassert.equal(firstBaselineSnapshot.entry_point, "sequential_plan");\nassert.equal(firstBaselineSnapshot.outcome, "awaiting_approval");\nassert.equal(firstBaselineSnapshot.counters.plan_steps, 3);\nassert.equal(firstBaselineSnapshot.counters.ready_set_width, 1);\nassert.equal(firstBaselineSnapshot.counters.critical_path_steps, 2);\nassert(firstBaselineSnapshot.coverage.stages.observed.includes("ledger"));\nassert(firstBaselineSnapshot.coverage.stages.unobserved.includes("provider_dispatch"));\nassert(firstBaselineSnapshot.coverage.counters.observed.includes("plan_steps"));\nassert(firstBaselineSnapshot.coverage.counters.unobserved.includes("provider_calls"));\nassert.equal(firstBaselineSnapshot.secrets_included, false);\nconst claimedEvent = state.events.find(({ params }) => params[4] === "step_claimed");`,
  "first sequential baseline assertions",
);
test = replaceExactlyOnce(
  test,
  `const resumed = await runSequentialPlan({\n  pool, planId: "plan-1",\n  executeStep: async (step) => ({ ok: true, step_key: step.step_key }),\n});\nassert.equal(resumed.last_tick.plan_status, "completed");\nassert.equal(state.steps[2].status, "completed");`,
  `let resumedBaselineSnapshot = null;\nconst resumed = await runSequentialPlan({\n  pool, planId: "plan-1",\n  executeStep: async (step) => ({ ok: true, step_key: step.step_key }),\n  baselineEmitter: (snapshot) => { resumedBaselineSnapshot = snapshot; },\n  baselineTraceInput: { trace_id: "sequential-trace-2" },\n});\nassert.equal(resumed.last_tick.plan_status, "completed");\nassert.equal(state.steps[2].status, "completed");\nassert(resumedBaselineSnapshot.coverage.stages.observed.includes("provider_dispatch"));\nassert.equal(resumedBaselineSnapshot.counters.plan_steps, 3);\nassert.equal(resumedBaselineSnapshot.counters.ready_set_width, 1);\nassert.equal(resumedBaselineSnapshot.counters.critical_path_steps, 1);\nassert.equal(resumedBaselineSnapshot.outcome, "success");\nassert.equal(resumedBaselineSnapshot.provider_call_made, null, "provider count remains explicitly unobserved");`,
  "resumed sequential baseline fixture",
);

fs.writeFileSync(telemetryPath, telemetry);
fs.writeFileSync(orchestratorPath, orchestrator);
fs.writeFileSync(testPath, test);
console.log("X0 sequential baseline integration applied");
