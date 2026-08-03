#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, "e2e-parallel-pr-gate.mjs");
const RUNNER = path.join(HERE, "e2e-parallel-test-runner.mjs");
const POLICY = path.resolve(HERE, "..", "..", ".specify", "e2e-phase-governance.json");

function run(program, args, cwd) {
  return execFileSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-parallel-pr-flow-"));
fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
fs.copyFileSync(POLICY, path.join(root, ".specify", "e2e-phase-governance.json"));
run("git", ["init"], root);
run("git", ["config", "user.email", "ci@example.invalid"], root);
run("git", ["config", "user.name", "CI"], root);
fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "baseline"], root);
const baseSha = run("git", ["rev-parse", "HEAD"], root).trim();

fs.mkdirSync(path.join(root, "http-generic-api", "example", "runtime"), { recursive: true });
fs.mkdirSync(path.join(root, "specs", "001-example"), { recursive: true });
fs.writeFileSync(path.join(root, "http-generic-api", "example", "runtime", "service.mjs"), "export default true;\n");
fs.writeFileSync(path.join(root, "http-generic-api", "example", "runtime", "e2e.mjs"), "process.exit(0);\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "runtime work"], root);
const workSha = run("git", ["rev-parse", "HEAD"], root).trim();

const contract = {
  schema_version: 1,
  feature_key: "001-example",
  title: "Example",
  delivery_mode: "multi_pr",
  current_phase: "mvp",
  scope: { include: ["specs/001-example/**", "http-generic-api/example/**"] },
  merge_contract: { minimum_phase: "mvp" },
  phases: [{ id: "mvp", status: "blocked", objective: "Complete the E2E slice.", blockers: ["Integration pending."], planned_e2e_journey: { id: "example-e2e", required_level: "synthetic_runtime", actor: "tenant", entrypoint: "POST /example", terminal_outcome: "Readback succeeds.", steps: ["Submit", "Read back"] } }],
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
        status: "ready_for_integration",
        owner_type: "ai_agent",
        branch_pattern: "gpt/001-example/contracts-*",
        scope: { include: ["specs/001-example/**"] },
        depends_on: [],
        deliverables: ["Contracts"],
        integration_points: ["example-contract-v1"],
        required_tests: [{ id: "contract-check", runner: "node", working_directory: "http-generic-api", path: "example/runtime/e2e.mjs", args: [] }],
        commit_evidence: { branch: "gpt/001-example/contracts-a", head_sha: baseSha, commits: [baseSha] }
      },
      {
        id: "runtime",
        title: "Runtime",
        status: "ready_for_integration",
        owner_type: "human",
        branch_pattern: "gpt/001-example/runtime-*",
        scope: { include: ["http-generic-api/example/runtime/**"] },
        depends_on: ["contracts"],
        deliverables: ["Runtime service"],
        integration_points: ["example-contract-v1"],
        required_tests: [{ id: "runtime-e2e", runner: "node", working_directory: "http-generic-api", path: "example/runtime/e2e.mjs", args: [] }],
        commit_evidence: { branch: "gpt/001-example/runtime-a", head_sha: workSha, commits: [workSha] }
      }
    ],
    declared_overlaps: [],
    integration: {
      branch_pattern: "gpt/001-example/integration-*",
      required_workstreams: ["contracts", "runtime"],
      e2e_journey_ids: ["example-e2e"],
      convergence_tests: [{ id: "convergence-e2e", runner: "node", working_directory: "http-generic-api", path: "example/runtime/e2e.mjs", args: [] }]
    }
  }
};
const contractPath = "specs/001-example/e2e-phases.json";
fs.writeFileSync(path.join(root, contractPath), `${JSON.stringify(contract, null, 2)}\n`);
run("git", ["add", "."], root);
run("git", ["commit", "-m", "declare ready workstream"], root);
const headSha = run("git", ["rev-parse", "HEAD"], root).trim();
run("git", ["update-ref", "refs/heads/main", headSha], root);
run("git", ["update-ref", "refs/remotes/origin/main", headSha], root);

const gatePass = JSON.parse(run(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "gpt/001-example/runtime-a", "--base-ref", "gpt/001-example/integration-a"], root));
assert.equal(gatePass.ok, true, JSON.stringify(gatePass.findings));
assert.equal(gatePass.pr_mode, "workstream");
assert.equal(gatePass.workstream_id, "runtime");
assert.equal(gatePass.production_promotion, false);
assert.equal(gatePass.production_promotion_identity, null);
assert.equal(gatePass.phase_evaluation_base, null);

const defaultBranchDispatchEnv = { ...process.env };
for (const name of ["GITHUB_BASE_REF", "GITHUB_HEAD_REF", "GITHUB_BASE_SHA", "GITHUB_HEAD_SHA"]) delete defaultBranchDispatchEnv[name];
const defaultBranchDispatch = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "main"], { cwd: root, encoding: "utf8", env: defaultBranchDispatchEnv });
assert.equal(defaultBranchDispatch.status, 0, JSON.stringify({ status: defaultBranchDispatch.status, signal: defaultBranchDispatch.signal, stdout: defaultBranchDispatch.stdout, stderr: defaultBranchDispatch.stderr }));
const defaultBranchDispatchReport = JSON.parse(defaultBranchDispatch.stdout);
assert.equal(defaultBranchDispatchReport.ok, true, JSON.stringify(defaultBranchDispatchReport.findings));
assert.equal(defaultBranchDispatchReport.pr_mode, "standard");
assert.equal(defaultBranchDispatchReport.base_ref, null);
assert.equal(defaultBranchDispatchReport.production_promotion, false);
assert.equal(defaultBranchDispatchReport.phase_evaluation_base, null);

const undeclaredBranch = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "gpt/001-example/undeclared-a", "--base-ref", "gpt/001-example/integration-a"], { cwd: root, encoding: "utf8" });
assert.notEqual(undeclaredBranch.status, 0);
const undeclaredReport = JSON.parse(undeclaredBranch.stdout);
assert(undeclaredReport.findings.some((row) => row.code === "parallel_work_pr_branch_not_declared"));

const directMain = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "gpt/001-example/runtime-a", "--base-ref", "main"], { cwd: root, encoding: "utf8" });
assert.notEqual(directMain.status, 0);
const directReport = JSON.parse(directMain.stdout);
assert(directReport.findings.some((row) => row.code === "parallel_work_workstream_must_target_integration_branch"));

const productionPromotion = JSON.parse(run(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "main", "--base-ref", "Production"], root));
assert.equal(productionPromotion.ok, true, JSON.stringify(productionPromotion.findings));
assert.equal(productionPromotion.pr_mode, "standard");
assert.equal(productionPromotion.production_promotion, true);
assert.equal(productionPromotion.production_promotion_identity, "protected_main");
assert.equal(productionPromotion.phase_evaluation_base, workSha);

const immutableRef = `release/production-candidate-20260803-${headSha.slice(0, 8)}-v1`;
const immutablePromotion = JSON.parse(run(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", immutableRef, "--base-ref", "Production"], root));
assert.equal(immutablePromotion.ok, true, JSON.stringify(immutablePromotion.findings));
assert.equal(immutablePromotion.pr_mode, "standard");
assert.equal(immutablePromotion.production_promotion, true);
assert.equal(immutablePromotion.production_promotion_identity, "immutable_main_snapshot");
assert.equal(immutablePromotion.phase_evaluation_base, workSha);

const legacyImmutableRef = `release/production-candidate-${headSha.slice(0, 8)}`;
const legacyImmutablePromotion = JSON.parse(run(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", legacyImmutableRef, "--base-ref", "Production"], root));
assert.equal(legacyImmutablePromotion.ok, true, JSON.stringify(legacyImmutablePromotion.findings));
assert.equal(legacyImmutablePromotion.production_promotion_identity, "immutable_main_snapshot");
assert.equal(legacyImmutablePromotion.phase_evaluation_base, workSha);

const mismatchedImmutable = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "release/production-candidate-20260803-deadbeef-v1", "--base-ref", "Production"], { cwd: root, encoding: "utf8" });
assert.notEqual(mismatchedImmutable.status, 0);
const mismatchedImmutableReport = JSON.parse(mismatchedImmutable.stdout);
assert.equal(mismatchedImmutableReport.production_promotion, false);
assert.equal(mismatchedImmutableReport.production_promotion_identity, null);
assert.equal(mismatchedImmutableReport.phase_evaluation_base, null);
assert(mismatchedImmutableReport.findings.some((row) => row.code === "parallel_work_pr_branch_not_declared"));

const spoofedPromotion = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "release/main", "--base-ref", "Production"], { cwd: root, encoding: "utf8" });
assert.notEqual(spoofedPromotion.status, 0);
const spoofedPromotionReport = JSON.parse(spoofedPromotion.stdout);
assert.equal(spoofedPromotionReport.production_promotion, false);
assert.equal(spoofedPromotionReport.production_promotion_identity, null);
assert.equal(spoofedPromotionReport.phase_evaluation_base, null);
assert(spoofedPromotionReport.findings.some((row) => row.code === "parallel_work_pr_branch_not_declared"));

run("git", ["checkout", "--orphan", "orphan-release"], root);
for (const entry of fs.readdirSync(root)) {
  if (entry !== ".git" && entry !== ".specify") fs.rmSync(path.join(root, entry), { recursive: true, force: true });
}
fs.writeFileSync(path.join(root, "ORPHAN.md"), "no parent\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "orphan"], root);
const orphanSha = run("git", ["rev-parse", "HEAD"], root).trim();
const missingBaseline = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", orphanSha, "--head-ref", "main", "--base-ref", "Production"], { cwd: root, encoding: "utf8" });
assert.notEqual(missingBaseline.status, 0);
const missingBaselineReport = JSON.parse(missingBaseline.stdout);
assert.equal(missingBaselineReport.production_promotion, true);
assert.equal(missingBaselineReport.phase_evaluation_base, null);
assert(missingBaselineReport.findings.some((row) => row.code === "production_promotion_phase_evaluation_base_unavailable"));
run("git", ["checkout", "main"], root);

const workstreamRun = JSON.parse(run(process.execPath, [RUNNER, "--root", root, "--contract", contractPath, "--mode", "workstream", "--workstream-id", "runtime"], root));
assert.equal(workstreamRun.ok, true);
assert.equal(workstreamRun.test_count, 1);

const integrationRun = JSON.parse(run(process.execPath, [RUNNER, "--root", root, "--contract", contractPath, "--mode", "integration"], root));
assert.equal(integrationRun.ok, true);
assert.equal(integrationRun.test_count, 1);

console.log(JSON.stringify({ ok: true, tests: 46, flow: "parallel_workstream_to_integration_default_branch_and_source_baselined_production_promotions", secrets_included: false }));
