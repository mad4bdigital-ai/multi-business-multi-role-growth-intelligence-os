import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REQUEST_WORKFLOW = path.resolve(
  HERE,
  "../.github/workflows/governed-generated-artifact-refresh-pr-target-v3.yml",
);
const DISPATCHER_WORKFLOW = path.resolve(
  HERE,
  "../.github/workflows/governed-generated-artifact-refresh-request-dispatcher-v3.yml",
);
const request = fs.readFileSync(REQUEST_WORKFLOW, "utf8");
const dispatcher = fs.readFileSync(DISPATCHER_WORKFLOW, "utf8");

assert.match(request, /^name: Governed Generated Artifact Refresh PR Target Request V3$/m);
assert.match(request, /^  pull_request_target:$/m);
assert.match(request, /types: \[labeled, synchronize, ready_for_review, reopened\]/);
assert.match(request, /^  workflow_dispatch:$/m);
assert.match(request, /^  contents: read$/m);
assert.match(request, /^  pull-requests: read$/m);
assert.doesNotMatch(request, /^  actions: write$/m);
assert.doesNotMatch(request, /^  contents: write$/m);
assert.doesNotMatch(request, /^  issues: write$/m);
assert.doesNotMatch(request, /actions\/checkout/);
assert.doesNotMatch(request, /actions\/workflows\/.*\/dispatches/);
assert.doesNotMatch(request, /git\s+push/);
assert.match(request, /generated-artifact-refresh-request-v3-\$\{\{ github\.run_id \}\}/);
assert.match(request, /workflow_dispatch_performed:false/);
assert.match(request, /candidate_code_checkout:false/);
assert.match(request, /repository_mutation_performed:false/);

assert.match(dispatcher, /^name: Governed Generated Artifact Refresh Request Dispatcher V3$/m);
assert.match(dispatcher, /^  workflow_run:$/m);
assert.match(dispatcher, /Governed Generated Artifact Refresh PR Target Request V3/);
assert.match(dispatcher, /^  workflow_dispatch:$/m);
assert.doesNotMatch(dispatcher, /^  pull_request:$/m);
assert.doesNotMatch(dispatcher, /^  pull_request_target:$/m);
assert.doesNotMatch(dispatcher, /^  issue_comment:$/m);
assert.doesNotMatch(dispatcher, /^  push:$/m);
assert.match(dispatcher, /^  actions: write$/m);
assert.match(dispatcher, /^  contents: read$/m);
assert.match(dispatcher, /^  pull-requests: read$/m);
assert.doesNotMatch(dispatcher, /^  contents: write$/m);
assert.doesNotMatch(dispatcher, /^  issues: write$/m);
assert.doesNotMatch(dispatcher, /actions\/checkout/);
assert.doesNotMatch(dispatcher, /git\s+push/);
assert.match(dispatcher, /request_source_run_mismatch/);
assert.match(dispatcher, /pull_request_head_mismatch/);
assert.match(dispatcher, /generated_artifact_refresh_label_absent/);
assert.match(dispatcher, /target_branch="\$\{target_ref\}"/);
assert.match(dispatcher, /"\$\{target_branch\}" == "main" \|\| "\$\{target_branch\}" == "Production"/);
assert.match(dispatcher, /protected_branch_mutation_forbidden/);
assert.match(
  dispatcher,
  /actions\/workflows\/governed-generated-artifact-refresh-dispatch-v2\.yml\/dispatches/,
);
assert.doesNotMatch(dispatcher, /actions\/workflows\/governed-generated-artifact-refresh\.yml\/dispatches/);
assert.match(dispatcher, /v2_workflow_run_not_observed/);
assert.match(dispatcher, /v2_run_observed:true/);
assert.match(dispatcher, /direct_repository_mutation:false/);
assert.match(dispatcher, /secrets_included:false/);

console.log("governed generated-artifact PR-target V3 two-stage contract passed");
