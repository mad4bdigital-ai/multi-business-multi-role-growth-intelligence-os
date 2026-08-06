#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "e2e-parallel-pr-gate.mjs");
const POLICY = path.resolve(HERE, "..", "..", ".specify", "e2e-phase-governance.json");

function run(program, args, cwd) {
  return execFileSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function invokeGate(root, baseSha, headSha, baseRef = "main") {
  return spawnSync(process.execPath, [
    GATE,
    "--root", root,
    "--base", baseSha,
    "--head", headSha,
    "--head-ref", "chore/001-example/post-integration-maintenance",
    "--base-ref", baseRef
  ], { cwd: root, encoding: "utf8" });
}

function implementedJourney() {
  return {
    id: "example-maintenance",
    end_to_end: true,
    level: "synthetic_runtime",
    actor: "repository_maintainer",
    entrypoint: "A governed post-integration maintenance pull request",
    terminal_outcome: "The bounded maintenance change is validated without reopening parallel delivery.",
    steps: ["Change one covered runtime file.", "Validate the declared maintenance contract."],
    assertions: ["Every changed runtime file is covered by the changed single-PR contract."],
    tests: [{
      id: "example-runtime-check",
      runner: "node",
      working_directory: "http-generic-api",
      path: "example/runtime/e2e.mjs",
      args: []
    }],
    evidence_paths: ["http-generic-api/example/runtime/e2e.mjs"]
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-single-pr-maintenance-"));
fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
fs.copyFileSync(POLICY, path.join(root, ".specify", "e2e-phase-governance.json"));
fs.mkdirSync(path.join(root, "http-generic-api", "example", "runtime"), { recursive: true });
fs.mkdirSync(path.join(root, "specs", "001-example"), { recursive: true });
fs.mkdirSync(path.join(root, ".changes", "e2e"), { recursive: true });

run("git", ["init"], root);
run("git", ["config", "user.email", "ci@example.invalid"], root);
run("git", ["config", "user.name", "CI"], root);
fs.writeFileSync(path.join(root, "http-generic-api", "example", "runtime", "service.mjs"), "export const version = 1;\n");
fs.writeFileSync(path.join(root, "http-generic-api", "example", "runtime", "e2e.mjs"), "process.exit(0);\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "runtime baseline"], root);
const evidenceSha = run("git", ["rev-parse", "HEAD"], root).trim();

const parallelContract = {
  schema_version: 1,
  feature_key: "001-example",
  title: "Example integrated feature",
  delivery_mode: "multi_pr",
  current_phase: "mvp",
  scope: { include: ["specs/001-example/**", "http-generic-api/example/**"] },
  merge_contract: { minimum_phase: "mvp" },
  phases: [{
    id: "mvp",
    status: "implemented",
    objective: "Keep the integrated feature governed.",
    blockers: [],
    e2e_journeys: [implementedJourney()]
  }],
  parallel_work: {
    enabled: true,
    strategy: "dependency_dag",
    file_ownership: "exclusive_by_default",
    merge_policy: "workstream_commits_then_e2e_rollup",
    no_partial_feature_merge: true,
    workstreams: [
      {
        id: "contracts",
        title: "Contracts",
        status: "integrated",
        owner_type: "mixed",
        branch_pattern: "gpt/001-example/contracts-*",
        scope: { include: ["specs/001-example/**"] },
        depends_on: [],
        deliverables: ["Integrated contracts"],
        integration_points: ["example-contract-v1"],
        required_tests: [{ id: "contract-check", runner: "node", working_directory: "http-generic-api", path: "example/runtime/e2e.mjs", args: [] }],
        commit_evidence: { head_sha: evidenceSha, commits: [evidenceSha] }
      },
      {
        id: "runtime",
        title: "Runtime",
        status: "integrated",
        owner_type: "mixed",
        branch_pattern: "gpt/001-example/runtime-*",
        scope: { include: ["http-generic-api/example/**"] },
        depends_on: ["contracts"],
        deliverables: ["Integrated runtime"],
        integration_points: ["example-contract-v1"],
        required_tests: [{ id: "runtime-check", runner: "node", working_directory: "http-generic-api", path: "example/runtime/e2e.mjs", args: [] }],
        commit_evidence: { head_sha: evidenceSha, commits: [evidenceSha] }
      }
    ],
    declared_overlaps: [],
    integration: {
      branch_pattern: "gpt/001-example/integration-*",
      required_workstreams: ["contracts", "runtime"],
      e2e_journey_ids: ["example-maintenance"],
      convergence_tests: [{ id: "convergence-check", runner: "node", working_directory: "http-generic-api", path: "example/runtime/e2e.mjs", args: [] }]
    }
  }
};
fs.writeFileSync(path.join(root, "specs", "001-example", "e2e-phases.json"), `${JSON.stringify(parallelContract, null, 2)}\n`);
run("git", ["add", "."], root);
run("git", ["commit", "-m", "integrated parallel contract"], root);
const baseSha = run("git", ["rev-parse", "HEAD"], root).trim();
run("git", ["update-ref", "refs/heads/main", baseSha], root);
run("git", ["update-ref", "refs/remotes/origin/main", baseSha], root);

const maintenanceContract = {
  schema_version: 1,
  feature_key: "001-example-maintenance",
  title: "Example post-integration maintenance",
  delivery_mode: "single_pr",
  current_phase: "mvp",
  scope: { include: [".changes/e2e/001-example-maintenance.json"] },
  merge_contract: { minimum_phase: "mvp" },
  phases: [{
    id: "mvp",
    status: "implemented",
    objective: "Maintain the integrated feature through a bounded single pull request.",
    blockers: [],
    e2e_journeys: [implementedJourney()]
  }],
  secrets_included: false
};
fs.writeFileSync(path.join(root, ".changes", "e2e", "001-example-maintenance.json"), `${JSON.stringify(maintenanceContract, null, 2)}\n`);
fs.writeFileSync(path.join(root, "specs", "001-example", "work-map-integration.json"), "{\"schema_version\":1}\n");
fs.writeFileSync(path.join(root, "http-generic-api", "example", "runtime", "service.mjs"), "export const version = 2;\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "under-scoped maintenance"], root);
const underScopedSha = run("git", ["rev-parse", "HEAD"], root).trim();

const underScoped = invokeGate(root, baseSha, underScopedSha);
assert.notEqual(underScoped.status, 0);
const underScopedReport = JSON.parse(underScoped.stdout);
assert(underScopedReport.findings.some((finding) => finding.code === "parallel_work_pr_branch_not_declared"));
assert.equal(underScopedReport.single_pr_maintenance_contract, null);

maintenanceContract.scope.include.push("http-generic-api/example/runtime/service.mjs");
fs.writeFileSync(path.join(root, ".changes", "e2e", "001-example-maintenance.json"), `${JSON.stringify(maintenanceContract, null, 2)}\n`);
run("git", ["add", "."], root);
run("git", ["commit", "-m", "fully scoped maintenance"], root);
const coveredSha = run("git", ["rev-parse", "HEAD"], root).trim();

const covered = invokeGate(root, baseSha, coveredSha);
assert.equal(covered.status, 0, covered.stderr || covered.stdout);
const coveredReport = JSON.parse(covered.stdout);
assert.equal(coveredReport.ok, true, JSON.stringify(coveredReport.findings));
assert.equal(coveredReport.pr_mode, "standard");
assert.equal(coveredReport.single_pr_maintenance_contract?.feature_key, "001-example-maintenance");
assert.deepEqual(coveredReport.single_pr_maintenance_contract?.runtime_files, ["http-generic-api/example/runtime/service.mjs"]);

const duplicateContract = { ...maintenanceContract, feature_key: "001-example-maintenance-duplicate" };
const duplicatePath = path.join(root, ".changes", "e2e", "001-example-maintenance-duplicate.json");
fs.writeFileSync(duplicatePath, `${JSON.stringify(duplicateContract, null, 2)}\n`);
run("git", ["add", "."], root);
run("git", ["commit", "-m", "ambiguous maintenance contracts"], root);
const ambiguousSha = run("git", ["rev-parse", "HEAD"], root).trim();
const ambiguous = invokeGate(root, baseSha, ambiguousSha);
assert.notEqual(ambiguous.status, 0);
const ambiguousReport = JSON.parse(ambiguous.stdout);
assert(ambiguousReport.findings.some((finding) => finding.code === "parallel_work_pr_branch_not_declared"));
assert.equal(ambiguousReport.single_pr_maintenance_contract, null);
fs.rmSync(duplicatePath);
run("git", ["add", "-A"], root);
run("git", ["commit", "-m", "remove ambiguous maintenance contract"], root);
const unambiguousSha = run("git", ["rev-parse", "HEAD"], root).trim();

const wrongBase = invokeGate(root, baseSha, unambiguousSha, "gpt/001-example/integration-a");
assert.notEqual(wrongBase.status, 0);
const wrongBaseReport = JSON.parse(wrongBase.stdout);
assert(wrongBaseReport.findings.some((finding) => finding.code === "parallel_work_pr_branch_not_declared"));
assert.equal(wrongBaseReport.single_pr_maintenance_contract, null);

parallelContract.parallel_work.workstreams[1].status = "ready_for_integration";
fs.writeFileSync(path.join(root, "specs", "001-example", "e2e-phases.json"), `${JSON.stringify(parallelContract, null, 2)}\n`);
run("git", ["add", "."], root);
run("git", ["commit", "-m", "reopen parallel delivery"], root);
const reopenedSha = run("git", ["rev-parse", "HEAD"], root).trim();
const reopened = invokeGate(root, baseSha, reopenedSha);
assert.notEqual(reopened.status, 0);
const reopenedReport = JSON.parse(reopened.stdout);
assert(reopenedReport.findings.some((finding) => finding.code === "parallel_work_pr_branch_not_declared"));
assert.equal(reopenedReport.single_pr_maintenance_contract, null);

console.log(JSON.stringify({
  ok: true,
  tests: 16,
  contract: "fully_scoped_single_pr_post_integration_maintenance",
  fail_closed_for_under_scope_ambiguity_non_main_and_reopened_parallel_delivery: true,
  secrets_included: false
}));
