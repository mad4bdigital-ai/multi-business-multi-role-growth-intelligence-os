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
  `import { createHash, randomUUID } from "node:crypto";`,
  `import { createHash, randomUUID } from "node:crypto";\nimport {\n  createGovernedExecutionBaselineTrace,\n  emitGovernedExecutionBaselineSnapshot,\n} from "./governedExecutionBaselineTelemetry.js";`,
  "orchestrator telemetry import",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `async function claimNextStep(pool, planId, actorId) {`,
  `async function claimNextStep(pool, planId, actorId, baselineTrace = null) {`,
  "claim signature",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `    const [steps] = await connection.query("SELECT * FROM execution_plan_steps WHERE plan_id = ? ORDER BY step_order FOR UPDATE", [planId]);\n    if (!steps.length) throw validationError("Plan has no compiled steps.", "sequential_plan_not_compiled");`,
  `    const [steps] = await connection.query("SELECT * FROM execution_plan_steps WHERE plan_id = ? ORDER BY step_order FOR UPDATE", [planId]);\n    if (!steps.length) throw validationError("Plan has no compiled steps.", "sequential_plan_not_compiled");\n    baselineTrace?.setCounter?.("plan_steps", steps.length);`,
  "plan step gauge",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `    const next = steps.find((step) => step.status === "ready");\n    if (!next) {`,
  `    const readySteps = steps.filter((step) => step.status === "ready");\n    baselineTrace?.maxCounter?.("ready_set_width", readySteps.length);\n    const next = readySteps[0];\n    if (!next) {`,
  "ready set gauge",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `export async function tickSequentialPlan({ pool, planId, actorId = null, executeStep = defaultStepExecutor }) {\n  const claim = await claimNextStep(pool, planId, actorId);`,
  `export async function tickSequentialPlan({\n  pool,\n  planId,\n  actorId = null,\n  executeStep = defaultStepExecutor,\n  baselineTrace = null,\n}) {\n  const finishClaimLedger = baselineTrace?.startStage?.("ledger");\n  let claim;\n  try {\n    claim = await claimNextStep(pool, planId, actorId, baselineTrace);\n  } finally {\n    finishClaimLedger?.();\n  }`,
  "tick claim instrumentation",
);
orchestrator = replaceExactlyOnce(
  orchestrator,
  `  let result;\n  let executionError = null;\n  try {\n    result = await executeStep(claim.step, { pool, plan: claim.plan, actorId });\n    const verification = verifySequentialStepResult(claim.step, result);\n    if (!verification.passed) {\n      executionError = validationError(\n        \`Sequential step verification failed: \${verification.failures.join(", ")}\`,\n        "sequential_step_verification_failed"\n      );\n    }\n  } catch (error) {\n    executionError = error;\n  }\n  const final = await finalizeClaim(pool, claim, result, executionError, actorId);`,
  `  const finishDispatch = claim.step.step_type === "workflow"\n    ? baselineTrace?.startStage?.("provider_dispatch")\n    : null;\n  let result;\n  let executionError = null;\n  try {\n    result = await executeStep(claim.step, { pool, plan: claim.plan, actorId });\n    const verification = verifySequentialStepResult(claim.step, result);\n    if (!verification.passed) {\n      executionError = validationError(\n        \`Sequential step verification failed: \${verification.failures.join(", ")}\`,\n        "sequential_step_verification_failed"\n      );\n    }\n  } catch (error) {\n    executionError = error;\n  } finally {\n    finishDispatch?.();\n  }\n  baselineTrace?.increment?.("critical_path_steps", 1);\n  const finishFinalizeLedger = baselineTrace?.startStage?.("ledger");\n  let final;\n  try {\n    final = await finalizeClaim(pool, claim, result, executionError, actorId);\n  } finally {\n    finishFinalizeLedger?.();\n  }`,
  "tick execution instrumentation",
);
const oldRun = `export async function runSequentialPlan({ pool, planId, actorId = null, maxTicks = 25, executeStep = defaultStepExecutor }) {\n  const ticks = [];\n  for (let index = 0; index < Math.max(1, Math.min(Number(maxTicks) || 25, 100)); index += 1) {\n    const tick = await tickSequentialPlan({ pool, planId, actorId, executeStep });\n    ticks.push(tick);\n    if (tick.stop || ["blocked", "failed", "completed", "awaiting_approval", "paused"].includes(tick.plan_status)) break;\n  }\n  const lastTick = ticks.at(-1);\n  const ok = !["blocked", "failed"].includes(lastTick?.plan_status);\n  return {\n    ok,\n    plan_id: planId,\n    tick_count: ticks.length,\n    recovered_failure_count: ok ? ticks.filter((tick) => tick.ok === false).length : 0,\n    last_tick: lastTick,\n    ticks,\n    secrets_included: false,\n  };\n}`;
const newRun = `export async function runSequentialPlan({\n  pool,\n  planId,\n  actorId = null,\n  maxTicks = 25,\n  executeStep = null,\n  baselineEmitter = null,\n  baselineTraceInput = {},\n}) {\n  const executor = executeStep || defaultStepExecutor;\n  const baselineTrace = typeof baselineEmitter === "function"\n    ? createGovernedExecutionBaselineTrace({\n        ...baselineTraceInput,\n        plan_id: planId,\n        entry_point: "sequential_plan",\n      })\n    : null;\n  if (baselineTrace && !executeStep) baselineTrace.observeCounter("internal_http_hops");\n\n  const ticks = [];\n  let finalOutcome = "running";\n  let resultClassification = "sequential_plan_running";\n  try {\n    for (let index = 0; index < Math.max(1, Math.min(Number(maxTicks) || 25, 100)); index += 1) {\n      const tick = await tickSequentialPlan({\n        pool,\n        planId,\n        actorId,\n        executeStep: executor,\n        baselineTrace,\n      });\n      ticks.push(tick);\n      if (tick.stop || ["blocked", "failed", "completed", "awaiting_approval", "paused"].includes(tick.plan_status)) break;\n    }\n    const lastTick = ticks.at(-1);\n    const ok = !["blocked", "failed"].includes(lastTick?.plan_status);\n    finalOutcome = lastTick?.plan_status === "completed"\n      ? "success"\n      : lastTick?.plan_status === "awaiting_approval"\n        ? "awaiting_approval"\n        : lastTick?.plan_status === "cancelled"\n          ? "cancelled"\n          : ["blocked", "failed"].includes(lastTick?.plan_status)\n            ? "failure"\n            : "running";\n    resultClassification = \`sequential_plan_\${lastTick?.reason || lastTick?.plan_status || "tick_budget_reached"}\`;\n    return {\n      ok,\n      plan_id: planId,\n      tick_count: ticks.length,\n      recovered_failure_count: ok ? ticks.filter((tick) => tick.ok === false).length : 0,\n      last_tick: lastTick,\n      ticks,\n      secrets_included: false,\n    };\n  } catch (error) {\n    finalOutcome = "failure";\n    resultClassification = String(error?.code || "sequential_plan_failed");\n    throw error;\n  } finally {\n    if (baselineTrace) {\n      const snapshot = baselineTrace.finalize({\n        outcome: finalOutcome,\n        result_classification: resultClassification,\n      });\n      void emitGovernedExecutionBaselineSnapshot(snapshot, baselineEmitter);\n    }\n  }\n}`;
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
  `assert.equal(state.workflowRuns[0].status, "awaiting_approval");\nassert.deepEqual(Object.keys(run).sort(), [\n  "last_tick", "ok", "plan_id", "recovered_failure_count", "secrets_included", "tick_count", "ticks",\n]);\nassert(firstBaselineSnapshot, "baseline emitter must receive a snapshot without changing the run result");\nassert.equal(firstBaselineSnapshot.trace_id, "sequential-trace-1");\nassert.equal(firstBaselineSnapshot.request_id, "request-1");\nassert.equal(firstBaselineSnapshot.plan_id, "plan-1");\nassert.equal(firstBaselineSnapshot.entry_point, "sequential_plan");\nassert.equal(firstBaselineSnapshot.outcome, "awaiting_approval");\nassert.equal(firstBaselineSnapshot.counters.plan_steps, 3);\nassert.equal(firstBaselineSnapshot.counters.ready_set_width, 1);\nassert.equal(firstBaselineSnapshot.counters.critical_path_steps, 2);\nassert(firstBaselineSnapshot.coverage.stages.observed.includes("ledger"));\nassert(firstBaselineSnapshot.coverage.stages.unobserved.includes("provider_dispatch"));\nassert(firstBaselineSnapshot.coverage.counters.observed.includes("plan_steps"));\nassert(firstBaselineSnapshot.coverage.counters.unobserved.includes("provider_calls"));\nassert.equal(firstBaselineSnapshot.provider_call_made, null);\nassert.equal(firstBaselineSnapshot.secrets_included, false);\nconst claimedEvent = state.events.find(({ params }) => params[4] === "step_claimed");`,
  "first sequential baseline assertions",
);
test = replaceExactlyOnce(
  test,
  `const resumed = await runSequentialPlan({\n  pool, planId: "plan-1",\n  executeStep: async (step) => ({ ok: true, step_key: step.step_key }),\n});\nassert.equal(resumed.last_tick.plan_status, "completed");\nassert.equal(state.steps[2].status, "completed");`,
  `let resumedBaselineSnapshot = null;\nconst resumed = await runSequentialPlan({\n  pool, planId: "plan-1",\n  executeStep: async (step) => ({ ok: true, step_key: step.step_key }),\n  baselineEmitter: (snapshot) => { resumedBaselineSnapshot = snapshot; },\n  baselineTraceInput: { trace_id: "sequential-trace-2" },\n});\nassert.equal(resumed.last_tick.plan_status, "completed");\nassert.equal(state.steps[2].status, "completed");\nassert(resumedBaselineSnapshot.coverage.stages.observed.includes("provider_dispatch"));\nassert(resumedBaselineSnapshot.coverage.stages.observed.includes("ledger"));\nassert.equal(resumedBaselineSnapshot.counters.plan_steps, 3);\nassert.equal(resumedBaselineSnapshot.counters.ready_set_width, 1);\nassert.equal(resumedBaselineSnapshot.counters.critical_path_steps, 1);\nassert.equal(resumedBaselineSnapshot.outcome, "success");\nassert.equal(resumedBaselineSnapshot.provider_call_made, null, "provider count remains explicitly unobserved");`,
  "resumed sequential baseline fixture",
);

fs.writeFileSync(telemetryPath, telemetry);
fs.writeFileSync(orchestratorPath, orchestrator);
fs.writeFileSync(testPath, test);
console.log("X0 sequential baseline integration applied");
