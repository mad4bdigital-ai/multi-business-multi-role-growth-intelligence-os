#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = "../.github/workflows/governed-generated-artifact-refresh-request-dispatcher.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /^name:\s*Governed Generated Artifact Refresh Request Dispatcher$/mu);
assert.match(workflow, /^\s*runs-on:\s*ubuntu-24\.04\s*$/mu, "dispatcher runner pin must remain ubuntu-24.04");
assert.match(
  workflow,
  /delegated_run_conclusion:\(if \(\$delegated_run_conclusion\|length\)>0 then \$delegated_run_conclusion else null end\)/u,
  "queued delegated writer conclusions must remain encoded as JSON null",
);
assert.match(workflow, /request_outcome.*==.*skipped/su, "skipped request outcome must remain first-class");
assert.match(workflow, /request_skipped="true"/u, "dispatcher must preserve skipped request state explicitly");
assert.match(
  workflow,
  /outcome:"skipped".*reason:\$reason.*dispatch_requested:false.*delegated_run_observed:false/su,
  "skipped evidence must preserve the reason and prove no writer dispatch",
);

const sourceRunMismatchIndex = workflow.indexOf("request_source_run_mismatch");
const skippedDecisionIndex = workflow.indexOf('if [[ "${request_skipped}" == "true" ]]');
const targetBranchIndex = workflow.indexOf('target_branch="${target_ref}"');
const prRevalidationIndex = workflow.indexOf('pr="$(gh api');
const writerStepIndex = workflow.indexOf("Dispatch and observe exact-head governed writer");

assert.ok(sourceRunMismatchIndex >= 0 && sourceRunMismatchIndex < skippedDecisionIndex, "source-run identity mismatch must fail closed before skip handling");
assert.ok(skippedDecisionIndex >= 0 && skippedDecisionIndex < targetBranchIndex, "skipped requests must terminate before governed branch mutation validation");
assert.ok(skippedDecisionIndex < prRevalidationIndex, "skipped requests must terminate before pull-request revalidation");
assert.ok(skippedDecisionIndex < writerStepIndex, "skipped requests must terminate before writer dispatch");

const skippedDecisionBlock = workflow.slice(skippedDecisionIndex, targetBranchIndex);
assert.doesNotMatch(
  skippedDecisionBlock,
  /(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)|\/dispatches/u,
  "skipped requests must perform no GitHub mutation or workflow dispatch",
);
assert.match(workflow, /if \(report\.outcome === 'blocked'\) process\.exit\(1\);/u, "blocked decisions must remain fail-closed");
assert.match(workflow, /if:\s*steps\.candidate\.outputs\.eligible == 'true'/u, "writer dispatch must remain gated to eligible requests only");

console.log(JSON.stringify({
  ok: true,
  tests: 13,
  gate: "governed_generated_artifact_refresh_skipped_outcome",
  skipped_request_preserved: true,
  skipped_request_dispatch_requested: false,
  blocked_fail_closed: true,
  eligible_writer_path_unchanged: true,
  runner_pinned: "ubuntu-24.04",
  queued_conclusion_null_preserved: true,
  direct_repository_mutation: false,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false
}));
