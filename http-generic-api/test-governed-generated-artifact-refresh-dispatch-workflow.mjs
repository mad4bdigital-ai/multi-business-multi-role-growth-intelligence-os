#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = "../.github/workflows/governed-generated-artifact-refresh-dispatch-v2.yml";
const retiredWorkflowPath = "../.github/workflows/governed-generated-artifact-refresh-dispatch.yml";
assert.equal(fs.existsSync(retiredWorkflowPath), false, "retired dispatcher path must remain absent");
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /^name:\s*Governed Generated Artifact Refresh Dispatch V2$/mu);
assert.doesNotMatch(workflow, /^\s*push:\s*$/mu, "dispatcher must not run from work-branch pushes");
assert.match(workflow, /^\s*issue_comment:\s*$/mu, "dispatcher must expose a trusted comment command from main");
assert.match(workflow, /types:\s*\[created\]/u, "comment dispatcher must use newly created comments only");
assert.match(workflow, /^\s*workflow_dispatch:\s*$/mu, "dispatcher must retain an explicit dispatch surface");
assert.match(workflow, /actions:\s*write/u, "dispatcher requires Actions dispatch authority");
assert.match(workflow, /contents:\s*read/u, "dispatcher must keep repository contents read-only");
assert.match(workflow, /issues:\s*write/u, "trusted dispatcher must publish its canonical PR evidence directly");
assert.match(workflow, /pull-requests:\s*read/u, "dispatcher must resolve the associated pull request");
assert.doesNotMatch(workflow, /contents:\s*write/u, "dispatcher must not receive direct contents-write authority");
assert.doesNotMatch(workflow, /\bgit\s+push\b/u, "dispatcher must not push repository contents directly");
assert.match(workflow, /uses:\s*actions\/checkout@v5/u, "trusted command workflow must checkout publisher code");
assert.match(workflow, /ref:\s*main/u, "publisher code must be loaded from trusted main");
assert.match(workflow, /persist-credentials:\s*false/u, "trusted checkout must not persist credentials");
assert.doesNotMatch(workflow, /pull_request(?:_target)?:/u, "write-capable dispatcher must not be a pull-request workflow");
assert.match(workflow, /github\.event\.issue\.pull_request/u, "comment command must be limited to pull-request conversations");
assert.match(workflow, /OWNER.*MEMBER.*COLLABORATOR/u, "comment command must require a trusted author association");
assert.match(workflow, /\/refresh-generated-artifacts/u, "dispatcher must require the explicit typed comment command");
assert.match(workflow, /\[0-9a-f\]\{40\}/u, "typed comment command must bind one exact lowercase SHA");
assert.match(workflow, /head\.repo\.full_name/u, "runtime readback must bind the same repository");
assert.match(workflow, /generated-artifact-refresh/u, "dispatch must still require the explicit PR label");
assert.match(workflow, /APPLY_GENERATED_ARTIFACT_REFRESH/u, "delegated workflow must receive typed confirmation");
assert.match(workflow, /expected_head_sha/u, "delegated workflow must receive an exact expected head SHA");
assert.match(workflow, /main.*Production/u, "dispatcher must reject protected branches before API dispatch");
assert.match(workflow, /governed-generated-artifact-refresh\.yml\/dispatches/u, "dispatcher must target the registered mutating workflow");
assert.match(workflow, /workflow_state="\$\(gh api[\s\S]*governed-generated-artifact-refresh\.yml[\s\S]*--jq '\.state'\)"/u, "dispatcher must read the writer workflow state before dispatch");
assert.match(workflow, /governed-generated-artifact-refresh\.yml\/enable/u, "dispatcher must reactivate the registered writer when it is disabled");
assert.match(workflow, /delegated_workflow_not_active/u, "writer activation failure must block dispatch");
assert.match(workflow, /actions\/workflows\/governed-generated-artifact-refresh\.yml\/runs\?event=workflow_dispatch&branch=main/u, "dispatcher must observe the delegated workflow through the workflow-scoped runs API");
assert.match(workflow, /dispatch_started_at/u, "delegated run observation must be bounded to runs created after the request");
assert.match(workflow, /for attempt in \$\(seq 1 12\)/u, "delegated run observation must use a bounded retry window");
assert.match(workflow, /delegated_workflow_run_not_observed/u, "HTTP 204 without an observable writer run must fail closed");
assert.match(workflow, /delegated_run_observed:true/u, "passed evidence must require an observed delegated run");
assert.match(workflow, /delegated_run_id:\$delegated_run_id/u, "canonical evidence must publish the delegated run ID");
assert.match(workflow, /mad4b\.governed-generated-artifact-refresh-dispatch\.v1/u, "dispatcher must emit its canonical evidence contract");
assert.match(workflow, /Upload canonical dispatch evidence/u, "dispatcher must upload the structured decision before enforcement");
assert.match(workflow, /Publish canonical dispatch evidence directly/u, "trusted dispatcher must publish the exact decision directly");
assert.match(workflow, /generated-artifact-refresh-dispatch-pr-publisher\.mjs/u, "dispatcher must use the registered bounded publisher");
assert.match(workflow, /source_of_truth:\s*"structured_report"/u);
assert.match(workflow, /job_logs_role:\s*"diagnostic_only"/u);
assert.match(workflow, /consult_job_logs:\s*false/u);
assert.match(workflow, /secrets_included:\s*false/u);
assert.match(workflow, /github\.actor != 'github-actions\[bot\]'/u, "bot-authored activity must not recursively dispatch");
assert.match(workflow, /workflow_conclusion="failure"/u, "blocked evidence must be published as a failed decision");
assert.match(workflow, /workflow_conclusion="success"/u, "passed or skipped evidence must be published as a successful decision");

console.log(JSON.stringify({
  ok: true,
  tests: 46,
  gate: "governed_generated_artifact_refresh_dispatch_workflow",
  contract: "mad4b.governed-generated-artifact-refresh-dispatch.v1",
  unique_workflow_identity: "Governed Generated Artifact Refresh Dispatch V2",
  trusted_comment_command: true,
  trusted_main_checkout: true,
  direct_canonical_publication: true,
  delegated_run_observation: true,
  http_204_is_not_sufficient: true,
  stale_workflow_path_retired: true,
  push_trigger: false,
  pull_request_write_workflow: false,
  direct_contents_write: false,
  force_push: false,
  secrets_included: false,
}));