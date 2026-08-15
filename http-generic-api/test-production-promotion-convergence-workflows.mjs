import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const launcher = read(".github/workflows/governed-production-promotion-request-launcher.yml");
const candidate = read(".github/workflows/production-promotion-candidate.yml");
const mainSourcePinGuard = read(".github/workflows/governed-production-main-source-pin-guard.yml");
const releaseSourcePinGate = read(".github/workflows/governed-production-release-source-pin-gate.yml");
const postFinalizationGuard = read(".github/workflows/governed-production-promotion-post-finalization-guard.yml");
const certifiedReleaseCut = read(".github/workflows/production-certified-release-cut-validation.yml");
const ci = read(".github/workflows/ci.yml");
const runtimeStartupWorkflow = read(".github/workflows/runtime-startup-deployment-evidence.yml");
const startupSmoke = read("http-generic-api/test-server-startup-smoke.mjs");
const runtimeStartupEvidence = read("http-generic-api/scripts/runtime-startup-deployment-evidence.mjs");
const runtimeStartupEnvironment = read("http-generic-api/scripts/runtime-startup-test-environment.mjs");
const gateResolver = read(".github/scripts/production-promotion-supporting-gates.mjs");
const evidenceHelper = read(".github/scripts/production-promotion-release-cut-evidence.mjs");
const registry = JSON.parse(read(".github/contracts/production-promotion-supporting-gates.v1.json"));

for (const required of [
  /group: governed-production-promotion-convergence-\$\{\{ github\.repository \}\}/u,
  /production-promotion-candidate\.yml/u,
  /production-certified-release-cut-validation\.yml/u,
  /production-promotion-supporting-gates\.mjs/u,
  /production-promotion-release-cut-evidence\.mjs/u,
  /git merge-base --is-ancestor "\$RELEASE_CUT_SHA" "\$CURRENT_MAIN_SHA"/u,
  /git merge-base --is-ancestor "\$PRODUCTION_SHA" "\$RELEASE_CUT_SHA"/u,
  /candidate first parent is not release cut/u,
  /candidate tree differs from release cut/u,
  /Production moved during convergence/u,
  /main_tip_may_advance=true/u,
  /request evidence comment transport degraded/u,
  /validation evidence comment transport degraded/u,
]) assert.match(launcher, required);

assert.doesNotMatch(launcher, /source-pinned main moved during convergence/u);
assert.doesNotMatch(launcher, /MAX_ATTEMPTS=3/u);
assert.doesNotMatch(launcher, /gh pr merge/u);
assert.doesNotMatch(launcher, /contents:\s*write/u);

for (const gate of registry.gates) {
  assert.equal(gate.required, true);
  assert.equal(gate.effect, "read_only");
  assert.deepEqual(gate.modes, ["human", "ai_policy"]);
  assert.doesNotMatch(launcher, new RegExp(gate.workflow.replaceAll(".", "\\."), "u"), `launcher must not hardcode gate ${gate.workflow}`);
}
assert.equal((launcher.match(/jq -c '\.gates\[\]' "\$GATE_PLAN"/gu) ?? []).length, 2, "controller must dispatch all registered gates before a distinct wait pass");
assert.match(launcher, /SUPPORTING_RUNS='\{\}'/u);
assert.match(launcher, /dispatched supporting gate \$gate_id run=\$gate_run_id/u);

for (const required of [
  /trusted workflow source must contain the authorized release cut/u,
  /trusted workflow source must be tree-identical to the authorized release cut/u,
  /authorized release cut is no longer an ancestor of current main/u,
  /current Production contains commits not present in the authorized release cut/u,
  /git commit-tree "\$RELEASE_TREE" -p "\$RELEASE_CUT_SHA" -p "\$ACTUAL_PRODUCTION_SHA"/u,
  /candidate first parent is not the release cut/u,
  /tree_policy:"exact_release_cut_tree"/u,
  /main_tip_may_advance:true/u,
  /production_must_remain_stable:true/u,
  /test\(release\): certify immutable Production candidate/u,
]) assert.match(candidate, required);
assert.doesNotMatch(candidate, /ACTUAL_MAIN" != "\$EXPECTED_MAIN_SHA/u);
assert.doesNotMatch(candidate, /force/u);

for (const required of [
  /mad4b\.governed-production-main-source-pin-guard\.v3/u,
  /guard_scope:"release_cut_ancestry"/u,
  /compatible_release_cuts/u,
  /main_tip_may_advance:true/u,
  /preserving launcher run/u,
  /release_cut_ancestor=false/u,
]) assert.match(mainSourcePinGuard, required);
assert.doesNotMatch(mainSourcePinGuard, /gh pr merge/u);
assert.doesNotMatch(mainSourcePinGuard, /git push/u);

for (const required of [
  /mad4b\.governed-production-release-source-pin-gate\.v2/u,
  /certified release cut is not an ancestor of current main/u,
  /current Production contains commits absent from the certified release cut/u,
  /candidate first parent must be the certified release cut/u,
  /candidate tree differs from certified release cut/u,
  /release_cut_is_ancestor_of_current_main:true/u,
  /production_is_ancestor_of_release_cut:true/u,
  /main_tip_may_advance/u,
]) assert.match(releaseSourcePinGate, required);
assert.doesNotMatch(releaseSourcePinGate, /contents:\s*write/u);
assert.doesNotMatch(releaseSourcePinGate, /gh pr (?:comment|close|merge)/u);

for (const required of [
  /governed_production_promotion_convergence\.v2/u,
  /candidate_tree_matches_release_cut/u,
  /release_cut_is_ancestor_of_current_main/u,
  /production_is_ancestor_of_release_cut/u,
  /supporting_gates_success/u,
  /release_cut_not_in_current_main/u,
  /legacy_exact_main_moved_after_finalization/u,
  /candidate_first_parent_differs_from_release_cut/u,
  /new_authorization_required=true/u,
  /test\(release\): certify immutable Production candidate/u,
  /main_tip_may_advance=true/u,
]) assert.match(postFinalizationGuard, required);
assert.doesNotMatch(postFinalizationGuard, /REASON=main_moved_after_finalization/u);
assert.doesNotMatch(postFinalizationGuard, /gh pr reopen/u);

for (const required of [
  /name: Certified Production Release Cut Validation/u,
  /candidate first parent must be the certified release cut/u,
  /candidate tree differs from certified release cut/u,
  /certified release cut is not contained by current main/u,
  /Production moved during certified-cut validation/u,
  /schema_version: "certified_production_release_cut\.v1"/u,
  /exact_full_ci_success: true/u,
  /candidate_tree_matches_certified_cut: true/u,
  /certified_cut_is_ancestor_of_current_main: true/u,
  /candidate_contains_production: true/u,
  /production_ref_stable_during_validation: true/u,
  /main_tip_may_advance: true/u,
  /name: Syntax Check/u,
  /name: Unit & Integration Tests/u,
  /name: Execution Resolver Gate/u,
  /name: Architecture Drift Detection/u,
]) assert.match(certifiedReleaseCut, required);
assert.doesNotMatch(certifiedReleaseCut, /contents:\s*write/u);
assert.doesNotMatch(certifiedReleaseCut, /JWT_SECRET\s*:|TENANT_GPT_SSO_SIGNING_SECRET\s*:/u);

// Startup proof must remain hermetic even when CI and Certified use different
// orchestration surfaces. Both direct callers reach the same smoke harness, and
// the structured workflow reaches the same environment helper through the
// structured evidence reporter. This prevents workflow-level auth-env drift
// from reintroducing false-negative certification failures.
for (const directCaller of [ci, certifiedReleaseCut]) {
  assert.match(directCaller, /node test-server-startup-smoke\.mjs/u);
}
assert.match(runtimeStartupWorkflow, /node scripts\/runtime-startup-deployment-evidence\.mjs/u);
for (const implementation of [startupSmoke, runtimeStartupEvidence]) {
  assert.match(implementation, /runtime-startup-test-environment\.mjs/u);
  assert.match(implementation, /buildRuntimeStartupTestEnvironment/u);
}
for (const required of [
  /mad4b\.runtime-startup-test-environment\.v1/u,
  /JWT_SECRET/u,
  /TENANT_GPT_SSO_SIGNING_SECRET/u,
  /inherited_values_overridden: true/u,
  /credential_payload_read: false/u,
  /production_secret_source_used: false/u,
  /production_mutation_executed: false/u,
]) assert.match(runtimeStartupEnvironment, required);
for (const required of [
  /startup_test_environment_contract/u,
  /certification_contract_error/u,
  /runtime_startup_failure/u,
  /credential_payload_read: false/u,
]) assert.match(runtimeStartupEvidence, required);

for (const required of [
  /production-promotion-supporting-gates\.v1/u,
  /SECRETISH/u,
  /effect !== "read_only"/u,
  /production_merge/u,
  /migration_apply/u,
  /provider_mutation/u,
  /registry_sha256/u,
]) assert.match(gateResolver, required);

for (const required of [
  /governed_production_promotion_convergence\.v2/u,
  /main_advanced_after_release_cut/u,
  /candidate_tree_matches_release_cut: true/u,
  /release_cut_is_ancestor_of_current_main: true/u,
  /production_is_ancestor_of_release_cut: true/u,
  /main_tip_may_advance: true/u,
  /merge_executed: false/u,
  /deployment_executed: false/u,
  /migration_executed: false/u,
  /grant_executed: false/u,
  /provider_call_executed: false/u,
  /credential_payload_read: false/u,
  /secrets_included: false/u,
]) assert.match(evidenceHelper, required);
assert.doesNotMatch(evidenceHelper, /candidate_tree_matches_main: true/u);

console.log(JSON.stringify({
  contract: "mad4b.production-promotion-release-cut-convergence.v1",
  ok: true,
  release_mode: "certified_release_cut",
  main_tip_may_advance: true,
  production_must_remain_stable: true,
  supporting_gate_source: "declarative_registry",
  supporting_gate_count: registry.gates.length,
  supporting_gate_dispatch: "parallel_dispatch_then_wait",
  startup_test_environment: "hermetic_repository_local_fixture",
  inherited_startup_secret_values_overridden: true,
  comment_transport_authoritative: false,
  merge_executed: false,
  deployment_executed: false,
  migration_executed: false,
  provider_call_executed: false,
  credential_payload_read: false,
  secrets_included: false,
}));
