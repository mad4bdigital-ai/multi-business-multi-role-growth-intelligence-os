import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync("../.github/workflows/derived-state-converged-automerge.yml", "utf8");
const readiness = readFileSync("../.github/ops/github-followup-automerge-readiness.mjs", "utf8");

assert.match(
  workflow,
  /github\.event\.workflow_run\.name == 'Derived State Closure' && github\.event\.workflow_run\.event == 'pull_request'/,
  "main finalization must accept only pull-request Derived State Closure evidence",
);
assert.match(
  workflow,
  /github\.event\.workflow_run\.name == 'Governed Production Promotion Request Launcher' && github\.event\.workflow_run\.event == 'workflow_dispatch'/,
  "Production finalization must accept only governed workflow-dispatch evidence",
);
assert.match(workflow, /source_event="\$\(jq -r '\.event' "\$run"\)"/, "source event must be read back from the trusted run API");
assert.match(workflow, /test "\$source_event" = "pull_request"/, "main evidence must fail closed when its source event is not a pull request");
assert.match(workflow, /test "\$source_event" = "workflow_dispatch"/, "Production evidence must fail closed when its source event is not a workflow dispatch");
assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.REPO_AUTOSYNC_TOKEN \}\}/, "finalizer merge must use the dedicated token");
assert.doesNotMatch(
  workflow,
  /GH_TOKEN: \$\{\{ secrets\.REPO_AUTOSYNC_TOKEN \|\| github\.token \}\}/,
  "finalizer merge must not fall back to GITHUB_TOKEN",
);
assert.match(workflow, /REPO_AUTOSYNC_TOKEN is required for the exact-head governed merge/, "missing dedicated token must block governed merge");
assert.match(workflow, /Checkout governance finalizer readiness verifier/, "finalizer must checkout the exact-source readiness verifier before merge");
assert.match(workflow, /ref: \$\{\{ needs\.attest\.outputs\.source_head_sha \}\}/, "readiness verifier must come from the exact attested source head");
assert.match(workflow, /attestor_app_id: \$\{\{ steps\.final\.outputs\.attestor_app_id \}\}/, "attestation App id must cross the job boundary");
assert.match(workflow, /status_creator_id: \$\{\{ steps\.final\.outputs\.status_creator_id \}\}/, "status creator id must cross the job boundary");
assert.match(workflow, /jq -r '\.app_id \/\/ empty'/, "finalizer must read the exact attestor App id from same-cycle attestation");
assert.match(workflow, /jq -r '\.status_creator_id \/\/ empty'/, "finalizer must read the exact status creator from same-cycle attestation");
assert.match(workflow, /TARGET_BRANCH=main/, "main finalizer readiness must be branch-bound");
assert.match(workflow, /REQUIRED_CHECK_CONTEXT="Derived State Closure"/, "main finalizer readiness must require Derived State Closure");
assert.match(workflow, /EXPECTED_HEAD_SHA="\$BASE_SHA"/, "server readiness must be bound to the exact attested main base SHA");
assert.match(workflow, /EXPECTED_PR_HEAD_SHA="\$PR_HEAD_SHA"/, "server readiness must be bound to the exact attested PR head SHA");
assert.match(workflow, /EXPECTED_CANDIDATE_SHA="\$CANDIDATE_SHA"/, "server readiness must be bound to the exact merge candidate SHA");
assert.match(workflow, /EXPECTED_ATTESTOR_APP_ID="\$ATTESTOR_APP_ID"/, "server readiness must bind the active rule to the attestor App id");
assert.match(workflow, /EXPECTED_STATUS_CREATOR_ID="\$STATUS_CREATOR_ID"/, "server readiness must bind the candidate status to the same-cycle creator id");
assert.match(workflow, /node \.github\/ops\/github-followup-automerge-readiness\.mjs/, "finalizer must delegate live repository protection checks to the central verifier");
assert.match(workflow, /gh pr merge "\$PR_NUMBER" --squash --delete-branch --match-head-commit "\$PR_HEAD_SHA"/, "governed merge must stay bound to the exact unchanged PR head");
assert.doesNotMatch(workflow, /gh pr merge[^\n]*--auto/, "native GitHub auto-merge must not be used by the Governance Finalizer");
assert.doesNotMatch(workflow, /gh pr merge[^\n]*--admin/, "Governance Finalizer must not bypass server policy with admin merge");
assert.match(workflow, /readback_merged_at=/, "finalizer must perform same-cycle merged-state readback");
assert.match(workflow, /readback_merge_commit_sha=/, "finalizer must prove the resulting merge commit");
assert.match(workflow, /native_auto_merge=false/, "final attestation comment must record that native auto-merge was not used");
assert.match(workflow, /server_protection_verified=true/, "final attestation must record successful server protection verification");

const readinessIndex = workflow.indexOf("node .github/ops/github-followup-automerge-readiness.mjs");
const mergeIndex = workflow.indexOf('gh pr merge "$PR_NUMBER" --squash');
assert.ok(readinessIndex >= 0, "central readiness verifier invocation is required");
assert.ok(mergeIndex > readinessIndex, "server readiness must be proven before governed merge");

assert.match(readiness, /github-followup-finalizer-merge-readiness\.v2/, "central verifier must expose the finalizer merge-readiness v2 contract");
assert.match(readiness, /repositoryState\.allow_auto_merge !== false/, "native repository auto-merge must be disabled before automated finalization");
assert.match(readiness, /rules\/branches\/\$\{encodeURIComponent\(branch\)\}/, "verifier must read active branch rules instead of relying on classic branch protection only");
assert.match(readiness, /rulesets\?includes_parents=true&per_page=100/, "verifier must read the complete applicable ruleset index");
assert.match(readiness, /managedRuleset\.bypass_actors/, "verifier must prove the managed ruleset has no bypass actors");
assert.match(readiness, /activeBinding\.integration_id !== expectedAttestorAppId/, "active required status must be bound to the exact trusted App id");
assert.match(readiness, /managedBinding\.integration_id !== expectedAttestorAppId/, "managed ruleset required status must be bound to the exact trusted App id");
assert.match(readiness, /commits\/\$\{expectedCandidate\}\/statuses\?per_page=100/, "verifier must read exact-candidate statuses");
assert.match(readiness, /Number\(status\?\.creator\?\.id \|\| 0\) === expectedStatusCreatorId/, "candidate success status must come from the same-cycle attestor creator");
assert.match(readiness, /safe_to_register_auto_merge: false/, "native auto-merge registration must remain forbidden");
assert.match(readiness, /safe_to_merge_now: true/, "verifier may authorize only an immediate exact-head finalizer merge");
assert.doesNotMatch(readiness, /allow_auto_merge !== true/, "retired native auto-merge prerequisite must not return");

console.log("derived state converged finalizer source event tests passed");
