#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = "../.github/workflows/governed-generated-artifact-refresh-pr-target-bridge-v2.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(
  workflow,
  /reason:\(\$reason \| select\(length > 0\) \/\/ null\)/u,
  "eligible generated-artifact refresh requests must serialize a nullable reason instead of producing empty output",
);

assert.doesNotMatch(
  workflow,
  /reason:\(\$reason\|select\(length>0\)\)/u,
  "the unsafe jq select-only reason field can suppress the entire request object when reason is empty",
);

assert.match(
  workflow,
  /JSON\.parse\(fs\.readFileSync\(`\$\{process\.env\.REPORT_DIR\}\/request\.json`, 'utf8'\)\)/u,
  "the serialized request remains consumed as structured JSON by the workflow",
);

console.log(JSON.stringify({
  ok: true,
  gate: "governed_generated_artifact_refresh_request_serialization",
  eligible_reason_serialization: "nullable",
  empty_request_output_prevented: true,
  repository_mutation_added_by_test: false,
  secrets_included: false,
}));
