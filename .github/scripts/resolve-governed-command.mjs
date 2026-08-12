#!/usr/bin/env node
import fs from "node:fs";
import { loadRegistry, resolveCommandPlan } from "./governed-command-core.mjs";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

try {
  const parameters = JSON.parse(requiredEnv("PARAMETERS_JSON"));
  const plan = resolveCommandPlan({
    registry: loadRegistry(),
    command: requiredEnv("COMMAND"),
    parameters,
    authorization: requiredEnv("AUTHORIZATION"),
    expectedHeadSha: requiredEnv("EXPECTED_HEAD_SHA"),
    currentHeadSha: requiredEnv("CURRENT_HEAD_SHA"),
    currentRef: requiredEnv("CURRENT_REF"),
  });

  const outputPath = requiredEnv("OUTPUT_PATH");
  fs.writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    outcome: "resolved",
    command: plan.command,
    adapter: plan.adapter,
    authority: plan.authority,
    target_workflow: plan.target_workflow,
    target_ref: plan.target_ref,
  }));
} catch (error) {
  console.error(`Governed command resolution failed: ${error.message}`);
  process.exit(1);
}
