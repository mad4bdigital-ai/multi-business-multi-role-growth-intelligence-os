import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const workflow = read(".github/workflows/production-promotion-candidate.yml");
const contractWorkflow = read(".github/workflows/production-promotion-candidate-contract.yml");

assert.match(workflow, /workflow_dispatch:/, "candidate creation must remain explicitly dispatched");
assert.doesNotMatch(workflow, /pull_request_target:/, "candidate creation must not run with pull_request_target privileges");
assert.match(workflow, /expected_main_sha:/, "workflow must require a pinned main SHA");
assert.match(workflow, /expected_production_sha:/, "workflow must require a pinned Production SHA");
assert.match(workflow, /contents:\s*write/, "candidate workflow needs bounded contents write permission");
assert.match(workflow, /pull-requests:\s*write/, "candidate workflow needs bounded PR write permission");
assert.match(workflow, /cancel-in-progress:\s*false/, "candidate construction must not be cancelled mid-ref update");

assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/, "workflow must validate exact lowercase 40-character SHAs");
assert.match(workflow, /git check-ref-format --branch/, "workflow must validate user-supplied branch names");
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
assert.match(workflow, /upsert_pr "\$VALIDATION_BRANCH" main/, "workflow must create a non-merge main validation PR");

assert.match(workflow, /if-no-files-found:\s*error/, "candidate evidence must fail closed when missing");
assert.match(workflow, /schema_version:\s*"production_promotion_candidate\.v1"/, "candidate evidence must be versioned");
assert.match(workflow, /merge_executed:\s*false/, "evidence must state that merge was not executed");
assert.match(workflow, /deployment_executed:\s*false/, "evidence must state that deployment was not executed");
assert.match(workflow, /migration_executed:\s*false/, "evidence must state that migration was not executed");
assert.match(workflow, /provider_call_executed:\s*false/, "evidence must state that provider calls were not executed");
assert.match(workflow, /credential_payload_read:\s*false/, "evidence must state that credentials were not read");
assert.match(workflow, /secrets_included:\s*false/, "evidence must state that secrets are excluded");

assert.match(contractWorkflow, /contents:\s*read/, "contract workflow must be read-only");
assert.doesNotMatch(contractWorkflow, /contents:\s*write/, "contract workflow must not write repository contents");
assert.match(contractWorkflow, /node test-production-promotion-candidate-workflow\.mjs/, "contract workflow must execute the focused test");
assert.match(contractWorkflow, /if-no-files-found:\s*error/, "contract evidence upload must fail closed");

console.log("Production promotion candidate workflow contract passed");
