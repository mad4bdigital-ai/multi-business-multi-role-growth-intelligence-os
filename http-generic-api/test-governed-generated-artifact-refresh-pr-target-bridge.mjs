#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const requestWorkflowPath = "../.github/workflows/governed-generated-artifact-refresh-pr-target-bridge-v2.yml";
const retiredRequestWorkflowPath = "../.github/workflows/governed-generated-artifact-refresh-pr-target-bridge.yml";
const dispatcherWorkflowPath = "../.github/workflows/governed-generated-artifact-refresh-request-dispatcher.yml";
const requestWorkflow = fs.readFileSync(requestWorkflowPath, "utf8");
const dispatcherWorkflow = fs.readFileSync(dispatcherWorkflowPath, "utf8");

assert.equal(fs.existsSync(retiredRequestWorkflowPath), false, "retired request bridge path must remain absent");
assert.match(requestWorkflow, /^name:\s*Governed Generated Artifact Refresh PR Target Request$/mu);
assert.match(requestWorkflow, /^\s*pull_request_target:\s*$/mu, "request evaluator must execute from trusted default-branch workflow code");
assert.match(requestWorkflow, /types:\s*\[synchronize\]/u, "automatic request evaluation must be limited to PR head synchronization");
assert.match(requestWorkflow, /^\s*workflow_dispatch:\s*$/mu, "request evaluator must retain an explicit exact-head input surface");
assert.doesNotMatch(requestWorkflow, /^\s*push:\s*$/mu, "request evaluator must not run from arbitrary branch pushes");
assert.doesNotMatch(requestWorkflow, /^\s*issue_comment:\s*$/mu, "request evaluator must not depend on connector-authored comments");
assert.match(requestWorkflow, /contents:\s*read/u);
assert.match(requestWorkflow, /pull-requests:\s*read/u);
assert.doesNotMatch(requestWorkflow, /actions:\s*write/u, "pull-request request evaluator must not dispatch workflows");
assert.doesNotMatch(requestWorkflow, /issues:\s*write/u, "pull-request request evaluator must not publish comments");
assert.doesNotMatch(requestWorkflow, /contents:\s*write/u, "pull-request request evaluator must not write repository contents");
assert.doesNotMatch(requestWorkflow, /permissions:\s*write-all/u);
assert.doesNotMatch(requestWorkflow, /uses:\s*actions\/checkout/u, "request evaluator must not checkout candidate or repository code");
assert.doesNotMatch(requestWorkflow, /(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)/u, "request evaluator must perform no API mutation");
assert.doesNotMatch(requestWorkflow, /\bgit\s+push\b/u);
assert.doesNotMatch(requestWorkflow, /secrets\./u);
assert.match(requestWorkflow, /github\.actor != 'github-actions\[bot\]'/u, "writer-generated synchronizations must not recurse");
assert.match(requestWorkflow, /head\.repo\.full_name/u, "same-repository identity must be read from the API");
assert.match(requestWorkflow, /generated-artifact-refresh/u, "explicit refresh label must remain mandatory");
assert.match(requestWorkflow, /current_head_sha/u, "request must record the current API head");
assert.match(requestWorkflow, /EXPECTED_HEAD_SHA/u, "request must bind the exact event or manual SHA");
assert.match(requestWorkflow, /protected_branch_mutation_forbidden/u);
assert.match(requestWorkflow, /cross_repository_pull_request_forbidden/u);
assert.match(requestWorkflow, /pull_request_is_draft/u);
assert.match(requestWorkflow, /mad4b\.governed-generated-artifact-refresh-request\.v1/u);
assert.match(requestWorkflow, /candidate_code_checkout:false/u);
assert.match(requestWorkflow, /repository_mutation_performed:false/u);
assert.match(requestWorkflow, /source_of_truth:\s*"structured_report"/u);
assert.match(requestWorkflow, /job_logs_role:\s*"diagnostic_only"/u);
assert.match(requestWorkflow, /consult_job_logs:\s*false/u);
assert.match(requestWorkflow, /secrets_included:\s*false/u);
assert.match(requestWorkflow, /Upload exact-head refresh request/u);

const requestInvalidBranchIndex = requestWorkflow.indexOf("invalid_governed_work_branch");
const requestProtectedBranchIndex = requestWorkflow.indexOf("protected_branch_mutation_forbidden");
const requestHeadMismatchIndex = requestWorkflow.indexOf("pull_request_head_mismatch");
const requestLabelSkipIndex = requestWorkflow.indexOf("generated_artifact_refresh_label_absent");
assert.ok(
  requestInvalidBranchIndex >= 0 && requestInvalidBranchIndex < requestLabelSkipIndex,
  "invalid governed branches must fail closed before label-based skip",
);
assert.ok(
  requestProtectedBranchIndex >= 0 && requestProtectedBranchIndex < requestLabelSkipIndex,
  "protected branches must fail closed before label-based skip",
);
assert.ok(
  requestHeadMismatchIndex >= 0 && requestHeadMismatchIndex < requestLabelSkipIndex,
  "stale request heads must fail closed before label-based skip",
);

assert.match(dispatcherWorkflow, /^name:\s*Governed Generated Artifact Refresh Request Dispatcher$/mu);
assert.match(dispatcherWorkflow, /^\s*workflow_run:\s*$/mu, "trusted dispatcher must consume the completed read-only request workflow");
assert.match(dispatcherWorkflow, /Governed Generated Artifact Refresh PR Target Request/u);
assert.match(dispatcherWorkflow, /^\s*workflow_dispatch:\s*$/mu, "mutating API dispatch must remain explicitly invokable");
assert.doesNotMatch(dispatcherWorkflow, /^\s*pull_request(?:_target)?:\s*$/mu, "write-capable dispatcher must not be a pull-request workflow");
assert.doesNotMatch(dispatcherWorkflow, /^\s*push:\s*$/mu);
assert.doesNotMatch(dispatcherWorkflow, /^\s*issue_comment:\s*$/mu);
assert.match(dispatcherWorkflow, /actions:\s*write/u);
assert.match(dispatcherWorkflow, /contents:\s*read/u);
assert.match(dispatcherWorkflow, /issues:\s*write/u);
assert.match(dispatcherWorkflow, /pull-requests:\s*read/u);
assert.doesNotMatch(dispatcherWorkflow, /contents:\s*write/u, "dispatcher delegates mutation but never writes repository contents directly");
assert.match(dispatcherWorkflow, /Resolve and revalidate exact-head request before checkout or dispatch/u);
assert.match(dispatcherWorkflow, /gh run download/u, "workflow-run path must consume the exact run-bound request artifact");
assert.match(dispatcherWorkflow, /request_source_run_mismatch/u, "artifact source run substitution must fail closed");
assert.match(dispatcherWorkflow, /request_outcome.*==.*skipped/su, "a read-only skipped request must remain a first-class dispatcher decision");
assert.match(dispatcherWorkflow, /request_skipped="true"/u, "the dispatcher must preserve skipped request state explicitly");
assert.match(dispatcherWorkflow, /outcome:"skipped".*reason:\$reason.*dispatch_requested:false.*delegated_run_observed:false/su, "skipped evidence must preserve the reason and prove no writer dispatch");
assert.match(dispatcherWorkflow, /target_branch="\$\{target_ref\}"/u);
assert.match(dispatcherWorkflow, /target_branch.*main.*Production/su, "protected branches must be rejected before API mutation");
assert.match(dispatcherWorkflow, /current_head_sha/u);
assert.match(dispatcherWorkflow, /expected_head_sha/u);
assert.match(dispatcherWorkflow, /current_head_sha.*!=.*expected_head_sha/su, "current PR head must equal the explicit expected head before dispatch");
assert.match(dispatcherWorkflow, /cross_repository_pull_request_forbidden/u);
assert.match(dispatcherWorkflow, /pull_request_branch_mismatch/u);
assert.match(dispatcherWorkflow, /generated_artifact_refresh_label_absent/u);
assert.match(dispatcherWorkflow, /APPLY_GENERATED_ARTIFACT_REFRESH/u);
assert.match(dispatcherWorkflow, /governed-generated-artifact-refresh\.yml\/dispatches/u, "dispatcher must delegate only to the registered writer");
assert.match(dispatcherWorkflow, /display_title == \$title/u, "run observation must bind the exact writer run title");
assert.match(dispatcherWorkflow, /for attempt in \$\(seq 1 20\)/u, "writer observation must remain bounded");
assert.match(dispatcherWorkflow, /delegated_workflow_run_not_observed/u);
assert.match(dispatcherWorkflow, /delegated_run_observed:true/u);
assert.match(dispatcherWorkflow, /delegated_run_id:\$delegated_run_id/u);
assert.match(dispatcherWorkflow, /uses:\s*actions\/checkout@v5/u);
assert.match(dispatcherWorkflow, /ref:\s*main/u, "publisher code must be loaded from trusted main only");
assert.match(dispatcherWorkflow, /persist-credentials:\s*false/u);
assert.doesNotMatch(dispatcherWorkflow, /github\.event\.pull_request\.head/u, "dispatcher must not checkout or trust pull-request event code");
assert.doesNotMatch(dispatcherWorkflow, /\bgit\s+push\b/u);
assert.doesNotMatch(dispatcherWorkflow, /secrets\./u);
assert.match(dispatcherWorkflow, /mad4b\.governed-generated-artifact-refresh-dispatch\.v1/u);
assert.match(dispatcherWorkflow, /generated-artifact-refresh-dispatch-pr-publisher\.mjs/u);
assert.match(dispatcherWorkflow, /source_of_truth:\s*"structured_report"/u);
assert.match(dispatcherWorkflow, /job_logs_role:\s*"diagnostic_only"/u);
assert.match(dispatcherWorkflow, /consult_job_logs:\s*false/u);
assert.match(dispatcherWorkflow, /direct_repository_mutation:\s*false/u);
assert.match(dispatcherWorkflow, /protected_branch_mutation:\s*false/u);
assert.match(dispatcherWorkflow, /force_push:\s*false/u);
assert.match(dispatcherWorkflow, /secrets_included:\s*false/u);
assert.match(dispatcherWorkflow, /cancel-in-progress:\s*false/u);

const validationIndex = dispatcherWorkflow.indexOf("Resolve and revalidate exact-head request before checkout or dispatch");
const skippedDecisionIndex = dispatcherWorkflow.indexOf('if [[ "${request_skipped}" == "true" ]]');
const prRevalidationIndex = dispatcherWorkflow.indexOf('pr="$(gh api');
const dispatchIndex = dispatcherWorkflow.indexOf("Dispatch and observe exact-head governed writer");
const checkoutIndex = dispatcherWorkflow.indexOf("Checkout trusted default branch publisher");
assert.ok(validationIndex >= 0 && validationIndex < dispatchIndex, "exact-head validation must precede writer dispatch");
assert.ok(validationIndex >= 0 && validationIndex < checkoutIndex, "exact-head and protected-branch validation must precede checkout");
assert.ok(skippedDecisionIndex >= 0 && skippedDecisionIndex < prRevalidationIndex, "skipped requests must terminate before PR revalidation");
assert.ok(skippedDecisionIndex < dispatchIndex, "skipped requests must terminate before writer dispatch");

const skippedDecisionBlock = dispatcherWorkflow.slice(skippedDecisionIndex, dispatcherWorkflow.indexOf('target_branch="${target_ref}"'));
assert.doesNotMatch(skippedDecisionBlock, /(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)|\/dispatches/u, "skipped requests must perform no GitHub mutation or workflow dispatch");

console.log(JSON.stringify({
  ok: true,
  tests: 91,
  gate: "governed_generated_artifact_refresh_pr_target_bridge",
  request_contract: "mad4b.governed-generated-artifact-refresh-request.v1",
  dispatch_contract: "mad4b.governed-generated-artifact-refresh-dispatch.v1",
  request_workflow_reregistered: true,
  retired_request_workflow_absent: true,
  pull_request_stage_read_only: true,
  trusted_workflow_run_dispatcher: true,
  skipped_request_preserved: true,
  skipped_request_dispatch_requested: false,
  candidate_checkout: false,
  same_repository_only: true,
  exact_head_bound: true,
  protected_branch_mutation: false,
  direct_contents_write: false,
  force_push: false,
  secrets_included: false,
}));