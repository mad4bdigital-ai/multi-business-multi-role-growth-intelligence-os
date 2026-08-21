import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildReleaseCutPromotionEvidence } from "../scripts/production-promotion-release-cut-evidence.mjs";
import { resolveSupportingGates, validateGateRegistry } from "../scripts/production-promotion-supporting-gates.mjs";
import { buildPromotionRehearsalReport } from "../scripts/production-promotion-rehearsal.mjs";
import { buildReleaseCutReconciliationReport } from "../scripts/production-release-cut-reconciliation.mjs";
import { selectPromotionRun } from "../scripts/production-promotion-run-selector.mjs";
import {
  buildApprovalManifest,
  buildOperationId,
  buildStateEnvelope,
  buildSurfaceNames,
} from "../scripts/production-promotion-operation-state.mjs";
import { resolveR7Decision } from "../scripts/production-r7-decision.mjs";

const sha = (digit) => String(digit).repeat(40);
const digest = "a".repeat(64);
const run = (id, createdAt, status, conclusion, headSha = sha(1), event = "workflow_dispatch") => ({
  databaseId: id,
  createdAt,
  status,
  conclusion,
  headSha,
  event,
});
const root = new URL("../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
const registry = JSON.parse(read(".github/contracts/production-promotion-supporting-gates.v1.json"));
const constitution = JSON.parse(read("http-generic-api/config/repository-governance-constitution.json"));
const derivedStateGovernance = JSON.parse(read(".github/derived-state-governance.json"));
const productionPromotionContract = JSON.parse(read(".changes/e2e/production-promotion-release-cut-controller.json"));

function evidenceInput() {
  return {
    review_mode: "ai_policy",
    request_pr: "7300",
    release_pr: "7301",
    validation_pr: "7302",
    release_cut_sha: sha(1),
    current_main_sha: sha(2),
    production_sha: sha(3),
    candidate_sha: sha(4),
    builder_run_id: "100",
    certified_validation_run_id: "101",
    gate_registry_sha256: digest,
    supporting_runs: Object.fromEntries(registry.gates.map((gate, index) => [gate.id, String(200 + index)])),
  };
}

test("operation identity is deterministic and surface names are idempotent", () => {
  const releaseCutSha = sha(1);
  const productionSha = sha(2);
  assert.equal(buildOperationId({ releaseCutSha, productionSha }), `promo-${releaseCutSha.slice(0, 12)}-${productionSha.slice(0, 12)}`);
  const first = buildSurfaceNames({
    releaseBranchPrefix: "release/production-candidate",
    validationBranchPrefix: "gpt/validate-production-candidate",
    validationBaseBranchPrefix: "gpt/validate-production-base",
    releaseCutSha,
    productionSha,
  });
  const second = buildSurfaceNames({
    releaseBranchPrefix: "release/production-candidate",
    validationBranchPrefix: "gpt/validate-production-candidate",
    validationBaseBranchPrefix: "gpt/validate-production-base",
    releaseCutSha,
    productionSha,
  });
  assert.deepEqual(first, second);
  assert.doesNotMatch(first.releaseBranch, /-[0-9]+-[0-9]+-[0-9]+$/u);
});

test("operation envelope and approval manifest are fail-closed and mutation-free", () => {
  const operation = buildStateEnvelope({ releaseCutSha: sha(1), productionSha: sha(2), state: "SUPPORTING_GATES_RUNNING" });
  assert.equal(operation.schema_version, "governed_production_promotion_operation.v1");
  assert.equal(operation.mutation_summary.production_merge, false);
  const manifest = buildApprovalManifest({
    operation,
    requiredRuns: [{ runId: 123, workflow: "CI", url: "https://github.com/example/run/123" }],
  });
  assert.equal(manifest.state, "SUPPORTING_GATES_RUNNING");
  assert.equal(manifest.approvals_required[0].safe_scope, "read_only_supporting_gate");
  assert.equal(manifest.merge_executed, false);
  assert.throws(() => buildStateEnvelope({ releaseCutSha: "short", productionSha: sha(2) }), /releaseCutSha/u);
  assert.throws(() => buildStateEnvelope({ releaseCutSha: sha(1), productionSha: sha(2), state: "UNKNOWN" }), /unsupported promotion state/u);
});

test("R7 decision accepts only exact Production runtime identity and classifies pending activation", () => {
  const expectedSha = sha(7);
  const base = {
    expectedSha,
    statuses: {
      health: 200,
      version: 200,
      deployment_info: 200,
      connector_agent_version: 200,
      mcp_protected_resource: 200,
      mcp_authorization_server: 200,
    },
    versionShas: [expectedSha],
    runtimeSha: expectedSha,
    runtimeBranch: "Production",
    protectedResource: {
      resource: "https://mcp.mad4b.com",
      authorization_servers: ["https://auth.mad4b.com/auth/mcp"],
      trusted_ingress: { ready: true },
    },
    authorizationServer: {
      issuer: "https://auth.mad4b.com/auth/mcp",
      authorization_endpoint: "https://auth.mad4b.com/auth/mcp/oauth/authorize",
      token_endpoint: "https://auth.mad4b.com/auth/mcp/oauth/token",
      trusted_ingress: { ready: true },
    },
  };
  assert.equal(resolveR7Decision(base).classification, "production_current");
  assert.equal(resolveR7Decision({ ...base, runtimeSha: sha(8), versionShas: [] }).classification, "runtime_activation_pending_or_sha_mismatch");
  assert.equal(resolveR7Decision({ ...base, runtimeBranch: "main" }).classification, "runtime_sha_current_branch_provenance_mismatch");
  assert.throws(() => resolveR7Decision({ ...base, expectedSha: "short" }), /expectedSha/u);
});

test("supporting gate registry is bounded, read-only, and resolves release-branch inputs", () => {
  validateGateRegistry(registry);
  const plan = resolveSupportingGates(registry, {
    reviewMode: "ai_policy",
    releaseBranch: "release/production-cut-probe",
    candidateSha: sha(4),
  });
  assert.equal(plan.gates.length, 7);
  assert.ok(plan.gates.every((gate) => gate.required === true && gate.effect === "read_only"));
  assert.equal(plan.gates.find((gate) => gate.id === "http_generic_api_fanout_relocation").inputs.target_branch, "release/production-cut-probe");
  assert.equal(plan.safety.production_merge, false);
  assert.equal(plan.safety.deployment, false);
  assert.equal(plan.safety.migration_apply, false);
  assert.equal(plan.safety.provider_mutation, false);
});

test("release-cut evidence remains truthful when current main advances", () => {
  const evidence = buildReleaseCutPromotionEvidence(evidenceInput());
  assert.equal(evidence.schema_version, "governed_production_promotion_convergence.v2");
  assert.equal(evidence.release_mode, "certified_release_cut");
  assert.equal(evidence.main_advanced_after_release_cut, true);
  assert.equal(evidence.candidate_tree_matches_release_cut, true);
  assert.equal(evidence.release_cut_is_ancestor_of_current_main, true);
  assert.equal(evidence.production_is_ancestor_of_release_cut, true);
  assert.equal(evidence.main_tip_may_advance, true);
  assert.equal(Object.hasOwn(evidence, "candidate_tree_matches_main"), false);
  assert.equal(evidence.merge_executed, false);
  assert.equal(evidence.deployment_executed, false);
  assert.equal(evidence.migration_executed, false);
  assert.equal(evidence.provider_call_executed, false);
  assert.equal(evidence.credential_payload_read, false);
});

test("release-cut helpers fail closed on unsafe policy or identity", () => {
  assert.throws(() => resolveSupportingGates({ ...registry, safety: { ...registry.safety, production_merge: true } }, {
    reviewMode: "ai_policy",
    releaseBranch: "release/probe",
    candidateSha: sha(4),
  }), /production_merge/u);
  assert.throws(() => resolveSupportingGates(registry, {
    reviewMode: "robot",
    releaseBranch: "release/probe",
    candidateSha: sha(4),
  }), /review mode/u);
  assert.throws(() => buildReleaseCutPromotionEvidence({ ...evidenceInput(), candidate_sha: "short" }), /candidate_sha/u);
});

test("promotion rehearsal classifies real ancestry blockers without relaxing fail-closed policy", () => {
  const blocked = buildPromotionRehearsalReport({
    mainSha: sha(1),
    productionSha: sha(2),
    productionIsAncestorOfMain: false,
    protectedRefsStable: true,
    supportingGatesReadOnly: true,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.stage, "BLOCKED_PRODUCTION_HISTORY_NOT_CONTAINED_BY_MAIN");
  assert.equal(blocked.classification, "production_history_not_contained_by_main");
  assert.equal(blocked.fail_closed.stale_authorization_reusable, false);
  assert.match(blocked.fail_closed.required_next_action, /ancestry reconciliation/u);
  assert.equal(blocked.mutation_summary.production_merge, false);

  const casBlocked = buildPromotionRehearsalReport({
    mainSha: sha(1),
    productionSha: sha(2),
    productionIsAncestorOfMain: true,
    protectedRefsStable: false,
    supportingGatesReadOnly: true,
  });
  assert.equal(casBlocked.classification, "protected_ref_moved_during_rehearsal");
  assert.equal(casBlocked.stage, "BLOCKED_CAS_RECHECK_REQUIRED");

  const ready = buildPromotionRehearsalReport({
    mainSha: sha(1),
    productionSha: sha(2),
    productionIsAncestorOfMain: true,
    protectedRefsStable: true,
    supportingGatesReadOnly: true,
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.stage, "READY_FOR_CERTIFIED_CANDIDATE_REHEARSAL");
  assert.equal(ready.operation.retry_is_idempotent, true);
  assert.equal(ready.operation.cas_recheck_required_before_mutation, true);
  assert.equal(ready.mutation_summary.external_write, false);
});

test("run selector still prefers terminal exact-head success over a newer queued duplicate", () => {
  const selected = selectPromotionRun([
    run("100", "2026-08-14T17:15:00Z", "completed", "success"),
    run("101", "2026-08-14T17:16:00Z", "queued", "", sha(1)),
  ], { earliest: "2026-08-14T17:14:20Z", headSha: sha(1), event: "workflow_dispatch" });
  assert.equal(selected.databaseId, "100");
});

test("controller uses certified immutable cuts and a declarative supporting-gate registry", () => {
  const launcher = read(".github/workflows/governed-production-promotion-request-launcher.yml");
  const candidate = read(".github/workflows/production-promotion-candidate.yml");
  const mainGuard = read(".github/workflows/governed-production-main-source-pin-guard.yml");
  const releaseGate = read(".github/workflows/governed-production-release-source-pin-gate.yml");
  const postGuard = read(".github/workflows/governed-production-promotion-post-finalization-guard.yml");
  const rehearsal = read(".github/workflows/production-promotion-rehearsal.yml");
  const rehearsalScript = read(".github/scripts/production-promotion-rehearsal.mjs");
  const derivedClosure = read(".github/workflows/derived-state-closure.yml");
  const stagingEligibility = read(".github/workflows/staging-main-deploy-eligibility.yml");
  const stagingCertification = read(".github/workflows/staging-live-certification.yml");
  const reconciliationWorkflow = read(".github/workflows/governed-production-promotion-dispatch-bridge.yml");
  const reconciliationScript = read(".github/scripts/production-release-cut-reconciliation.mjs");

  assert.match(launcher, /production-promotion-supporting-gates\.mjs/u);
  assert.match(launcher, /production-certified-release-cut-validation\.yml/u);
  assert.match(launcher, /OPERATION_ID="promo-/u);
  assert.match(launcher, /reusing existing idempotent promotion surfaces/u);
  assert.match(launcher, /approval-manifest\.json/u);
  assert.match(launcher, /select\(\.head_sha == \$cut\)/u);
  assert.match(launcher, /--arg cut "\$RELEASE_CUT_SHA"/u);
  const r7 = read(".github/workflows/hostinger-production-runtime-readback-r7.yml");
  assert.match(r7, /production-r7-decision\.mjs/u);
  assert.match(r7, /public_get_only: true/u);
  assert.doesNotMatch(r7, /curl[^\n]*(POST|initialize)/iu);
  assert.match(launcher, /main_tip_may_advance=true/u);
  assert.match(launcher, /release cut is no longer contained by current main/u);
  assert.doesNotMatch(launcher, /source-pinned main moved during convergence/u);
  for (const gate of registry.gates) {
    assert.doesNotMatch(launcher, new RegExp(gate.workflow.replaceAll(".", "\\."), "u"), `launcher must not hardcode ${gate.workflow}`);
  }

  assert.match(candidate, /git merge-base --is-ancestor "\$RELEASE_CUT_SHA" "\$CURRENT_MAIN_SHA"/u);
  assert.match(candidate, /git commit-tree "\$RELEASE_TREE" -p "\$RELEASE_CUT_SHA" -p "\$ACTUAL_PRODUCTION_SHA"/u);
  assert.match(candidate, /test\(release\): certify immutable Production candidate/u);
  assert.match(mainGuard, /guard_scope:"release_cut_ancestry"/u);
  assert.match(mainGuard, /preserving launcher run/u);
  assert.match(releaseGate, /release_cut_is_ancestor_of_current_main:true/u);
  assert.match(postGuard, /release_cut_not_in_current_main/u);
  assert.doesNotMatch(postGuard, /REASON=main_moved_after_finalization/u);
  assert.match(rehearsal, /REHEARSE_GOVERNED_PRODUCTION_PROMOTION/u);
  assert.match(rehearsal, /production-promotion-rehearsal\.mjs/u);
  assert.match(rehearsal, /mutation_summary\.production_merge == false/u);
  assert.match(rehearsal, /\.ok == true/u);
  assert.doesNotMatch(rehearsal, /if: github\.event_name/u);
  assert.match(rehearsal, /persist-credentials: false/u);
  assert.match(rehearsal, /MAIN_CAS_READBACK/u);
  assert.match(rehearsal, /PRODUCTION_CAS_READBACK/u);
  assert.doesNotMatch(rehearsal, /git push|gh pr create|gh workflow run/u);
  assert.match(rehearsalScript, /production_history_not_contained_by_main/u);
  assert.match(rehearsalScript, /stale_authorization_reusable: false/u);
  assert.match(reconciliationWorkflow, /release\/production-reconciliation\//u);
  assert.match(reconciliationWorkflow, /commit-tree/u);
  assert.ok(reconciliationWorkflow.includes('-p "$main_sha" -p "$production_sha"'));
  assert.match(reconciliationWorkflow, /merge_method_required: merge_commit_only/u);
  assert.match(reconciliationWorkflow, /production_merge: false/u);
  assert.match(reconciliationWorkflow, /persist-credentials: false/u);
  assert.doesNotMatch(reconciliationWorkflow, /gh pr merge|gh api --method PUT[^\n]*\/merge/u);
  assert.match(reconciliationScript, /first_parent_is_main/u);
  assert.match(reconciliationScript, /second_parent_is_production/u);
  assert.match(reconciliationScript, /tree_matches_main/u);
  const impact = productionPromotionContract.environment_impact;
  assert.equal(impact.source_of_truth, "http-generic-api/config/deployment-branch-policy.json");
  assert.deepEqual(new Set(impact.declared_targets), new Set(["staging", "production"]));
  assert.equal(impact.cross_environment_reviewed, true);
  assert.equal(impact.live_staging_certification_required, true);
  assert.equal(impact.production_mutation_allowed, false);
  const semanticClass = constitution.semantic_executable_classes.find((entry) => entry.id === "production_promotion_governance");
  assert.ok(semanticClass?.patterns.includes(".github/scripts/production-promotion-*.mjs"));
  for (const controlPath of [
    ".changes/e2e/production-promotion-release-cut-controller.json",
    ".github/scripts/production-promotion-rehearsal.mjs",
    ".github/workflows/production-promotion-rehearsal.yml",
    ".github/scripts/production-release-cut-reconciliation.mjs",
    ".github/workflows/governed-production-promotion-dispatch-bridge.yml",
  ]) {
    assert.ok(constitution.control_plane_paths.includes(controlPath));
    assert.ok(derivedStateGovernance.convergence.automation_control_paths.includes(controlPath));
  }
  for (const workflow of [derivedClosure, stagingEligibility, stagingCertification]) {
    assert.match(workflow, /environment-impact-closure\.mjs/u, "environment impact closure must be wired into every staging/promotion readiness surface");
    assert.match(workflow, /migration compatibility closure/u, "migration compatibility must be explicit in the readiness step");
  }
});

test("release-cut reconciliation requires exact main and Production parents with an exact main tree", () => {
  const input = {
    mainSha: sha(1),
    productionSha: sha(2),
    reconciliationSha: sha(3),
    mainTreeSha: sha(5),
    reconciliationTreeSha: sha(5),
    parents: [sha(1), sha(2)],
    currentMainSha: sha(4),
    currentProductionSha: sha(2),
    protectedRefsStable: true,
  };
  const report = buildReleaseCutReconciliationReport(input);
  assert.equal(report.ok, true);
  assert.equal(report.first_parent_is_main, true);
  assert.equal(report.second_parent_is_production, true);
  assert.equal(report.tree_matches_main, true);
  assert.equal(report.merge_method_required, "merge_commit_only");
  assert.equal(report.main_merge_required, true);
  assert.equal(report.production_merge, false);
  assert.equal(report.deployment_executed, false);
  assert.equal(report.migration_executed, false);
  assert.equal(report.secrets_included, false);
  const wrongParent = buildReleaseCutReconciliationReport({ ...input, parents: [sha(2), sha(1)] });
  assert.equal(wrongParent.ok, false);
  assert.equal(wrongParent.fail_closed.stale_authorization_reusable, false);
  const wrongTree = buildReleaseCutReconciliationReport({ ...input, reconciliationTreeSha: sha(6) });
  assert.equal(wrongTree.ok, false);
  assert.equal(wrongTree.fail_closed.mutation_allowed, false);
});

console.log(JSON.stringify({
  contract: "mad4b.production-promotion-release-cut-runtime-regression.v1",
  ok: true,
  release_mode: "certified_release_cut",
  supporting_gate_source: "declarative_registry",
  main_tip_may_advance: true,
  production_merge: false,
  deployment: false,
  migrations: false,
  grants: false,
  provider_mutation: false,
  secrets_included: false,
}));
