import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSemanticContinuityReport } from "../.github/scripts/production-promotion-semantic-continuity.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const launcher = read(".github/workflows/governed-production-promotion-request-launcher.yml");
const candidate = read(".github/workflows/production-promotion-candidate.yml");
const mainSourcePinGuard = read(".github/workflows/governed-production-main-source-pin-guard.yml");
const releaseSourcePinGate = read(".github/workflows/governed-production-release-source-pin-gate.yml");
const postFinalizationGuard = read(".github/workflows/governed-production-promotion-post-finalization-guard.yml");
const certifiedReleaseCut = read(".github/workflows/production-certified-release-cut-validation.yml");
const semanticImpactGuard = read(".github/workflows/production-promotion-impact-guard.yml");
const semanticSourcePinGate = read(".github/workflows/production-promotion-semantic-source-pin-gate.yml");
const semanticContinuityHelper = read(".github/scripts/production-promotion-semantic-continuity.mjs");
const ci = read(".github/workflows/ci.yml");
const runtimeStartupWorkflow = read(".github/workflows/runtime-startup-deployment-evidence.yml");
const startupSmoke = read("http-generic-api/test-server-startup-smoke.mjs");
const runtimeStartupEvidence = read("http-generic-api/scripts/runtime-startup-deployment-evidence.mjs");
const runtimeStartupEnvironment = read("http-generic-api/scripts/runtime-startup-test-environment.mjs");
const gateResolver = read(".github/scripts/production-promotion-supporting-gates.mjs");
const evidenceHelper = read(".github/scripts/production-promotion-release-cut-evidence.mjs");
const registry = JSON.parse(read(".github/contracts/production-promotion-supporting-gates.v1.json"));

const object = (digit) => String(digit).repeat(40);
const treeEntry = (path, digit) => ({ path, mode: "100644", type: "blob", object: object(digit) });
const deploymentPolicy = (extraSharedPatterns = []) => ({
  schema_version: "mad4b.deployment-branch-policy.v1",
  environment_impact: {
    fail_closed: { unclassified_paths: true },
    source_of_truth_paths: [
      "http-generic-api/config/deployment-branch-policy.json",
      "http-generic-api/config/domain-family-policy.json",
    ],
    path_classes: [
      {
        id: "shared_runtime",
        patterns: ["http-generic-api/routes/**", ...extraSharedPatterns],
        environments: ["staging", "production"],
        requires_live_certification: true,
      },
      {
        id: "repository_governance",
        patterns: [".github/**", "docs/**"],
        environments: ["repository"],
        requires_live_certification: false,
      },
    ],
  },
});

{
  const releasePolicy = deploymentPolicy();
  const baseTree = [
    treeEntry("README.md", 1),
    treeEntry("http-generic-api/routes/a.js", 2),
    treeEntry(".github/workflows/ci.yml", 3),
  ];

  const docsOnly = buildSemanticContinuityReport({
    releaseCutSha: object("a"),
    currentMainSha: object("b"),
    releasePolicy,
    currentPolicy: releasePolicy,
    releaseTree: baseTree,
    currentTree: [
      treeEntry("README.md", 9),
      treeEntry("http-generic-api/routes/a.js", 2),
      treeEntry(".github/workflows/ci.yml", 3),
    ],
  });
  assert.equal(docsOnly.semantic_continuity, true, "README-only main advancement must not invalidate a release cut");
  assert.equal(docsOnly.changed_sensitive_path_count, 0);

  const runtimeChange = buildSemanticContinuityReport({
    releaseCutSha: object("a"),
    currentMainSha: object("b"),
    releasePolicy,
    currentPolicy: releasePolicy,
    releaseTree: baseTree,
    currentTree: [
      treeEntry("README.md", 1),
      treeEntry("http-generic-api/routes/a.js", 8),
      treeEntry(".github/workflows/ci.yml", 3),
    ],
  });
  assert.equal(runtimeChange.semantic_continuity, false, "shared runtime changes must invalidate an older release cut");
  assert.ok(runtimeChange.changed_sensitive_paths.some((entry) => entry.path === "http-generic-api/routes/a.js"));

  const governanceChange = buildSemanticContinuityReport({
    releaseCutSha: object("a"),
    currentMainSha: object("b"),
    releasePolicy,
    currentPolicy: releasePolicy,
    releaseTree: baseTree,
    currentTree: [
      treeEntry("README.md", 1),
      treeEntry("http-generic-api/routes/a.js", 2),
      treeEntry(".github/workflows/ci.yml", 7),
    ],
  });
  assert.equal(governanceChange.semantic_continuity, false, "certification/governance workflow changes must invalidate an older release cut");

  const oldPolicy = deploymentPolicy();
  const newPolicy = deploymentPolicy(["http-generic-api/services/**"]);
  const policyExpansion = buildSemanticContinuityReport({
    releaseCutSha: object("a"),
    currentMainSha: object("b"),
    releasePolicy: oldPolicy,
    currentPolicy: newPolicy,
    releaseTree: [
      treeEntry("http-generic-api/services/localManagerDeviceLinkService.js", 4),
      treeEntry("http-generic-api/config/deployment-branch-policy.json", 5),
    ],
    currentTree: [
      treeEntry("http-generic-api/services/localManagerDeviceLinkService.js", 6),
      treeEntry("http-generic-api/config/deployment-branch-policy.json", 7),
    ],
  });
  assert.equal(policyExpansion.semantic_continuity, false, "new Production-sensitive policy patterns must apply across the old/new policy union");
  assert.ok(policyExpansion.changed_sensitive_paths.some((entry) => entry.path === "http-generic-api/services/localManagerDeviceLinkService.js"));
}

assert.doesNotMatch(semanticContinuityHelper, /node:child_process|execFileSync|spawnSync|execSync/u);
assert.match(semanticContinuityHelper, /union_of_release_and_current_deployment_policy_plus_fixed_control_plane_floor/u);
assert.match(semanticContinuityHelper, /production_relevant_main_advance/u);
assert.match(semanticContinuityHelper, /fresh_governed_release_cut_required/u);

for (const required of [
  /name: Production Promotion Semantic Impact Guard/u,
  /branches: \[main\]/u,
  /git show "\$\{BASE_SHA\}:\$\{EVALUATOR_PATH\}"/u,
  /promotion_surface_changed/u,
  /merge to main blocked by impact alone/u,
  /older release cuts invalidated after an impacting merge/u,
  /contents: read/u,
]) assert.match(semanticImpactGuard, required);
assert.doesNotMatch(semanticImpactGuard, /contents:\s*write|actions:\s*write|pull-requests:\s*write|gh pr |gh api --method/u);

for (const required of [
  /name: Production Promotion Semantic Source-Pin Gate/u,
  /pull_request_target:/u,
  /branches: \[Production\]/u,
  /Checkout exact trusted current main evaluator/u,
  /production-promotion-semantic-continuity\.mjs/u,
  /semantic_continuity == true/u,
  /fresh governed release cut/u,
  /current Production is not contained by certified release cut/u,
]) assert.match(semanticSourcePinGate, required);
assert.doesNotMatch(semanticSourcePinGate, /contents:\s*write|actions:\s*write|pull-requests:\s*write|gh pr (?:comment|close|merge)|git push/u);

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
  /candidate_has_exact_topology\(\)/u,
  /git commit-tree "\$RELEASE_TREE" -p "\$RELEASE_CUT_SHA" -p "\$ACTUAL_PRODUCTION_SHA"/u,
  /candidate_has_exact_topology "\$PREVIOUS_RELEASE" "\$RELEASE_CUT_SHA" "\$ACTUAL_PRODUCTION_SHA"/u,
  /candidate must have exactly two parents: release cut first and pinned Production second/u,
  /candidate topology changed before ref publication/u,
  /candidate_parent_count:2/u,
  /candidate_first_parent_is_release_cut:true/u,
  /candidate_second_parent_is_pinned_production:true/u,
  /tree_policy:"exact_release_cut_tree"/u,
  /main_tip_may_advance:true/u,
  /production_must_remain_stable:true/u,
  /test\(release\): certify immutable Production candidate/u,
]) assert.match(candidate, required);
assert.doesNotMatch(candidate, /ACTUAL_MAIN" != "\$EXPECTED_MAIN_SHA/u);
assert.doesNotMatch(candidate, /--force(?:-with-lease)?|\s-f\s/u);

for (const required of [
  /mad4b\.governed-production-main-source-pin-guard\.v4/u,
  /guard_scope:"release_cut_ancestry_and_semantic_continuity"/u,
  /semantic_continuity_holds/u,
  /Production promotion digest is unchanged/u,
  /production_relevant_main_advance/u,
  /fresh_governed_release_cut_required=true/u,
  /main_advance_requires_semantic_continuity:true/u,
  /promotion_surface_digest_required:true/u,
]) assert.match(mainSourcePinGuard, required);
assert.doesNotMatch(mainSourcePinGuard, /gh pr merge/u);
assert.doesNotMatch(mainSourcePinGuard, /git push/u);
assert.match(mainSourcePinGuard, /gh pr close "\$pr_number"/u);
assert.match(mainSourcePinGuard, /closed_stale_release_pr_numbers/u);

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
  /candidate must have exactly two parents: certified release cut first and pinned Production second/u,
  /candidate first parent must be the certified release cut/u,
  /candidate second parent must be the exact pinned Production SHA/u,
  /candidate tree differs from certified release cut/u,
  /certified release cut is not contained by current main/u,
  /current Production is not contained by the certified release cut/u,
  /Production moved during certified-cut validation/u,
  /candidate parent count drifted during certified-cut validation/u,
  /candidate second parent drifted from pinned Production/u,
  /schema_version: "certified_production_release_cut\.v1"/u,
  /exact_full_ci_success: true/u,
  /candidate_parent_count: 2/u,
  /candidate_first_parent_is_certified_cut: true/u,
  /candidate_second_parent_is_pinned_production: true/u,
  /candidate_tree_matches_certified_cut: true/u,
  /certified_cut_is_ancestor_of_current_main: true/u,
  /production_is_ancestor_of_certified_cut: true/u,
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
  contract: "mad4b.production-promotion-release-cut-convergence.v2",
  ok: true,
  release_mode: "certified_release_cut",
  exact_candidate_parent_count: 2,
  exact_second_parent_pinned_production: true,
  main_tip_may_advance: true,
  main_advance_requires_semantic_continuity: true,
  production_promotion_semantic_guard: true,
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
