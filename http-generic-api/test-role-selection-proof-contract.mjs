import assert from "node:assert/strict";
import test from "node:test";
import { buildHostBreakglassPlan } from "./hostBreakglassCatalog.js";
import { readRuntimeBootstrapContract, validateRoleRebuildConfirmation } from "./runtimeBootstrapContract.js";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";

const SHA = "a".repeat(40);
const TARGET_KEY = "production-runtime";
const CONTRACT = readRuntimeBootstrapContract();

const INPUT_PROOF = {
  source: "durable_full_inspection",
  inspection_run_id: "inspection-cross-module-proof",
  finding_ids: ["finding:0123456789abcdef0123456789abcdef"],
  inspection_evidence_hash: "b".repeat(64),
  composite_target_fingerprint: "c".repeat(64),
  expected_sha: SHA,
  selected_roles: ["runtime_persistence", "governance"],
  role_object_count_fingerprints: { governance: "d".repeat(64), runtime_persistence: "e".repeat(64) },
};

const PLAN = buildHostBreakglassPlan({
  operation_key: "database.rebuild_empty",
  action: "apply_migration",
  expected_sha: SHA,
  target_key: TARGET_KEY,
  migration: "",
  role_selection_proof: INPUT_PROOF,
  confirmation: `APPLY_HOSTINGER_RUNTIME_BASELINE_REBUILD:${SHA}:${TARGET_KEY}:governance,runtime_persistence`,
});

function runtimeEnvironmentFromPlan(plan = PLAN) {
  const proof = plan.role_selection_proof;
  return {
    BOOTSTRAP_ROLE_SELECTION: plan.selected_rebuild_roles.join(","),
    BOOTSTRAP_INSPECTION_RUN_ID: proof.inspection_run_id,
    BOOTSTRAP_PLAN_SHA256: plan.plan_sha256,
    BOOTSTRAP_ROLE_SELECTION_HASH: proof.selection_hash,
    BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS: JSON.stringify({
      source: proof.source,
      expected_sha: proof.expected_sha,
      inspection_evidence_hash: proof.inspection_evidence_hash,
      finding_ids: proof.finding_ids,
      role_object_count_fingerprints: proof.role_object_count_fingerprints,
      composite_target_fingerprint: proof.composite_target_fingerprint,
    }),
    BOOTSTRAP_REBUILD_CONFIRMATION: plan.confirmation,
  };
}

function validate(env) {
  return validateRoleRebuildConfirmation(env, SHA, { key: TARGET_KEY }, CONTRACT);
}

function tamperNestedProof(env, mutate) {
  const copy = { ...env };
  const proof = JSON.parse(copy.BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS);
  mutate(copy, proof);
  copy.BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS = JSON.stringify(proof);
  return copy;
}

test("Host Breakglass rich role proof validates in runtime bootstrap with one canonical hash", () => {
  const env = runtimeEnvironmentFromPlan();
  const verified = validate(env);
  assert.deepEqual(verified.selected_roles, ["governance", "runtime_persistence"]);
  assert.equal(verified.selection_hash, PLAN.role_selection_proof.selection_hash);
  assert.equal(verified.selection_hash, computeRoleSelectionProofHash({
    source: PLAN.role_selection_proof.source,
    expected_sha: PLAN.role_selection_proof.expected_sha,
    selected_roles: PLAN.selected_rebuild_roles,
    inspection_run_id: PLAN.role_selection_proof.inspection_run_id,
    inspection_evidence_hash: PLAN.role_selection_proof.inspection_evidence_hash,
    finding_ids: PLAN.role_selection_proof.finding_ids,
    role_object_count_fingerprints: PLAN.role_selection_proof.role_object_count_fingerprints,
    composite_target_fingerprint: PLAN.role_selection_proof.composite_target_fingerprint,
  }));
});

test("Host Breakglass rich role proof rejects tampering before execution", () => {
  const base = runtimeEnvironmentFromPlan();
  const cases = [
    ["selected_roles", (env) => { env.BOOTSTRAP_ROLE_SELECTION = "runtime_persistence"; }, "bootstrap_rebuild_role_selection_hash_mismatch"],
    ["inspection_run_id", (env) => { env.BOOTSTRAP_INSPECTION_RUN_ID = "inspection-tampered"; }, "bootstrap_rebuild_role_selection_hash_mismatch"],
    ["selection_hash", (env) => { env.BOOTSTRAP_ROLE_SELECTION_HASH = "f".repeat(64); }, "bootstrap_rebuild_role_selection_hash_mismatch"],
    ["expected_sha", (env, proof) => { proof.expected_sha = "b".repeat(40); }, "bootstrap_rebuild_proof_sha_mismatch"],
    ["inspection_evidence_hash", (env, proof) => { proof.inspection_evidence_hash = "f".repeat(64); }, "bootstrap_rebuild_role_selection_hash_mismatch"],
    ["finding_ids", (env, proof) => { proof.finding_ids = ["finding:fedcba9876543210fedcba9876543210"]; }, "bootstrap_rebuild_role_selection_hash_mismatch"],
    ["role_object_count_fingerprints", (env, proof) => { proof.role_object_count_fingerprints.governance = "f".repeat(64); }, "bootstrap_rebuild_role_selection_hash_mismatch"],
    ["composite_target_fingerprint", (env, proof) => { proof.composite_target_fingerprint = "f".repeat(64); }, "bootstrap_rebuild_role_selection_hash_mismatch"],
  ];
  for (const [label, mutate, code] of cases) {
    const tampered = label === "selected_roles" || label === "inspection_run_id" || label === "selection_hash"
      ? (() => { const env = { ...base }; mutate(env); return env; })()
      : tamperNestedProof(base, mutate);
    assert.throws(() => validate(tampered), (error) => error?.code === code, `${label} tampering must fail closed`);
  }
});
