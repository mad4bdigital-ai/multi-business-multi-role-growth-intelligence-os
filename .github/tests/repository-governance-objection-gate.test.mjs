import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const constitution = JSON.parse(fs.readFileSync(path.join(root, "http-generic-api/config/repository-governance-constitution.json"), "utf8"));
const evidence = JSON.parse(fs.readFileSync(path.join(root, ".github/governance/evidence-producers.json"), "utf8"));
const waivers = JSON.parse(fs.readFileSync(path.join(root, ".github/governance/waiver-ledger.json"), "utf8"));
assert.equal(constitution.authority.objection_execution_mode, "typed_policy_objections");
assert.equal(constitution.authority.server_enforcement_attestation, "trusted_github_app_exact_candidate_required_before_activation");
assert.equal(constitution.authority.final_gate_mode, "trusted_app_exact_candidate_attestation");
assert.equal(constitution.objection_control_plane.critical_surface_requires_manual_merge, true);
assert.equal(constitution.objection_control_plane.new_executable_requires_semantic_registration, true);
assert.equal(evidence.contract, "mad4b.repository-governance-evidence-producers.v1");
const requiredProducers = evidence.producers.filter((entry) => entry.required === true);
assert.deepEqual(requiredProducers.map((entry) => entry.id), ["policy-objection-ci"]);
assert.equal(requiredProducers[0].workflow, "Policy Objection CI");
assert.equal(requiredProducers[0].workflow_file, ".github/workflows/policy-objection-ci.yml");
assert.ok(evidence.producers.some((entry) => entry.workflow === "CI" && entry.required === false && entry.role === "supplemental_diagnostics"));
assert.equal(waivers.contract, "mad4b.repository-governance-waiver-ledger.v1");
assert.ok(Array.isArray(waivers.waivers));

const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
assert.match(sha, /^[0-9a-f]{40}$/u);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repository-governance-objection-"));
const governanceReport = path.join(dir, "governance.json");
const objectionReport = path.join(dir, "objections.json");
const governance = spawnSync(process.execPath, [
  "scripts/repository-governance-closure.mjs",
  "--expected-sha", sha,
  "--base-sha", sha,
  "--candidate-kind", "self_test",
  "--report-file", governanceReport,
], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
assert.equal(governance.status, 0, `${governance.stdout}\n${governance.stderr}`);
const objections = spawnSync(process.execPath, [
  "scripts/repository-governance-objection-gate.mjs",
  "--mode", "source",
  "--governance-report", governanceReport,
  "--report-file", objectionReport,
], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
assert.equal(objections.status, 0, `${objections.stdout}\n${objections.stderr}`);
const report = JSON.parse(fs.readFileSync(objectionReport, "utf8"));
assert.equal(report.contract, "mad4b.repository-policy-objections.v1");
assert.equal(report.blocking_count, 0);
assert.equal(report.manual_count, 0);
assert.equal(report.merge_allowed_by_source_policy, true);
assert.equal(report.automerge_allowed, true);
assert.equal(report.safety.repository_mutation_performed, false);

const canonicalGovernance = JSON.parse(fs.readFileSync(governanceReport, "utf8"));
const criticalPath = ".github/governance/policy-registry.json";
assert.ok(constitution.control_plane_paths.includes(criticalPath));
canonicalGovernance.change_inventory.changes = [{
  raw_status: "M",
  status: "M",
  old_path: null,
  new_path: criticalPath,
  git_native_newness: false,
  paths: [{
    path: criticalPath,
    historical: false,
    surface_classes: ["governance_control_plane"],
    semantic_classes: [],
    facets: [],
    executable: false,
  }],
}];
const criticalGovernanceReport = path.join(dir, "governance-critical.json");
const criticalObjectionReport = path.join(dir, "objections-critical.json");
fs.writeFileSync(criticalGovernanceReport, `${JSON.stringify(canonicalGovernance, null, 2)}\n`);
const criticalObjections = spawnSync(process.execPath, [
  "scripts/repository-governance-objection-gate.mjs",
  "--mode", "source",
  "--governance-report", criticalGovernanceReport,
  "--report-file", criticalObjectionReport,
], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
assert.equal(criticalObjections.status, 0, `${criticalObjections.stdout}\n${criticalObjections.stderr}`);
const criticalReport = JSON.parse(fs.readFileSync(criticalObjectionReport, "utf8"));
assert.equal(criticalReport.blocking_count, 0);
assert.equal(criticalReport.manual_count, 1);
assert.equal(criticalReport.automerge_allowed, false);
assert.ok(criticalReport.objections.some((entry) =>
  entry.policy_id === "control-plane-self-amendment"
  && entry.objection_id === "control-plane-self-amendment:manual-merge-required"
  && entry.severity === "manual"
  && entry.evidence?.critical_paths?.includes(criticalPath)
));

const malformedGovernance = structuredClone(canonicalGovernance);
delete malformedGovernance.change_inventory.changes[0].paths[0].surface_classes;
const malformedGovernanceReport = path.join(dir, "governance-malformed.json");
const malformedObjectionReport = path.join(dir, "objections-malformed.json");
fs.writeFileSync(malformedGovernanceReport, `${JSON.stringify(malformedGovernance, null, 2)}\n`);
const malformedObjections = spawnSync(process.execPath, [
  "scripts/repository-governance-objection-gate.mjs",
  "--mode", "source",
  "--governance-report", malformedGovernanceReport,
  "--report-file", malformedObjectionReport,
], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
assert.equal(malformedObjections.status, 1, `${malformedObjections.stdout}\n${malformedObjections.stderr}`);
const malformedReport = JSON.parse(fs.readFileSync(malformedObjectionReport, "utf8"));
assert.ok(malformedReport.objections.some((entry) =>
  entry.policy_id === "governance-report-shape"
  && entry.objection_id === "governance-report-shape:surface-classes-missing"
  && entry.severity === "blocking"
));
assert.equal(malformedReport.automerge_allowed, false);

fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({
  ok: true,
  contract: report.contract,
  dynamic_policy_objections: true,
  canonical_required_producer: requiredProducers[0].id,
  critical_surface_manual_merge_enforced: true,
  malformed_surface_class_report_fails_closed: true,
}));
