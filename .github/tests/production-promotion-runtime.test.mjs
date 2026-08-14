import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildReleaseCutPromotionEvidence } from "../scripts/production-promotion-release-cut-evidence.mjs";
import { resolveSupportingGates, validateGateRegistry } from "../scripts/production-promotion-supporting-gates.mjs";
import { selectPromotionRun } from "../scripts/production-promotion-run-selector.mjs";

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

test("supporting gate registry is bounded, read-only, and resolves release-branch inputs", () => {
  validateGateRegistry(registry);
  const plan = resolveSupportingGates(registry, {
    reviewMode: "ai_policy",
    releaseBranch: "release/production-cut-probe",
    candidateSha: sha(4),
  });
  assert.equal(plan.gates.length, 6);
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

  assert.match(launcher, /production-promotion-supporting-gates\.mjs/u);
  assert.match(launcher, /production-certified-release-cut-validation\.yml/u);
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
