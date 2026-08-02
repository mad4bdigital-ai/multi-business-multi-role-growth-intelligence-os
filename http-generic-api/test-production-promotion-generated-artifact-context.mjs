#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = "../.github/workflows/production-promotion-generated-artifact-evidence.yml";
const workflow = readFileSync(workflowPath, "utf8");

assert.match(workflow, /^name: Protected Promotion Generated Artifact Refresh$/mu);
assert.match(workflow, /pull_request:[\s\S]*types: \[opened, synchronize, reopened\][\s\S]*branches:[\s\S]*- Production/u);
assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
assert.match(workflow, /persist-credentials: false/u);
assert.doesNotMatch(workflow, /contents: write/u);
assert.doesNotMatch(workflow, /workflow_dispatch:/u);
assert.doesNotMatch(workflow, /git push/u);
assert.doesNotMatch(
  workflow,
  /\$\{\{\s*runner\.temp\s*\}\}/u,
  "jobs-level env must not use the unavailable runner context",
);
assert.match(
  workflow,
  /REPORT_PATH: \$\{\{ github\.workspace \}\}\/\.ci-evidence\/production-promotion-generated-artifact\/pr-generated-artifact-refresh-summary\.json/u,
  "the JSON evidence path must use the jobs-level-compatible github.workspace context",
);
assert.match(
  workflow,
  /REPORT_MARKDOWN_PATH: \$\{\{ github\.workspace \}\}\/\.ci-evidence\/production-promotion-generated-artifact\/pr-generated-artifact-refresh-summary\.md/u,
  "the Markdown evidence path must share the same stable workspace directory",
);
assert.match(
  workflow,
  /pr-generated-artifact-refresh-\$\{\{ github\.run_id \}\}-summary/u,
);
assert.match(workflow, /mad4b\.pr-generated-artifact-refresh-summary\.v1/u);
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u);
assert.match(workflow, /PR_BASE_REF[\s\S]*Production/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.production-promotion-generated-artifact-context.v1",
  workflow: "Protected Promotion Generated Artifact Refresh",
  jobs_level_runner_context_used: false,
  workspace_context_used: true,
  repository_mutation_performed: false,
  secrets_included: false,
}, null, 2));
