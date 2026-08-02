#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = "../.github/workflows/frontend-parity-refresh-dispatch.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /^name:\s*Frontend Parity Refresh Dispatch$/mu);
assert.match(workflow, /^\s*workflow_run:\s*$/mu);
assert.match(workflow, /Frontend surface dispatch/u);
assert.match(workflow, /types:\s*\n\s*- completed/u);
assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'failure'/u);
assert.match(workflow, /actions:\s*write/u);
assert.match(workflow, /contents:\s*read/u);
assert.match(workflow, /pull-requests:\s*read/u);
assert.doesNotMatch(workflow, /contents:\s*write/u);
assert.doesNotMatch(workflow, /\bgit\s+push\b/u);
assert.match(workflow, /frontend-dispatch-verification-evidence-\$\{\{ github\.event\.workflow_run\.id \}\}/u);
assert.match(workflow, /mad4b\.frontend-dispatch-verification-evidence\.v1/u);
assert.match(workflow, /committed_generated_parity/u);
assert.match(workflow, /identity\?\.candidate_sha/u);
assert.match(workflow, /identity\?\.source_head_sha/u);
assert.match(workflow, /generated-artifact-refresh/u);
assert.match(workflow, /governed-generated-artifact-refresh\.yml\/dispatches/u);
assert.match(workflow, /APPLY_GENERATED_ARTIFACT_REFRESH/u);
assert.match(workflow, /mad4b\.frontend-parity-refresh-dispatch\.v1/u);
assert.match(workflow, /source_of_truth:\s*'structured_report'/u);
assert.match(workflow, /job_logs_role:\s*'diagnostic_only'/u);
assert.match(workflow, /consult_job_logs:\s*false/u);
assert.match(workflow, /direct_repository_mutation:\s*false/u);
assert.match(workflow, /protected_branch_mutation:\s*false/u);
assert.match(workflow, /force_push:\s*false/u);
assert.match(workflow, /secrets_included:\s*false/u);

console.log(JSON.stringify({
  ok: true,
  gate: "frontend_parity_refresh_dispatch_workflow",
  contract: "mad4b.frontend-parity-refresh-dispatch.v1",
  cases: 26,
  source_of_truth: "structured_report",
  job_logs_authoritative: false,
  direct_repository_mutation: false,
  secrets_included: false,
}));
