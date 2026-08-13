import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(
  new URL("../.github/workflows/governed-production-promotion-request-launcher.yml", import.meta.url),
  "utf8",
);
const postFinalizationGuard = readFileSync(
  new URL("../.github/workflows/governed-production-promotion-post-finalization-guard.yml", import.meta.url),
  "utf8",
);
const certifiedReleaseCut = readFileSync(
  new URL("../.github/workflows/production-certified-release-cut-validation.yml", import.meta.url),
  "utf8",
);

for (const required of [
  /group: governed-production-promotion-convergence-\$\{\{ github\.repository \}\}/,
  /cancel-in-progress: true/,
  /MAX_ATTEMPTS=3/,
  /production-promotion-candidate\.yml/,
  /production-promotion-exact-candidate-validation\.yml/,
  /Frontend surface dispatch/,
  /HTTP Generic API Fanout Relocation/,
  /Custom GPT Contract Guard/,
  /Platform Completion Cleanup Readback/,
  /Platform Remaining Scope Scorecard/,
  /Spec 011 Delegation MariaDB Certification/,
  /resolve_run_once\(\)/,
  /sort_by\(\.createdAt, \.databaseId\)/,
  /\.status != \\"completed\\"/,
  /\.conclusion == \\"success\\"/,
  /\.conclusion == \\"action_required\\"/,
  /spec-011-delegation-mariadb-certification\.yml/,
  /Spec 011 release branch moved before supporting gate dispatch/,
  /refusing blind dispatch retry/,
  /protected refs moved during validation; retrying from current refs/,
  /request_pr: \$request_pr/,
  /candidate_tree_matches_main: true/,
  /protected_refs_stable_during_validation: true/,
  /exact_full_ci_success: true/,
  /merge_executed: false/,
  /deployment_executed: false/,
  /migration_executed: false/,
  /provider_call_executed: false/,
  /credential_payload_read: false/,
  /secrets_included: false/,
  /\.head\.repo\.full_name \/\/ ""/,
  /request PR must originate from this repository/,
  /run \$run_id is waiting for required approval; keeping governed review surfaces open/,
  /source-pinned main moved during convergence/,
  /refusing to build against an unapproved main/,
  /validation branch prefix must use the governed candidate namespace/,
  /validation base branch prefix must use the governed base namespace/,
]) {
  assert.match(launcher, required);
}
assert.doesNotMatch(launcher, /headRepositoryOwner/);

const waitRunSuccessBlock = launcher.match(/wait_run_success\(\) \{[\s\S]*?\n\s+\}\n\n\s+close_surface\(\)/)?.[0] ?? "";
assert.ok(waitRunSuccessBlock, "launcher must expose a bounded run wait contract");
assert.match(
  waitRunSuccessBlock,
  /conclusion.*action_required[\s\S]*?keeping governed review surfaces open/,
  "action_required must remain approval-pending instead of closing governed review surfaces",
);

const spec011DispatchBlock =
  launcher.match(
    /if \[\[ "\$workflow_name" == "Spec 011 Delegation MariaDB Certification" \]\]; then[\s\S]*?else\n\s+SUPPORTING_RUN_ID=/,
  )?.[0] ?? "";
assert.ok(spec011DispatchBlock, "Spec 011 supporting gate must have an explicit bounded dispatch block");
assert.match(
  spec011DispatchBlock,
  /SUPPORTING_RUN_ID="\$\(resolve_run_once "\$workflow_name" "\$ATTEMPT_STARTED_AT" "\$CANDIDATE_SHA"\)"/,
  "Spec 011 must reuse an already-visible exact-head run before dispatch",
);
assert.match(
  spec011DispatchBlock,
  /SPEC011_RELEASE_READBACK="\$\(gh api "\/repos\/\$\{REPOSITORY\}\/git\/ref\/heads\/\$\{RELEASE_BRANCH\}" --jq '\.object\.sha'\)"/,
  "Spec 011 dispatch must CAS-read the release branch immediately before dispatch",
);
assert.match(
  spec011DispatchBlock,
  /gh workflow run spec-011-delegation-mariadb-certification\.yml[\s\S]*?--ref "\$RELEASE_BRANCH"/,
  "Spec 011 dispatch must target the release branch that points at the candidate",
);
assert.equal(
  (spec011DispatchBlock.match(/gh workflow run spec-011-delegation-mariadb-certification\.yml/g) ?? []).length,
  1,
  "Spec 011 must have one bounded dispatch command and no blind retry loop",
);
assert.doesNotMatch(
  spec011DispatchBlock,
  /--ref main/,
  "Spec 011 supporting-gate dispatch must not run against moving main",
);
assert.doesNotMatch(
  spec011DispatchBlock,
  /--ref Production/,
  "Spec 011 supporting-gate dispatch must not run against Production",
);

for (const required of [
  /workflow_run:/,
  /Governed Production Promotion Request Launcher/,
  /MAX_POST_FINALIZATION_RETRIES: 3/,
  /\.request_pr \| test/,
  /\.validation_pr \| test/,
  /jq -r '\.request_pr'/,
  /jq -r '\.validation_pr'/,
  /main_moved_after_finalization/,
  /production_moved_after_finalization/,
  /release_head_changed_after_finalization/,
  /candidate_no_longer_matches_or_contains_main/,
  /candidate_no_longer_contains_pinned_production/,
  /gh pr reopen "\$REQUEST_PR"/,
  /startswith\(\"release: promote pinned main \"\)/,
  /startswith\(\"ci: validate exact Production candidate \"\)/,
  /authoritative_validation_pr=/,
  /single_release_surface=true/,
  /final_freshness_readback=true/,
  /merge executed: false/,
  /deployment executed: false/,
  /migration executed: false/,
]) {
  assert.match(postFinalizationGuard, required);
}
assert.doesNotMatch(
  postFinalizationGuard,
  /(?:release\/production-|gpt\/validate-production-candidate-)/,
  "post-finalization cleanup must select governed PR surfaces independently of work-branch names",
);

for (const required of [
  /name: Certified Production Release Cut Validation/,
  /pull_request_target:/,
  /contents: read/,
  /if: "startsWith\(github\.event\.pull_request\.title, 'test\(release\): certify immutable Production candidate '\)"/,
  /Validate trusted same-repository validation surface/,
  /certified validation requires a same-repository head/,
  /persist-credentials: false/,
  /candidate first parent must be the certified release cut/,
  /candidate tree differs from certified release cut/,
  /certified release cut is not contained by current main/,
  /candidate does not contain current Production ancestry/,
  /Production moved during certified-cut validation/,
  /git merge-base --is-ancestor "\$BASE_SHA" "\$MAIN_SHA_FINAL"/,
  /git merge-base --is-ancestor "\$PRODUCTION_SHA" "\$HEAD_SHA"/,
  /schema_version: "certified_production_release_cut\.v1"/,
  /release_mode: "certified_release_cut"/,
  /execution_mode: "direct_arm"/,
  /runner_pool: "ubuntu-24\.04-arm"/,
  /exact_full_ci_success: true/,
  /candidate_tree_matches_certified_cut: true/,
  /certified_cut_is_ancestor_of_current_main: true/,
  /candidate_contains_production: true/,
  /candidate_and_base_refs_immutable_during_validation: true/,
  /production_ref_stable_during_validation: true/,
  /main_tip_may_advance: true/,
  /name: Syntax Check/,
  /name: Unit & Integration Tests/,
  /name: Execution Resolver Gate/,
  /name: Architecture Drift Detection/,
  /merge_executed: false/,
  /deployment_executed: false/,
  /migration_executed: false/,
  /provider_call_executed: false/,
  /credential_payload_read: false/,
  /secrets_included: false/,
]) {
  assert.match(certifiedReleaseCut, required);
}

const certifiedJobHeader =
  certifiedReleaseCut.match(/  certified-release-cut-ci:\n[\s\S]*?    steps:/)?.[0] ?? "";
assert.ok(certifiedJobHeader, "certified release-cut job header must exist");
assert.match(
  certifiedJobHeader,
  /if: "startsWith\(github\.event\.pull_request\.title, 'test\(release\): certify immutable Production candidate '\)"/,
  "certified release-cut validation must use a quoted, branch-independent governed eligibility selector",
);
assert.doesNotMatch(certifiedReleaseCut, /issues:\s*write/);
assert.doesNotMatch(certifiedReleaseCut, /gh pr comment/);
assert.doesNotMatch(certifiedReleaseCut, /gpt\/validate-certified-release-(?:base|candidate)-/);

const armJobs = certifiedReleaseCut.match(/runs-on: ubuntu-24\.04-arm/g) ?? [];
assert.equal(
  armJobs.length,
  6,
  "certified release-cut validation must run preflight, four CI gates, and final evidence on ARM",
);
assert.doesNotMatch(
  certifiedReleaseCut,
  /gh workflow run ci\.yml/,
  "certified validation must not dispatch the frozen candidate's x64 CI workflow",
);
assert.doesNotMatch(
  certifiedReleaseCut,
  /runs-on: ubuntu-latest/,
  "certified release validation must not depend on the queued x64 runner pool",
);

for (const workflow of [launcher, postFinalizationGuard, certifiedReleaseCut]) {
  assert.doesNotMatch(workflow, /gh pr merge/i);
  assert.doesNotMatch(workflow, /git push\s+--force/i);
  assert.doesNotMatch(workflow, /force-with-lease/i);
  assert.doesNotMatch(workflow, /deployment_authorized=true/i);
  assert.doesNotMatch(workflow, /migration_authorized=true/i);
}

// Compose the independently reviewable migration-first response-chunk rollout contract into this already registered operational suite.
await import("./test-response-chunk-ownership-governed-rollout-control.mjs");

console.log("Production promotion convergence workflow contract test passed");