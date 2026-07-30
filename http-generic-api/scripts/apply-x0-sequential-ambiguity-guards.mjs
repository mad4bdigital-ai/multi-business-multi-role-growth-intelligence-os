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
  `function validationError(message, code = "sequential_plan_validation_failed") {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}`,
  `function validationError(message, code = "sequential_plan_validation_failed") {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

export function resolveUniqueSequentialRow(rows, {
  ambiguityCode = "sequential_row_ambiguous",
  ambiguityMessage = "Sequential runtime identity resolved to multiple rows.",
} = {}) {
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    const error = validationError(ambiguityMessage, ambiguityCode);
    error.status = 409;
    throw error;
  }
  return candidates.slice().pop();
}`,
  "unique-row helper",
);

runtime = replaceExactlyOnce(
  runtime,
  `    const [planRows] = await connection.query("SELECT plan_id, tenant_id, plan_status, runtime_status FROM execution_plans WHERE plan_id = ? LIMIT 1 FOR UPDATE", [planId]);
    const plan = planRows[0];
    if (!plan || plan.tenant_id !== tenantId) throw validationError("Execution plan not found for tenant.", "sequential_plan_not_found");`,
  `    const [planRows] = await connection.query("SELECT plan_id, tenant_id, plan_status, runtime_status FROM execution_plans WHERE plan_id = ? LIMIT 2 FOR UPDATE", [planId]);
    const plan = resolveUniqueSequentialRow(planRows, {
      ambiguityCode: "sequential_plan_identity_ambiguous",
      ambiguityMessage: "Execution plan identity resolved to multiple rows.",
    });
    if (!plan || plan.tenant_id !== tenantId) throw validationError("Execution plan not found for tenant.", "sequential_plan_not_found");`,
  "compiled plan uniqueness guard",
);

runtime = replaceExactlyOnce(
  runtime,
  `    const [rows] = await connection.query(
      "SELECT * FROM execution_plan_steps WHERE plan_step_id = ? AND claim_token = ? LIMIT 1 FOR UPDATE",
      [claim.step.plan_step_id, claim.claim_token]
    );
    const step = rows[0];
    if (!step) throw validationError("Plan step claim was lost.", "sequential_step_claim_lost");`,
  `    const [rows] = await connection.query(
      "SELECT * FROM execution_plan_steps WHERE plan_step_id = ? AND claim_token = ? LIMIT 2 FOR UPDATE",
      [claim.step.plan_step_id, claim.claim_token]
    );
    const step = resolveUniqueSequentialRow(rows, {
      ambiguityCode: "sequential_step_claim_ambiguous",
      ambiguityMessage: "Plan step claim resolved to multiple rows.",
    });
    if (!step) throw validationError("Plan step claim was lost.", "sequential_step_claim_lost");`,
  "claimed step uniqueness guard",
);

let test = fs.readFileSync(testPath, "utf8");
test = replaceExactlyOnce(
  test,
  `  persistCompiledSequentialPlan,
  runSequentialPlan,
  tickSequentialPlan,`,
  `  persistCompiledSequentialPlan,
  resolveUniqueSequentialRow,
  runSequentialPlan,
  tickSequentialPlan,`,
  "test helper import",
);

test = replaceExactlyOnce(
  test,
  `assert.deepEqual(
  verifySequentialStepResult({ success_criteria: { result_ok: true, required_output_fields: ["output.id"] } }, { ok: true, output: {} }).failures,
  ["missing_output_field:output.id"]
);`,
  `assert.deepEqual(
  verifySequentialStepResult({ success_criteria: { result_ok: true, required_output_fields: ["output.id"] } }, { ok: true, output: {} }).failures,
  ["missing_output_field:output.id"]
);
assert.equal(resolveUniqueSequentialRow([]), null);
const uniqueSequentialRow = { id: "single" };
assert.equal(resolveUniqueSequentialRow([uniqueSequentialRow]), uniqueSequentialRow);
assert.throws(
  () => resolveUniqueSequentialRow([{}, {}], {
    ambiguityCode: "sequential_test_identity_ambiguous",
    ambiguityMessage: "Test identity is ambiguous.",
  }),
  (error) => error?.code === "sequential_test_identity_ambiguous" && error?.status === 409,
);`,
  "unique-row regression assertions",
);

fs.writeFileSync(runtimePath, runtime);
fs.writeFileSync(testPath, test);
console.log("X0 sequential ambiguity guards applied");
