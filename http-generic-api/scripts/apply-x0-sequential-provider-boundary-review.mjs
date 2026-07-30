#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const runtimePath = path.join(apiRoot, "sequentialPlanOrchestrator.js");
const testPath = path.join(apiRoot, "test-sequential-plan-orchestrator.mjs");

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source block is not unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

let runtime = fs.readFileSync(runtimePath, "utf8");
runtime = replaceExactlyOnce(
  runtime,
  `    const [planRows] = await connection.query("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 1 FOR UPDATE", [planId]);
    const plan = planRows[0];
    if (!plan) throw validationError("Execution plan not found.", "sequential_plan_not_found");`,
  `    const [planRows] = await connection.query("SELECT * FROM execution_plans WHERE plan_id = ? LIMIT 2 FOR UPDATE", [planId]);
    const plan = resolveUniqueSequentialRow(planRows, {
      ambiguityCode: "sequential_plan_claim_identity_ambiguous",
      ambiguityMessage: "Execution plan claim identity resolved to multiple rows.",
    });
    if (!plan) throw validationError("Execution plan not found.", "sequential_plan_not_found");`,
  "claim plan uniqueness guard",
);

runtime = replaceExactlyOnce(
  runtime,
  `  executeStep = defaultStepExecutor,
  baselineTrace = null,
}) {`,
  `  executeStep = defaultStepExecutor,
  baselineTrace = null,
  observeProviderDispatch = false,
}) {`,
  "tick provider observation option",
);

runtime = replaceExactlyOnce(
  runtime,
  `  const finishDispatch = claim.step.step_type === "workflow"
    ? baselineTrace?.startStage?.("provider_dispatch")
    : null;`,
  `  const finishDispatch = observeProviderDispatch && claim.step.step_type === "workflow"
    ? baselineTrace?.startStage?.("provider_dispatch")
    : null;`,
  "provider stage boundary",
);

runtime = replaceExactlyOnce(
  runtime,
  `    result = await executeStep(claim.step, { pool, plan: claim.plan, actorId });`,
  `    result = await executeStep(claim.step, { pool, plan: claim.plan, actorId, baselineTrace });`,
  "custom executor trace context",
);

runtime = replaceExactlyOnce(
  runtime,
  `  baselineEmitter = null,
  baselineTraceInput = {},
}) {`,
  `  baselineEmitter = null,
  baselineTraceInput = {},
  baselineProviderDispatch = false,
}) {`,
  "run provider boundary option",
);

runtime = replaceExactlyOnce(
  runtime,
  `        executeStep: executor,
        baselineTrace,
      });`,
  `        executeStep: executor,
        baselineTrace,
        observeProviderDispatch: !executeStep || baselineProviderDispatch === true,
      });`,
  "tick provider boundary propagation",
);

let test = fs.readFileSync(testPath, "utf8");
test = replaceExactlyOnce(
  test,
  `  baselineEmitter: (snapshot) => { resumedBaselineSnapshot = snapshot; },
  baselineTraceInput: { trace_id: "sequential-trace-2" },`,
  `  baselineEmitter: (snapshot) => { resumedBaselineSnapshot = snapshot; },
  baselineTraceInput: { trace_id: "sequential-trace-2" },
  baselineProviderDispatch: true,`,
  "explicit custom provider boundary fixture",
);

test = replaceExactlyOnce(
  test,
  `assert.match(sequentialRuntime, /claim_token_sha256: sha256\(claimToken\)/);
assert.equal(sequentialRuntime.includes("evidence: { claim_token: claimToken }"), false, "raw claim token must never enter audit evidence");`,
  `assert.match(sequentialRuntime, /claim_token_sha256: sha256\(claimToken\)/);
assert.equal(sequentialRuntime.includes("evidence: { claim_token: claimToken }"), false, "raw claim token must never enter audit evidence");
assert.match(sequentialRuntime, /SELECT \\* FROM execution_plans WHERE plan_id = \\? LIMIT 2 FOR UPDATE/);
assert.doesNotMatch(sequentialRuntime, /const plan = planRows\\[0\\]/);
assert.match(sequentialRuntime, /observeProviderDispatch: !executeStep \\|\\| baselineProviderDispatch === true/);
assert.match(sequentialRuntime, /executeStep\\(claim\\.step, \\{ pool, plan: claim\\.plan, actorId, baselineTrace \\}\\)/);`,
  "reviewed provider and uniqueness source contracts",
);

fs.writeFileSync(runtimePath, runtime);
fs.writeFileSync(testPath, test);
console.log("X0 sequential provider boundary review applied");
