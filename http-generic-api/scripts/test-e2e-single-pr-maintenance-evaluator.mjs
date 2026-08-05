#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRepository } from "./e2e-phase-governance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const POLICY = path.resolve(HERE, "..", "..", ".specify", "e2e-phase-governance.json");
const run = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const journey = {
  id: "maintenance",
  end_to_end: true,
  level: "synthetic_runtime",
  actor: "repository_maintainer",
  entrypoint: "A bounded maintenance change",
  terminal_outcome: "The integrated feature remains governed.",
  steps: ["Change covered runtime.", "Validate governance."],
  assertions: ["Maintenance remains fail closed."],
  tests: [{ id: "pass", runner: "node", working_directory: ".", path: "pass.mjs", args: [] }],
  evidence_paths: ["pass.mjs"]
};

function phaseContract(featureKey, deliveryMode, scope) {
  return {
    schema_version: 1,
    feature_key: featureKey,
    title: featureKey,
    delivery_mode: deliveryMode,
    current_phase: "mvp",
    scope: { include: scope },
    merge_contract: { minimum_phase: "mvp" },
    phases: [{ id: "mvp", status: "implemented", objective: "Govern maintenance safely.", blockers: [], e2e_journeys: [journey] }],
    secrets_included: false
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function evaluate(root, base, head, baseRef = "main") {
  return evaluateRepository({ root, base, head, baseRef }).report;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-maintenance-evaluator-"));
fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
fs.copyFileSync(POLICY, path.join(root, ".specify", "e2e-phase-governance.json"));
fs.mkdirSync(path.join(root, "http-generic-api", "example"), { recursive: true });
fs.writeFileSync(path.join(root, "pass.mjs"), "process.exit(0);\n");
fs.writeFileSync(path.join(root, "http-generic-api", "example", "service.mjs"), "export const version = 1;\n");
run(["init"], root);
run(["config", "user.email", "ci@example.invalid"], root);
run(["config", "user.name", "CI"], root);
run(["add", "."], root);
run(["commit", "-m", "baseline"], root);
const evidenceSha = run(["rev-parse", "HEAD"], root);

const parallel = phaseContract("001-example", "multi_pr", ["specs/001-example/**", "http-generic-api/example/**"]);
parallel.parallel_work = {
  enabled: true,
  strategy: "dependency_dag",
  file_ownership: "exclusive_by_default",
  merge_policy: "workstream_commits_then_e2e_rollup",
  no_partial_feature_merge: true,
  workstreams: [{
    id: "runtime",
    title: "Runtime",
    status: "integrated",
    owner_type: "mixed",
    branch_pattern: "gpt/001-example/runtime-*",
    scope: { include: ["http-generic-api/example/**"] },
    depends_on: [],
    deliverables: ["Integrated runtime"],
    integration_points: ["example-v1"],
    required_tests: [{ id: "pass", runner": "node", working_directory: ".", path: "pass.mjs", args: [] }],
    commit_evidence: { head_sha: evidenceSha, commits: [evidenceSha] }
  }],
  declared_overlaps: [],
  integration: {
    branch_pattern: "gpt/001-example/integration-*",
    required_workstreams: ["runtime"],
    e2e_journey_ids: ["maintenance"],
    convergence_tests: [{ id: "pass", runner: "node", working_directory: ".", path: "pass.mjs", args: [] }]
  }
};
writeJson(path.join(root, "specs", "001-example", "e2e-phases.json"), parallel);
run(["add", "."], root);
run(["commit", "-m", "integrated contract"], root);
const baseSha = run(["rev-parse", "HEAD"], root);

const maintenance = phaseContract("001-example-maintenance", "single_pr", [
  ".changes/e2e/001-example-maintenance.json",
  "http-generic-api/example/service.mjs"
]);
writeJson(path.join(root, ".changes", "e2e", "001-example-maintenance.json"), maintenance);
writeJson(path.join(root, "specs", "001-example", "work-map-integration.json"), { schema_version: 1 });
fs.writeFileSync(path.join(root, "http-generic-api", "example", "service.mjs"), "export const version = 2;\n");
run(["add", "."], root);
run(["commit", "-m", "covered maintenance"], root);
const coveredSha = run(["rev-parse", "HEAD"], root);

const covered = evaluate(root, baseSha, coveredSha);
assert.equal(covered.ok, true, JSON.stringify(covered.findings));
assert.equal(covered.single_pr_maintenance_contract?.contract_path, ".changes/e2e/001-example-maintenance.json");
assert.deepEqual(covered.single_pr_maintenance_contract?.affected_parallel_contract_paths, ["specs/001-example/e2e-phases.json"]);
assert.equal(covered.findings.some((finding) => finding.code === "e2e_phase_contract_not_changed_with_feature"), false);

const wrongBase = evaluate(root, baseSha, coveredSha, "integration");
assert.equal(wrongBase.ok, false);
assert(wrongBase.findings.some((finding) => finding.code === "e2e_phase_contract_not_changed_with_feature"));

maintenance.scope.include = [".changes/e2e/001-example-maintenance.json"];
writeJson(path.join(root, ".changes", "e2e", "001-example-maintenance.json"), maintenance);
run(["add", "."], root);
run(["commit", "-m", "under scoped"], root);
const underScoped = evaluate(root, baseSha, run(["rev-parse", "HEAD"], root));
assert.equal(underScoped.ok, false);
assert(underScoped.findings.some((finding) => finding.code === "e2e_phase_contract_not_changed_with_feature"));

maintenance.scope.include.push("http-generic-api/example/service.mjs");
writeJson(path.join(root, ".changes", "e2e", "001-example-maintenance.json"), maintenance);
writeJson(path.join(root, ".changes", "e2e", "duplicate.json"), { ...maintenance, feature_key: "duplicate" });
run(["add", "."], root);
run(["commit", "-m", "ambiguous"], root);
const ambiguous = evaluate(root, baseSha, run(["rev-parse", "HEAD"], root));
assert.equal(ambiguous.ok, false);
assert(ambiguous.findings.some((finding) => finding.code === "e2e_phase_contract_not_changed_with_feature"));

fs.rmSync(path.join(root, ".changes", "e2e", "duplicate.json"));
parallel.parallel_work.workstreams[0].status = "ready_for_integration";
writeJson(path.join(root, "specs", "001-example", "e2e-phases.json"), parallel);
run(["add", "-A"], root);
run(["commit", "-m", "reopened parallel baseline"], root);
const reopenedBase = run(["rev-parse", "HEAD"], root);
maintenance.title = "Example maintenance after reopened work";
writeJson(path.join(root, ".changes", "e2e", "001-example-maintenance.json"), maintenance);
writeJson(path.join(root, "specs", "001-example", "work-map-integration.json"), { schema_version: 2 });
fs.writeFileSync(path.join(root, "http-generic-api", "example", "service.mjs"), "export const version = 3;\n");
run(["add", "."], root);
run(["commit", "-m", "maintenance while parallel work reopened"], root);
const reopened = evaluate(root, reopenedBase, run(["rev-parse", "HEAD"], root));
assert.equal(reopened.ok, false);
assert(reopened.findings.some((finding) => finding.code === "e2e_phase_contract_not_changed_with_feature"));

console.log(JSON.stringify({
  ok: true,
  tests: 10,
  contract: "single_pr_maintenance_evaluator_exception",
  independently_revalidated: true,
  fail_closed_for_non_main_under_scope_ambiguity_and_reopened_parallel_delivery: true,
  secrets_included: false
}));
