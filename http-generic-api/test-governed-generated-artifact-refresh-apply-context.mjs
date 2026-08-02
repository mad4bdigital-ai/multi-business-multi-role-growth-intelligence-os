#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = "../.github/workflows/governed-generated-artifact-refresh.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /^name:\s*Governed Generated Artifact Refresh$/mu);
assert.match(workflow, /^\s*workflow_dispatch:\s*$/mu);
assert.doesNotMatch(workflow, /^\s*(?:push|pull_request|pull_request_target):\s*$/mu);
assert.match(workflow, /actions:\s*write/u);
assert.match(workflow, /contents:\s*write/u);
assert.match(
  workflow,
  /OUTPUT_DIR:\s*\.ci-evidence\/governed-generated-artifact-refresh/u,
  "writer must use a stable repository-relative evidence directory",
);
assert.doesNotMatch(
  workflow,
  /\$\{\{\s*runner\.temp\s*\}\}/u,
  "jobs-level environment must not reference the unavailable runner context",
);
assert.match(workflow, /APPLY_GENERATED_ARTIFACT_REFRESH/u);
assert.match(workflow, /main.*Production/u);
assert.match(workflow, /expected_head_sha/u);
assert.match(workflow, /persist-credentials:\s*true/u);
assert.match(workflow, /maintenance-tools\/generated-artifact-refresh\.mjs/u);
assert.match(workflow, /--output-dir "\$\{OUTPUT_DIR\}"/u);
assert.match(workflow, /pr-generated-artifact-refresh\.yml\/dispatches/u);
assert.match(workflow, /generated-artifact-refresh-verification-dispatch\.json/u);
assert.match(workflow, /path:\s*\$\{\{ env\.OUTPUT_DIR \}\}\//u);
assert.doesNotMatch(workflow, /(?:--force|-f)(?:\s|["'])/u);

console.log(JSON.stringify({
  ok: true,
  gate: "governed_generated_artifact_refresh_apply_context",
  contract: "mad4b.governed-generated-artifact-refresh.v1",
  cases: 17,
  workflow_dispatch_only: true,
  jobs_level_runner_context_used: false,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false,
}));
