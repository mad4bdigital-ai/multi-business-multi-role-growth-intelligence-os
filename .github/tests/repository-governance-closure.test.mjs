import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const constitutionPath = "http-generic-api/config/repository-governance-constitution.json";
const policyRegistryPath = ".github/governance/policy-registry.json";
const derivedRegistryPath = ".github/derived-state-governance.json";
const workflowPath = ".github/workflows/derived-state-closure.yml";
const scriptPath = "scripts/repository-governance-closure.mjs";

const constitution = JSON.parse(fs.readFileSync(path.join(root, constitutionPath), "utf8"));
const policyRegistry = JSON.parse(fs.readFileSync(path.join(root, policyRegistryPath), "utf8"));
const derivedRegistry = JSON.parse(fs.readFileSync(path.join(root, derivedRegistryPath), "utf8"));
const workflow = fs.readFileSync(path.join(root, workflowPath), "utf8");
const script = fs.readFileSync(path.join(root, scriptPath), "utf8");

assert.equal(constitution.contract, "mad4b.repository-governance-constitution.v1");
assert.equal(constitution.authority.source_of_truth, constitutionPath);
assert.equal(constitution.authority.final_gate_context, "Derived State Closure");
assert.equal(constitution.authority.policy_registry, policyRegistryPath);
assert.equal(constitution.authority.change_identity, "git_base_candidate_tree");
assert.equal(constitution.authority.unknown_surface_mode, "block");
assert.equal(constitution.authority.unknown_executable_mode, "block");
assert.equal(constitution.authority.deletion_and_rename_impact_required, true);
assert.equal(constitution.authority.derived_state_graph_mode, "executable_dag");
assert.equal(constitution.authority.policy_execution_mode, "declarative_registered_assertions");
assert.equal(constitution.authority.server_enforcement_attestation, "required_before_merge");
assert.equal(constitution.change_model.added_path_newness_must_come_from_git, true);
assert.equal(constitution.change_model.filename_age_heuristics_forbidden, true);
assert.equal(constitution.change_model.rename_and_copy_source_must_be_classified, true);
assert.equal(constitution.change_model.rename_and_copy_target_must_be_classified, true);

assert.equal(policyRegistry.contract, "mad4b.repository-governance-policy-registry.v1");
assert.equal(policyRegistry.execution_model, "declarative_registered_assertions");
const allowedAssertions = new Set(["metric_zero", "flag_true"]);
assert.deepEqual(new Set(policyRegistry.allowed_assertion_types), allowedAssertions);
const policyIds = policyRegistry.policies.map((policy) => policy.id);
assert.equal(new Set(policyIds).size, policyIds.length, "policy IDs must be unique");
for (const requiredPolicy of [
  "governance-authority-consistency",
  "unknown-surface-gate",
  "unknown-executable-gate",
  "git-native-change-identity",
  "deletion-rename-impact-closure",
  "derived-state-dag-integrity",
  "control-plane-self-registration",
  "policy-registry-integrity",
]) {
  assert.equal(policyIds.includes(requiredPolicy), true, `missing policy ${requiredPolicy}`);
}
for (const policy of policyRegistry.policies) {
  assert.equal(policy.severity, "blocking", `${policy.id} must remain blocking`);
  assert.ok(Array.isArray(policy.assertions) && policy.assertions.length > 0, `${policy.id} requires assertions`);
  for (const assertion of policy.assertions) {
    assert.equal(allowedAssertions.has(assertion.type), true, `unsafe assertion primitive in ${policy.id}`);
  }
}

assert.equal(derivedRegistry.repository_governance.constitution, constitutionPath);
assert.equal(derivedRegistry.repository_governance.policy_registry, policyRegistryPath);
assert.equal(derivedRegistry.repository_governance.closure_script, scriptPath);
assert.equal(derivedRegistry.repository_governance.execution_mode, "same_exact_candidate_before_derived_state");
assert.equal(derivedRegistry.repository_governance.dynamic_policy_mode, "declarative_registered_assertions");
assert.equal(derivedRegistry.repository_governance.unknown_surface_fail_closed, true);
assert.equal(derivedRegistry.repository_governance.unknown_executable_fail_closed, true);
assert.equal(derivedRegistry.repository_governance.git_native_newness_required, true);
assert.equal(derivedRegistry.repository_governance.deletion_and_rename_impact_required, true);
assert.equal(derivedRegistry.repository_governance.derived_dependency_dag_required, true);
assert.equal(derivedRegistry.repository_governance.server_enforcement_must_not_be_inferred_from_repository_files, true);
assert.equal(derivedRegistry.required_check_name, constitution.authority.final_gate_context);
assert.deepEqual(new Set(derivedRegistry.protected_branches), new Set(Object.keys(constitution.branches)));

for (const controlPath of constitution.control_plane_paths) {
  assert.equal(
    derivedRegistry.convergence.automation_control_paths.includes(controlPath),
    true,
    `canonical control-plane path is not protected: ${controlPath}`
  );
}

for (const key of ["require_pull_request", "block_direct_push", "block_force_push", "dismiss_stale_approvals", "require_conversation_resolution"]) {
  assert.equal(derivedRegistry.server_enforcement.main[key], constitution.branches.main[key], `main policy conflict: ${key}`);
}
assert.deepEqual(
  new Set(derivedRegistry.server_enforcement.main.required_checks),
  new Set(constitution.branches.main.required_checks),
  "main required checks must come from the constitution"
);
for (const key of ["block_direct_push", "block_force_push", "generic_pull_request_merge_forbidden", "promotion_path", "same_sha_closure_required"]) {
  assert.equal(derivedRegistry.server_enforcement.Production[key], constitution.branches.Production[key], `Production policy conflict: ${key}`);
}

assert.match(script, /git[\s\S]*diff/u);
assert.match(script, /--find-renames=50%/u);
assert.match(script, /--find-copies=50%/u);
assert.match(script, /old_path/u);
assert.match(script, /new_path/u);
assert.match(script, /unknown_surfaces/u);
assert.match(script, /unknown_executables/u);
assert.match(script, /unclassified_historical_paths/u);
assert.match(script, /missing_derived_dependency_count/u);
assert.match(script, /derived_cycle_count/u);
assert.match(script, /declarative_registered_assertions/u);
assert.doesNotMatch(script, /isRecent\s*\(/u);
assert.doesNotMatch(script, /git\s+push/u);
assert.doesNotMatch(script, /update-ref/u);
assert.doesNotMatch(script, /https?:\/\//u);

assert.match(workflow, /scripts\/repository-governance-closure\.mjs/u);
assert.match(workflow, /repository-governance-closure\.test\.mjs/u);
assert.match(workflow, /repository-governance\.json/u);
assert.doesNotMatch(workflow, /\n\s*paths:/u);

const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
assert.equal(head.status, 0, head.stderr || "git rev-parse failed");
const sha = String(head.stdout || "").trim();
assert.match(sha, /^[0-9a-f]{40}$/u);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "repository-governance-closure-test-"));
const reportFile = path.join(tempDir, "report.json");
const selfCheck = spawnSync(process.execPath, [
  scriptPath,
  "--expected-sha", sha,
  "--base-sha", sha,
  "--candidate-kind", "self_test",
  "--report-file", reportFile,
], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
assert.equal(selfCheck.status, 0, `${selfCheck.stdout || ""}\n${selfCheck.stderr || ""}`);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
assert.equal(report.contract, "mad4b.repository-governance-closure.v1");
assert.equal(report.candidate.sha, sha);
assert.equal(report.candidate.base_sha, sha);
assert.equal(report.change_inventory.changed_entry_count, 0);
assert.equal(report.metrics.unknown_surface_count, 0);
assert.equal(report.metrics.unknown_executable_count, 0);
assert.equal(report.metrics.constitution_conflict_count, 0);
assert.equal(report.metrics.missing_derived_dependency_count, 0);
assert.equal(report.metrics.derived_cycle_count, 0);
assert.equal(report.converged, true);
assert.equal(report.server_enforcement.live_readback_performed_by_this_verifier, false);
assert.equal(report.server_enforcement.attestation_required_before_merge, true);
assert.equal(report.safety.repository_mutation_performed, false);
assert.equal(report.safety.secrets_included, false);
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  contract: constitution.contract,
  policy_count: policyRegistry.policies.length,
  final_gate_context: constitution.authority.final_gate_context,
  unknown_surface_fail_closed: true,
  unknown_executable_fail_closed: true,
  git_native_newness: true,
  deletion_and_rename_impact: true,
  derived_state_dag: true,
  live_server_policy_inference_forbidden: true,
}));
