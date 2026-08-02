#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = "../.github/workflows/governed-generated-artifact-refresh-pr-target-bridge.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /^name:\s*Governed Generated Artifact Refresh PR Target Bridge$/mu);
assert.match(workflow, /^\s*pull_request_target:\s*$/mu, "bridge must execute from trusted default-branch workflow code");
assert.match(workflow, /types:\s*\[synchronize\]/u, "automatic bridge must be limited to PR head synchronization");
assert.match(workflow, /^\s*workflow_dispatch:\s*$/mu, "bridge must retain an explicit manual exact-head entrypoint");
assert.doesNotMatch(workflow, /^\s*push:\s*$/mu, "bridge must not run from arbitrary branch pushes");
assert.doesNotMatch(workflow, /^\s*issue_comment:\s*$/mu, "bridge must not depend on suppressed issue-comment delivery");
assert.match(workflow, /actions:\s*write/u, "bridge needs Actions dispatch authority");
assert.match(workflow, /contents:\s*read/u, "bridge repository contents must remain read-only");
assert.match(workflow, /issues:\s*write/u, "bridge publishes canonical evidence to the PR");
assert.match(workflow, /pull-requests:\s*read/u, "bridge resolves the current PR identity");
assert.doesNotMatch(workflow, /contents:\s*write/u, "bridge must not mutate repository contents directly");
assert.match(workflow, /Checkout trusted default branch publisher/u);
assert.match(workflow, /ref:\s*main/u, "only trusted main code may be checked out");
assert.match(workflow, /persist-credentials:\s*false/u, "trusted checkout must not retain push credentials");
assert.doesNotMatch(workflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head/u, "candidate head must never be checked out");
assert.doesNotMatch(workflow, /github\.event\.pull_request\.head\.sha[\s\S]{0,120}uses:\s*actions\/checkout/u, "candidate SHA must not feed checkout");
assert.match(workflow, /github\.actor != 'github-actions\[bot\]'/u, "writer-generated synchronization must not recurse");
assert.match(workflow, /generated-artifact-refresh/u, "explicit refresh authorization label must remain mandatory");
assert.match(workflow, /head\.repo\.full_name/u, "same-repository identity must be read from the API");
assert.match(workflow, /cross_repository_pull_request_forbidden/u, "forked PRs must fail closed");
assert.match(workflow, /base_ref.*main|unexpected_base_branch/u, "bridge must require main as base");
assert.match(workflow, /\^\(gpt\|cert\|fix\|feat\|chore\|docs\|release\)\//u, "only governed work branches may be writer targets");
assert.match(workflow, /protected_branch_mutation_forbidden/u, "protected targets must fail closed");
assert.match(workflow, /pull_request_head_mismatch/u, "stale exact-head events must fail closed");
assert.match(workflow, /pull_request_is_draft/u, "draft PRs must not dispatch the writer");
assert.match(workflow, /APPLY_GENERATED_ARTIFACT_REFRESH/u, "writer dispatch requires typed confirmation");
assert.match(workflow, /governed-generated-artifact-refresh\.yml\/dispatches/u, "bridge must delegate only to the registered writer");
assert.match(workflow, /governed-generated-artifact-refresh\.yml\/enable/u, "bridge may reactivate the registered writer before dispatch");
assert.match(workflow, /display_title == \$title/u, "run observation must bind the exact writer run title");
assert.match(workflow, /for attempt in \$\(seq 1 20\)/u, "writer observation must remain bounded");
assert.match(workflow, /delegated_workflow_run_not_observed/u, "unobserved dispatch must block");
assert.match(workflow, /delegated_run_observed:true/u, "passed evidence must prove an observed writer run");
assert.match(workflow, /delegated_run_id:\$delegated_run_id/u, "passed evidence must publish the writer run ID");
assert.match(workflow, /mad4b\.governed-generated-artifact-refresh-dispatch\.v1/u, "bridge must reuse the canonical dispatch evidence contract");
assert.match(workflow, /generated-artifact-refresh-dispatch-pr-publisher\.mjs/u, "trusted main publisher must publish the decision directly");
assert.match(workflow, /source_of_truth:\s*"structured_report"/u);
assert.match(workflow, /job_logs_role:\s*"diagnostic_only"/u);
assert.match(workflow, /consult_job_logs:\s*false/u);
assert.match(workflow, /direct_repository_mutation:\s*false/u);
assert.match(workflow, /protected_branch_mutation:\s*false/u);
assert.match(workflow, /force_push:\s*false/u);
assert.match(workflow, /secrets_included:\s*false/u);
assert.doesNotMatch(workflow, /\bgit\s+push\b/u, "bridge must never push directly");
assert.doesNotMatch(workflow, /secrets\./u, "bridge must not consume repository secrets");
assert.match(workflow, /cancel-in-progress:\s*false/u, "a second synchronization must not cancel an already delegated writer");

console.log(JSON.stringify({
  ok: true,
  tests: 46,
  gate: "governed_generated_artifact_refresh_pr_target_bridge",
  contract: "mad4b.governed-generated-artifact-refresh-dispatch.v1",
  trusted_default_branch_code: true,
  candidate_checkout: false,
  same_repository_only: true,
  exact_head_bound: true,
  protected_branch_mutation: false,
  direct_contents_write: false,
  force_push: false,
  secrets_included: false,
}));
