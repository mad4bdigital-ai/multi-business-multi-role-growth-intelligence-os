#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = "../.github/workflows/governed-generated-artifact-refresh-dispatch.yml";
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /^name:\s*Governed Generated Artifact Refresh Dispatch$/mu);
assert.match(workflow, /^\s*push:\s*$/mu, "dispatcher must observe governed work-branch pushes");
assert.match(workflow, /^\s*pull_request_target:\s*$/mu, "dispatcher must observe trusted PR label and synchronization events from main");
assert.match(workflow, /types:\s*\[labeled, synchronize, reopened\]/u, "trusted PR dispatch must cover label, synchronize, and reopen events");
assert.match(workflow, /^\s*workflow_dispatch:\s*$/mu, "dispatcher must retain an explicit dispatch surface");
for (const pattern of ["gpt/**", "cert/**", "fix/**", "feat/**", "chore/**", "docs/**", "release/**"]) {
  assert.ok(workflow.includes(`- "${pattern}"`), `missing governed branch family ${pattern}`);
}
assert.match(workflow, /actions:\s*write/u, "dispatcher requires Actions dispatch authority");
assert.match(workflow, /contents:\s*read/u, "dispatcher must keep repository contents read-only");
assert.match(workflow, /pull-requests:\s*read/u, "dispatcher must resolve the associated pull request without comment authority");
assert.doesNotMatch(workflow, /contents:\s*write/u, "dispatcher must not receive direct contents-write authority");
assert.doesNotMatch(workflow, /\bgit\s+push\b/u, "dispatcher must not push repository contents directly");
assert.doesNotMatch(workflow, /actions\/checkout/u, "pull_request_target dispatcher must never checkout candidate code");
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u, "trusted PR dispatch must reject cross-repository heads");
assert.match(workflow, /github\.event\.pull_request\.head\.ref/u, "trusted PR dispatch must bind the event head ref");
assert.match(workflow, /github\.event\.pull_request\.head\.sha/u, "trusted PR dispatch must bind the event exact head SHA");
assert.match(workflow, /cross_repository_pull_request_forbidden/u, "runtime readback must also reject cross-repository PRs");
assert.match(workflow, /generated-artifact-refresh/u, "dispatch must require the explicit PR label");
assert.match(workflow, /APPLY_GENERATED_ARTIFACT_REFRESH/u, "delegated workflow must receive typed confirmation");
assert.match(workflow, /expected_head_sha/u, "delegated workflow must receive an exact expected head SHA");
assert.match(workflow, /main.*Production/u, "dispatcher must reject protected branches before API dispatch");
assert.match(workflow, /governed-generated-artifact-refresh\.yml\/dispatches/u, "dispatcher must target the registered mutating workflow");
assert.match(workflow, /mad4b\.governed-generated-artifact-refresh-dispatch\.v1/u, "dispatcher must emit its canonical evidence contract");
assert.match(workflow, /source_of_truth:\s*"structured_report"/u);
assert.match(workflow, /job_logs_role:\s*"diagnostic_only"/u);
assert.match(workflow, /consult_job_logs:\s*false/u);
assert.match(workflow, /secrets_included:\s*false/u);
assert.match(workflow, /github\.actor != 'github-actions\[bot\]'/u, "bot-authored generated commits must not recursively dispatch");

console.log(JSON.stringify({
  ok: true,
  tests: 25,
  gate: "governed_generated_artifact_refresh_dispatch_workflow",
  contract: "mad4b.governed-generated-artifact-refresh-dispatch.v1",
  trusted_pr_event: true,
  candidate_checkout: false,
  direct_contents_write: false,
  force_push: false,
  secrets_included: false,
}));
