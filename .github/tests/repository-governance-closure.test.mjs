import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateRepository } from "../../http-generic-api/scripts/e2e-phase-governance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const paths = {
  constitution: "http-generic-api/config/repository-governance-constitution.json",
  policies: ".github/governance/policy-registry.json",
  semantic: ".github/governance/semantic-surface-registry.json",
  verifiers: ".github/governance/verifier-registry.json",
  derived: ".github/derived-state-governance.json",
  evidence: ".github/governance/evidence-producers.json",
  waivers: ".github/governance/waiver-ledger.json",
  e2e: ".specify/e2e-phase-governance.json",
};
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const constitution = read(paths.constitution), policies = read(paths.policies), semantic = read(paths.semantic), verifiers = read(paths.verifiers), derived = read(paths.derived), evidence = read(paths.evidence), waivers = read(paths.waivers), e2e = read(paths.e2e);
assert.equal(constitution.contract, "mad4b.repository-governance-constitution.v1");
assert.equal(constitution.authority.final_gate_context, "Derived State Closure");
assert.equal(constitution.authority.final_gate_mode, "trusted_app_exact_candidate_attestation");
assert.equal(constitution.authority.policy_execution_mode, "declarative_registered_assertions_over_semantic_graph");
assert.equal(constitution.authority.semantic_surface_registry, paths.semantic);
assert.equal(constitution.authority.verifier_registry, paths.verifiers);
assert.equal(constitution.authority.evidence_identity, "source_base_merge_candidate_executed_sha");
assert.equal(constitution.authority.server_enforcement_attestation, "trusted_github_app_exact_candidate_required_before_activation");
assert.deepEqual(constitution.branches.main.required_checks, ["Derived State Closure"]);
assert.deepEqual(constitution.branches.Production.required_checks, ["Governed Production Promotion"]);
assert.equal(constitution.branches.Production.generic_pull_request_merge_forbidden, true);
assert.equal(derived.repository_governance.semantic_surface_registry, constitution.authority.semantic_surface_registry);
assert.equal(derived.repository_governance.verifier_registry, constitution.authority.verifier_registry);
assert.equal(derived.repository_governance.evidence_producer_registry, constitution.authority.evidence_producer_registry);
assert.equal(derived.repository_governance.inverse_deletion_dependency_required, true);
assert.equal(derived.repository_governance.verifier_execution_registry_only, true);
assert.equal(semantic.contract, "mad4b.repository-semantic-surface-registry.v1");
assert.equal(verifiers.contract, "mad4b.repository-verifier-registry.v1");
assert.equal(verifiers.shell_execution_forbidden, true);
assert.equal(evidence.binding, "source_base_merge_candidate_executed_sha");
assert.equal(evidence.producers.filter((entry) => entry.required).length, 1);
assert.equal(evidence.producers.find((entry) => entry.required).id, "policy-objection-ci");
assert.equal(waivers.contract, "mad4b.repository-governance-waiver-ledger.v1");
const allowed = new Set(["metric_zero", "flag_true", "value_equals", "collection_empty", "number_compare", "forall"]);
assert.deepEqual(new Set(policies.allowed_assertion_types), allowed);
assert.equal(new Set(policies.policies.map((entry) => entry.id)).size, policies.policies.length);
for (const policy of policies.policies) for (const assertion of policy.assertions || []) assert.equal(allowed.has(assertion.type), true);

const constitutionOnlyPolicy = { ...e2e, governance_only_patterns: [] };
for (const controlPath of constitution.control_plane_paths) {
  assert.equal(derived.convergence.automation_control_paths.includes(controlPath), true, `unprotected control path: ${controlPath}`);
  const evaluation = evaluateRepository({ root, policy: constitutionOnlyPolicy, changedFiles: [controlPath] });
  assert.equal(evaluation.report.ok, true, `E2E governance rejected ${controlPath}: ${JSON.stringify(evaluation.report.findings)}`);
  assert.equal(evaluation.report.change_class, "governance_only", `E2E misclassification: ${controlPath}`);
}
for (const file of ["scripts/repository-governance-closure.mjs", "scripts/repository-governance-objection-gate.mjs", "scripts/repository-governance-evidence-finalizer.mjs"]) assert.equal(fs.existsSync(path.join(root, file)), true);
const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repository-governance-closure-test-")), reportFile = path.join(dir, "report.json");
const check = spawnSync(process.execPath, ["scripts/repository-governance-closure.mjs", "--expected-sha", sha, "--base-sha", sha, "--candidate-kind", "self_test", "--report-file", reportFile], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
assert.equal(report.converged, true);
for (const metric of ["unknown_surface_count", "unknown_executable_count", "unknown_semantic_executable_count", "deletion_dangling_reference_count", "semantic_unresolved_dependency_count", "semantic_registry_error_count", "derived_cycle_count", "workflow_surface_growth_count"]) assert.equal(report.metrics[metric], 0, `${metric} must be zero`);
assert.equal(report.flags.workflow_surface_ratchet_enforced, true);
assert.deepEqual(report.semantic_graph.dangling_references, []);
assert.equal(report.server_enforcement.live_readback_performed_by_this_verifier, false);
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, contract: constitution.contract, semantic_graph: true, inverse_deletion_closure: true, dynamic_policy_resolver: true, workflow_surface_ratchet: true, trusted_evidence_registry: true }));
