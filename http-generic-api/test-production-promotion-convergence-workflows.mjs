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
]) {
  assert.match(launcher, required);
}

const launcherJobHeader =
  launcher.match(/  converge-source-pinned-candidate:\n[\s\S]*?    steps:/)?.[0] ?? "";
assert.ok(launcherJobHeader, "Production promotion launcher job header must exist");
assert.doesNotMatch(
  launcherJobHeader,
  /EVIDENCE_PATH:\s*\$\{\{\s*runner\.temp\s*\}\}/,
  "runner.temp must not be evaluated in the launcher job-level environment",
);
assert.match(
  launcher,
  /id: converge\n\s+shell: bash\n\s+env:\n\s+EVIDENCE_PATH: \$\{\{ runner\.temp \}\}\/governed-production-promotion-convergence\.json\n\s+run: \|/,
  "the convergence step must receive the runner-scoped evidence path at step runtime",
);
assert.match(
  launcher,
  /path: \$\{\{ runner\.temp \}\}\/governed-production-promotion-convergence\.json/,
  "artifact upload must use runner.temp only from the step context",
);
assert.match(
  launcher,
  /exact_validation_run_id: \$exact_validation_run_id/,
  "structured evidence must retain the declared exact-validation argument binding",
);
assert.doesNotMatch(
  launcher,
  /exact_validation_run_id: \$exact_run_id/,
  "structured evidence must not reference an undeclared exact_run_id variable",
);

for (const required of [
  /workflow_run:/,
  /Governed Production Promotion Request Launcher/,
  /MAX_POST_FINALIZATION_RETRIES: 3/,
  /\.request_pr \| test/,
  /jq -r '\.request_pr'/,
  /main_moved_after_finalization/,
  /production_moved_after_finalization/,
  /release_head_changed_after_finalization/,
  /candidate_no_longer_matches_or_contains_main/,
  /candidate_no_longer_contains_pinned_production/,
  /gh pr reopen "\$REQUEST_PR"/,
  /startswith\(\"release\/production-\"\)/,
  /startswith\(\"gpt\/validate-production-candidate-\"\)/,
  /single_release_surface=true/,
  /final_freshness_readback=true/,
  /merge executed: false/,
  /deployment executed: false/,
  /migration executed: false/,
]) {
  assert.match(postFinalizationGuard, required);
}

for (const required of [
  /name: Certified Production Release Cut Validation/,
  /pull_request_target:/,
  /issues: write/,
  /gpt\/validate-certified-release-base-\*/,
  /gpt\/validate-certified-release-candidate-/,
  /Validate trusted same-repository validation surface/,
  /certified validation requires a same-repository head/,
  /persist-credentials: false/,
  /CERTIFIED_PRODUCTION_RELEASE_CUT_VALIDATION phase=started/,
  /CERTIFIED_PRODUCTION_RELEASE_CUT_VALIDATION phase=ci_dispatched/,
  /CERTIFIED_PRODUCTION_RELEASE_CUT_VALIDATION phase=succeeded/,
  /CERTIFIED_PRODUCTION_RELEASE_CUT_VALIDATION phase=failed/,
  /runner_pool=ubuntu-24\.04-arm/,
  /execution_mode=direct_arm/,
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
assert.doesNotMatch(
  certifiedJobHeader,
  /^    if:/m,
  "certified release-cut validation must not use a job-level eligibility condition",
);

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
