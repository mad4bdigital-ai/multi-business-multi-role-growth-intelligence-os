import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const workflow = read(".github/workflows/production-promotion-candidate.yml");
const exactValidation = read(".github/workflows/production-promotion-exact-candidate-validation.yml");
const contractWorkflow = read(".github/workflows/production-promotion-candidate-contract.yml");

assert.match(workflow, /workflow_dispatch:/, "candidate creation must remain explicitly dispatched");
assert.doesNotMatch(workflow, /pull_request_target:/, "candidate creation must not run with pull_request_target privileges");
assert.match(workflow, /expected_main_sha:/, "workflow must require a pinned main SHA");
assert.match(workflow, /expected_production_sha:/, "workflow must require a pinned Production SHA");
assert.match(workflow, /validation_base_branch:/, "workflow must require a pinned validation-base branch");
assert.match(workflow, /contents:\s*write/, "candidate workflow needs bounded contents write permission");
assert.match(workflow, /pull-requests:\s*write/, "candidate workflow needs bounded PR write permission");
assert.match(workflow, /cancel-in-progress:\s*false/, "candidate construction must not be cancelled mid-ref update");

assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/, "workflow must validate exact lowercase 40-character SHAs");
assert.match(workflow, /git check-ref-format --branch/, "workflow must validate user-supplied branch names");
assert.match(workflow, /gpt\/validate-production-base/, "validation base must use a governed branch prefix");
assert.match(workflow, /release, validation, and validation-base branches must be distinct/, "candidate branches must be distinct");
assert.match(workflow, /refs\/remotes\/origin\/main/, "workflow must read back the protected main ref");
assert.match(workflow, /refs\/remotes\/origin\/Production/, "workflow must read back the protected Production ref");
assert.match(workflow, /protected refs moved during candidate construction/, "workflow must perform a second protected-ref freshness check");

assert.match(workflow, /git commit-tree/, "workflow must construct a source-pinned Git commit directly");
assert.match(workflow, /MAIN_TREE=.*\^\{tree\}/, "candidate tree must be sourced from pinned main");
assert.match(workflow, /git diff --quiet "\$ACTUAL_MAIN" "\$CANDIDATE_SHA"/, "candidate tree must equal pinned main");
assert.match(workflow, /git merge-base --is-ancestor "\$ACTUAL_MAIN" "\$CANDIDATE_SHA"/, "candidate must contain main ancestry");
assert.match(workflow, /git merge-base --is-ancestor "\$ACTUAL_PRODUCTION" "\$CANDIDATE_SHA"/, "candidate must contain Production ancestry");
assert.match(workflow, /git merge-base --is-ancestor "\$PREVIOUS_RELEASE" "\$CANDIDATE_SHA"/, "candidate updates must preserve prior release-candidate ancestry");
assert.match(workflow, /candidate would require rewriting the existing release branch/, "non-fast-forward updates must fail closed");

assert.match(workflow, /push_fast_forward_only "\$VALIDATION_BASE_BRANCH" "\$ACTUAL_MAIN"/, "validation base must point to pinned main");
assert.match(workflow, /push_fast_forward_only "\$RELEASE_BRANCH" "\$CANDIDATE_SHA"/, "release candidate push must be bounded");
assert.match(workflow, /push_fast_forward_only "\$VALIDATION_BRANCH" "\$CANDIDATE_SHA"/, "validation candidate push must be bounded");
assert.match(workflow, /VALIDATION_BASE_READBACK/, "validation base must be read back after push");
assert.match(workflow, /upsert_pr "\$VALIDATION_BRANCH" "\$VALIDATION_BASE_BRANCH"/, "validation PR must target the pinned base");

const pushLines = workflow.split("\n").filter((line) => /\bgit push\b/.test(line));
assert.ok(pushLines.length > 0, "workflow must push bounded candidate refs");
for (const line of pushLines) {
  assert.doesNotMatch(line, /--force(?:-with-lease)?|\s-f\s/, "candidate workflow must never force-push");
  assert.doesNotMatch(line, /refs\/heads\/(?:main|Production)\b/, "candidate workflow must never push protected branches");
  assert.doesNotMatch(line, /:\+refs\/heads\//, "candidate workflow must never use a forced refspec");
}

assert.doesNotMatch(workflow, /\bgh pr merge\b/, "workflow must never merge a pull request");
assert.doesNotMatch(workflow, /\bmerge_pull_request\b/, "workflow must never invoke a merge API");
assert.doesNotMatch(workflow, /\bgit merge(?:\s|$)/m, "workflow must not perform a working-tree merge");
assert.match(workflow, /gh pr create --head "\$head" --base "\$base"/, "workflow may only create reviewable PR surfaces");
assert.match(workflow, /upsert_pr "\$RELEASE_BRANCH" Production/, "workflow must create a Production-targeted release PR");

assert.match(workflow, /if-no-files-found:\s*error/, "candidate evidence must fail closed when missing");
assert.match(workflow, /schema_version:\s*"production_promotion_candidate\.v2"/, "candidate evidence must be versioned");
assert.match(workflow, /validation_policy:\s*"pinned_base_exact_ci_dispatch"/, "candidate evidence must describe exact validation");
assert.match(workflow, /merge_executed:\s*false/, "evidence must state that merge was not executed");
assert.match(workflow, /deployment_executed:\s*false/, "evidence must state that deployment was not executed");
assert.match(workflow, /migration_executed:\s*false/, "evidence must state that migration was not executed");
assert.match(workflow, /provider_call_executed:\s*false/, "evidence must state that provider calls were not executed");
assert.match(workflow, /credential_payload_read:\s*false/, "evidence must state that credentials were not read");
assert.match(workflow, /secrets_included:\s*false/, "evidence must state that secrets are excluded");

assert.match(exactValidation, /pull_request:/, "exact validation must be triggered by a reviewable PR");
assert.match(exactValidation, /gpt\/validate-production-base-\*/, "exact validation must accept source-pinned base branches");
assert.doesNotMatch(exactValidation, /pull_request_target:/, "exact validation must not use pull_request_target");
assert.match(exactValidation, /actions:\s*write/, "exact validation needs bounded Actions dispatch permission");
assert.match(exactValidation, /contents:\s*read/, "exact validation must keep repository contents read-only");
assert.match(exactValidation, /git diff --quiet "\$BASE_SHA" "\$HEAD_SHA"/, "exact validation must require identical trees");
assert.match(exactValidation, /validation branches moved before exact-CI dispatch/, "exact validation must read refs before dispatch");
assert.match(exactValidation, /gh workflow run ci\.yml --ref "\$HEAD_REF"/, "exact validation must dispatch Full CI on the candidate branch");
assert.match(exactValidation, /gh run watch "\$RUN_ID" --exit-status/, "exact validation must wait for CI success");
assert.match(exactValidation, /Syntax Check/, "exact validation must require Syntax Check success");
assert.match(exactValidation, /Unit & Integration Tests/, "exact validation must require Unit and Integration success");
assert.match(exactValidation, /Execution Resolver Gate/, "exact validation must require Execution Resolver success");
assert.match(exactValidation, /Architecture Drift Detection/, "exact validation must require Architecture Drift success");
assert.match(exactValidation, /validation branches moved during exact-CI execution/, "exact validation must re-read refs after CI");
assert.match(exactValidation, /schema_version:\s*"production_promotion_exact_candidate_ci\.v1"/, "exact-CI evidence must be versioned");
assert.match(exactValidation, /if-no-files-found:\s*error/, "exact-CI evidence must fail closed when missing");
assert.doesNotMatch(exactValidation, /\bgh pr merge\b|\bmerge_pull_request\b/, "exact validation must never merge");

assert.match(contractWorkflow, /contents:\s*read/, "contract workflow must be read-only");
assert.doesNotMatch(contractWorkflow, /contents:\s*write/, "contract workflow must not write repository contents");
assert.match(contractWorkflow, /production-promotion-exact-candidate-validation\.yml/, "contract workflow must cover the launcher");
assert.match(contractWorkflow, /node test-production-promotion-candidate-workflow\.mjs/, "contract workflow must execute the focused test");
assert.match(contractWorkflow, /if-no-files-found:\s*error/, "contract evidence upload must fail closed");

console.log("Production promotion candidate workflow contract passed");
