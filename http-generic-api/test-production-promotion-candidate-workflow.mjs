import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const workflow = read(".github/workflows/production-promotion-candidate.yml");
const certifiedValidation = read(".github/workflows/production-certified-release-cut-validation.yml");
const contractWorkflow = read(".github/workflows/production-promotion-candidate-contract.yml");

assert.match(workflow, /workflow_dispatch:/u, "candidate creation must remain explicitly dispatched");
assert.doesNotMatch(workflow, /pull_request_target:/u, "candidate creation must not run with pull_request_target privileges");
assert.match(workflow, /expected_main_sha:/u, "workflow must require an authorized release-cut SHA");
assert.match(workflow, /expected_head_sha:/u, "workflow must require an exact trusted workflow-source SHA");
assert.match(workflow, /expected_production_sha:/u, "workflow must require a pinned Production SHA");
assert.match(workflow, /validation_base_branch:/u, "workflow must require an immutable validation-base branch");
assert.match(workflow, /contents:\s*write/u, "candidate workflow needs bounded contents write permission");
assert.match(workflow, /pull-requests:\s*write/u, "candidate workflow needs bounded PR write permission");
assert.match(workflow, /cancel-in-progress:\s*false/u, "candidate construction must not be cancelled mid-ref update");

assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/u, "workflow must validate exact lowercase SHAs");
assert.match(workflow, /git check-ref-format --branch/u, "workflow must validate branch names");
assert.match(workflow, /trusted workflow source must contain the authorized release cut/u);
assert.match(workflow, /trusted workflow source must be tree-identical to the authorized release cut/u);
assert.match(workflow, /authorized release cut is no longer an ancestor of current main/u);
assert.match(workflow, /current Production contains commits not present in the authorized release cut/u);
assert.match(workflow, /Production moved before candidate construction/u);
assert.match(workflow, /release, validation, and validation-base branches must be distinct/u);

assert.match(workflow, /RELEASE_TREE=.*\^\{tree\}/u, "candidate tree must be sourced from the release cut");
assert.match(workflow, /git commit-tree "\$RELEASE_TREE" -p "\$RELEASE_CUT_SHA" -p "\$ACTUAL_PRODUCTION_SHA"/u, "candidate parents must be release cut then Production");
assert.match(workflow, /candidate first parent is not the release cut/u);
assert.match(workflow, /git diff --quiet "\$RELEASE_CUT_SHA" "\$CANDIDATE_SHA"/u, "candidate tree must equal release cut");
assert.match(workflow, /git merge-base --is-ancestor "\$RELEASE_CUT_SHA" "\$CANDIDATE_SHA"/u, "candidate must contain release-cut ancestry");
assert.match(workflow, /git merge-base --is-ancestor "\$ACTUAL_PRODUCTION_SHA" "\$CANDIDATE_SHA"/u, "candidate must contain Production ancestry");
assert.match(workflow, /existing release branch is not the exact reusable release-cut candidate; refusing history rewrite/u);

assert.match(workflow, /push_fast_forward_only "\$VALIDATION_BASE_BRANCH" "\$RELEASE_CUT_SHA"/u, "validation base must point to release cut");
assert.match(workflow, /push_fast_forward_only "\$RELEASE_BRANCH" "\$CANDIDATE_SHA"/u);
assert.match(workflow, /push_fast_forward_only "\$VALIDATION_BRANCH" "\$CANDIDATE_SHA"/u);
assert.match(workflow, /VALIDATION_BASE_READBACK/u);
assert.match(workflow, /upsert_pr "\$VALIDATION_BRANCH" "\$VALIDATION_BASE_BRANCH"/u);
assert.match(workflow, /test\(release\): certify immutable Production candidate/u, "validation surface must invoke the certified release-cut contract");
assert.match(workflow, /release_cut_mode: true/u);
assert.match(workflow, /main_tip_may_advance: true/u);

const pushLines = workflow.split("\n").filter((line) => /\bgit push\b/u.test(line));
assert.ok(pushLines.length > 0, "workflow must push bounded candidate refs");
for (const line of pushLines) {
  assert.doesNotMatch(line, /--force(?:-with-lease)?|\s-f\s/u, "candidate workflow must never force-push");
  assert.doesNotMatch(line, /refs\/heads\/(?:main|Production)\b/u, "candidate workflow must never push protected branches");
}
assert.doesNotMatch(workflow, /\bgh pr merge\b|\bmerge_pull_request\b/u, "candidate workflow must never merge");
assert.doesNotMatch(workflow, /\bgit merge(?:\s|$)/mu, "candidate workflow must not perform a working-tree merge");
assert.match(workflow, /upsert_pr "\$RELEASE_BRANCH" Production/u);
assert.match(workflow, /if-no-files-found:\s*error/u);
assert.match(workflow, /schema_version:"production_promotion_candidate\.v3"/u);
assert.match(workflow, /tree_policy:"exact_release_cut_tree"/u);
assert.match(workflow, /production_must_remain_stable:true/u);
assert.match(workflow, /governed_promotion_candidate: true/u);
for (const flag of ["merge_executed", "deployment_executed", "migration_executed", "provider_call_executed", "credential_payload_read", "secrets_included"]) {
  assert.match(workflow, new RegExp(`${flag}:false|${flag}: false`, "u"), `${flag} must remain false`);
}

assert.match(certifiedValidation, /pull_request_target:/u, "certified validation must use its trusted target-side workflow definition");
assert.match(certifiedValidation, /test\(release\): certify immutable Production candidate/u);
assert.match(certifiedValidation, /certified validation requires a same-repository head/u);
assert.match(certifiedValidation, /candidate first parent must be the certified release cut/u);
assert.match(certifiedValidation, /candidate tree differs from certified release cut/u);
assert.match(certifiedValidation, /certified release cut is not contained by current main/u);
assert.match(certifiedValidation, /Production moved during certified-cut validation/u);
assert.match(certifiedValidation, /git merge-base --is-ancestor "\$BASE_SHA" "\$MAIN_SHA_FINAL"/u);
assert.match(certifiedValidation, /git merge-base --is-ancestor "\$PRODUCTION_SHA" "\$HEAD_SHA"/u);
assert.match(certifiedValidation, /schema_version: "certified_production_release_cut\.v1"/u);
assert.match(certifiedValidation, /candidate_tree_matches_certified_cut: true/u);
assert.match(certifiedValidation, /certified_cut_is_ancestor_of_current_main: true/u);
assert.match(certifiedValidation, /production_ref_stable_during_validation: true/u);
assert.match(certifiedValidation, /main_tip_may_advance: true/u);
assert.doesNotMatch(certifiedValidation, /contents:\s*write/u);
assert.doesNotMatch(certifiedValidation, /\bgh pr merge\b|\bmerge_pull_request\b/u);

assert.match(contractWorkflow, /contents:\s*read/u, "contract workflow must be read-only");
assert.doesNotMatch(contractWorkflow, /contents:\s*write/u);
assert.match(contractWorkflow, /production-certified-release-cut-validation\.yml/u, "contract workflow must cover certified validation");
assert.match(contractWorkflow, /node test-production-promotion-candidate-workflow\.mjs/u);
assert.match(contractWorkflow, /if-no-files-found:\s*error/u);

console.log("Production immutable release-cut candidate workflow contract passed");