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
const evidenceRegistryPath = ".github/governance/evidence-producers.json";
const waiverLedgerPath = ".github/governance/waiver-ledger.json";
const e2ePath = ".specify/e2e-phase-governance.json";
const scriptPath = "scripts/repository-governance-closure.mjs";
const objectionPath = "scripts/repository-governance-objection-gate.mjs";
const finalizerPath = "scripts/repository-governance-evidence-finalizer.mjs";

const constitution = JSON.parse(fs.readFileSync(path.join(root, constitutionPath), "utf8"));
const policies = JSON.parse(fs.readFileSync(path.join(root, policyRegistryPath), "utf8"));
const derived = JSON.parse(fs.readFileSync(path.join(root, derivedRegistryPath), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(root, evidenceRegistryPath), "utf8"));
const waivers = JSON.parse(fs.readFileSync(path.join(root, waiverLedgerPath), "utf8"));
const e2e = JSON.parse(fs.readFileSync(path.join(root, e2ePath), "utf8"));

function escapeRegex(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
function globRegex(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { source += "(?:.*/)?"; i += 2; }
        else { source += ".*"; i += 1; }
      } else source += "[^/]*";
    } else source += escapeRegex(ch);
  }
  return new RegExp(`^${source}$`, "u");
}
const matchesAny = (file, patterns) => patterns.some((pattern) => globRegex(pattern).test(file));

assert.equal(constitution.contract, "mad4b.repository-governance-constitution.v1");
assert.equal(constitution.authority.final_gate_context, "Derived State Closure");
assert.equal(constitution.authority.final_gate_mode, "policy_objection_aggregator");
assert.equal(constitution.authority.objection_execution_mode, "typed_policy_objections");
assert.equal(constitution.authority.new_executable_registration_mode, "typed_semantic_class_required");
assert.equal(constitution.authority.server_enforcement_attestation, "required_before_single_gate_activation");
assert.equal(constitution.authority.waiver_mode, "digest_bound_expiring_ledger");
assert.equal(derived.repository_governance.evidence_producer_registry, constitution.authority.evidence_producer_registry);
assert.equal(derived.repository_governance.waiver_ledger, constitution.authority.waiver_ledger);
assert.equal(derived.repository_governance.derived_dependency_execution_topological, true);
assert.equal(derived.policy.observability_premerge_mutation_forbidden, true);
assert.equal(derived.convergence.draft_pr_repair_allowed, true);
assert.equal(derived.convergence.draft_pr_automerge_forbidden, true);
assert.equal(evidence.contract, "mad4b.repository-governance-evidence-producers.v1");
assert.equal(waivers.contract, "mad4b.repository-governance-waiver-ledger.v1");
assert.ok(evidence.producers.some((entry) => entry.workflow_file === ".github/workflows/ci.yml" && entry.required === true));
assert.ok(Array.isArray(constitution.semantic_executable_classes) && constitution.semantic_executable_classes.length > 0);

const allowed = new Set(["metric_zero", "flag_true"]);
assert.deepEqual(new Set(policies.allowed_assertion_types), allowed);
assert.equal(new Set(policies.policies.map((entry) => entry.id)).size, policies.policies.length);
for (const policy of policies.policies) {
  assert.ok(policy.remediation);
  assert.equal(typeof policy.waiverable, "boolean");
  for (const assertion of policy.assertions || []) assert.equal(allowed.has(assertion.type), true);
}
for (const controlPath of constitution.control_plane_paths) {
  assert.equal(derived.convergence.automation_control_paths.includes(controlPath), true, `unprotected control path: ${controlPath}`);
  assert.equal(matchesAny(controlPath, e2e.governance_only_patterns), true, `E2E misclassification for control path: ${controlPath}`);
}
for (const requiredPath of [scriptPath, objectionPath, finalizerPath]) assert.equal(fs.existsSync(path.join(root, requiredPath)), true, `missing ${requiredPath}`);

const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
assert.match(sha, /^[0-9a-f]{40}$/u);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repository-governance-closure-test-"));
const reportFile = path.join(dir, "report.json");
const check = spawnSync(process.execPath, [
  scriptPath, "--expected-sha", sha, "--base-sha", sha, "--candidate-kind", "self_test", "--report-file", reportFile
], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
assert.equal(report.converged, true);
assert.equal(report.metrics.unknown_surface_count, 0);
assert.equal(report.metrics.derived_cycle_count, 0);
assert.equal(report.server_enforcement.live_readback_performed_by_this_verifier, false);
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, contract: constitution.contract, objection_control_plane: true, trusted_evidence_registry: true }));
