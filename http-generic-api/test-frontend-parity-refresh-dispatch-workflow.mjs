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
assert.match(workflow, /REPORT_DIR:\s*\.ci-evidence\/frontend-parity-refresh-dispatch/u);
assert.match(workflow, /SOURCE_DIR:\s*\.ci-evidence\/frontend-dispatch-source-evidence/u);
assert.doesNotMatch(workflow, /\$\{\{\s*runner\.temp\s*\}\}/u, "job-level env must not use unavailable runner context");
assert.match(workflow, /frontend-dispatch-verification-evidence-\$\{\{ github\.event\.workflow_run\.id \}\}/u);
assert.match(workflow, /EVENT_SOURCE_HEAD_SHA:\s*\$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
assert.doesNotMatch(workflow, /EVENT_CANDIDATE_SHA/u, "workflow_run.head_sha is the PR source head, not the synthetic merge candidate");
assert.match(workflow, /mad4b\.frontend-dispatch-verification-evidence\.v1/u);
assert.match(workflow, /committed_generated_parity/u);
assert.match(workflow, /source\.identity\?\.candidate_kind === 'merge_candidate'/u);
assert.match(workflow, /String\(source\.identity\?\.run_id\) === String\(process\.env\.SOURCE_RUN_ID\)/u);
assert.match(workflow, /fullSha\.test\(candidateSha\)/u);
assert.match(workflow, /fullSha\.test\(sourceHeadSha\)/u);
assert.match(workflow, /sourceHeadSha === process\.env\.EVENT_SOURCE_HEAD_SHA/u);
assert.match(workflow, /pr\.head\?\.repo\?\.full_name !== process\.env\.GITHUB_REPOSITORY/u);
assert.match(workflow, /pr\.head\?\.sha !== sourceHeadSha/u);
assert.match(workflow, /expected_head_sha:\s*sourceHeadSha/u);
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
  cases: 38,
  merge_candidate_identity_separate: true,
  workflow_run_head_binds_source_head: true,
  same_repository_required: true,
  source_of_truth: "structured_report",
  job_logs_authoritative: false,
  direct_repository_mutation: false,
  secrets_included: false,
}));
