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
const dispatchBridge = readFileSync(
  new URL("../.github/workflows/governed-production-candidate-dispatch-bridge.yml", import.meta.url),
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
  /issue_comment:/,
  /DISPATCH_GOVERNED_PRODUCTION_CANDIDATE_BUILDER/,
  /id: eligibility/,
  /Evaluate event eligibility fail closed/,
  /eligible=\$ELIGIBLE/,
  /steps\.eligibility\.outputs\.eligible == 'true'/,
  /isCrossRepository/,
  /headRepository\.nameWithOwner/,
  /duplicate_suppressed/,
  /production-promotion-candidate\.yml/,
  /create_pull_requests=true/,
  /merge_executed=false/,
  /deployment_executed=false/,
  /migration_executed=false/,
]) {
  assert.match(dispatchBridge, required);
}

assert.doesNotMatch(
  dispatchBridge,
  /dispatch-exact-candidate-builder:\n(?:.*\n){0,8}\s+if:/,
  "Dispatch job eligibility must be evaluated inside a running job, not by a job-level if",
);

for (const workflow of [launcher, postFinalizationGuard, dispatchBridge]) {
  assert.doesNotMatch(workflow, /gh pr merge/i);
  assert.doesNotMatch(workflow, /git push\s+--force/i);
  assert.doesNotMatch(workflow, /force-with-lease/i);
}

console.log("Production promotion convergence workflow contract test passed");
