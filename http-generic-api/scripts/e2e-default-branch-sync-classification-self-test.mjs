#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const GATE = path.join(HERE, "e2e-parallel-pr-gate.mjs");

function run(program, args, cwd) {
  return execFileSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-default-branch-sync-"));
const contractPath = ".changes/e2e/e2e-default-branch-sync-fixture.json";
const gatePath = "http-generic-api/scripts/e2e-parallel-pr-gate.mjs";
const fixtureTestPath = "http-generic-api/scripts/e2e-default-branch-sync-fixture.mjs";
fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
fs.mkdirSync(path.join(root, ".changes", "e2e"), { recursive: true });
fs.mkdirSync(path.join(root, "http-generic-api", "scripts"), { recursive: true });
fs.copyFileSync(path.join(REPO_ROOT, ".specify", "e2e-phase-governance.json"), path.join(root, ".specify", "e2e-phase-governance.json"));
fs.writeFileSync(path.join(root, gatePath), "export const version = 1;\n");
fs.writeFileSync(path.join(root, fixtureTestPath), "export const fixtureVersion = 1;\n");
run("git", ["init"], root);
run("git", ["config", "user.email", "ci@example.invalid"], root);
run("git", ["config", "user.name", "CI"], root);
run("git", ["add", "."], root);
run("git", ["commit", "-m", "baseline governed classifier"], root);
const baseSha = run("git", ["rev-parse", "HEAD"], root).trim();

const fixtureContract = {
  schema_version: 1,
  feature_key: "001-default-branch-sync-fixture",
  title: "Default branch synchronization fixture",
  delivery_mode: "multi_pr",
  current_phase: "mvp",
  scope: { include: [contractPath, gatePath, fixtureTestPath] },
  merge_contract: { minimum_phase: "mvp" },
  phases: [{
    id: "mvp",
    status: "blocked",
    objective: "Exercise bounded branch classification without executing a feature journey.",
    blockers: ["Synthetic classifier fixture only."],
    planned_e2e_journey: {
      id: "default-branch-sync-fixture",
      required_level: "synthetic_runtime",
      actor: "E2E governance runner",
      entrypoint: "Invoke the parallel PR gate.",
      terminal_outcome: "Branch identity is classified without mutation.",
      steps: ["Create a synthetic repository", "Invoke the gate", "Read the classification"]
    }
  }],
  parallel_work: {
    enabled: true,
    strategy: "dependency_dag",
    file_ownership: "exclusive_by_default",
    merge_policy: "workstream_commits_then_e2e_rollup",
    no_partial_feature_merge: true,
    workstreams: [
      {
        id: "classifier",
        title: "Classifier",
        status: "planned",
        owner_type: "ai_agent",
        branch_pattern: "gpt/001-default-branch-sync/classifier-*",
        scope: { include: [gatePath] },
        depends_on: [],
        deliverables: ["Classifier behavior"],
        integration_points: ["default-branch-sync-classification"],
        required_tests: []
      },
      {
        id: "fixture",
        title: "Fixture",
        status: "planned",
        owner_type: "ai_agent",
        branch_pattern: "gpt/001-default-branch-sync/fixture-*",
        scope: { include: [fixtureTestPath] },
        depends_on: ["classifier"],
        deliverables: ["Synthetic classification fixture"],
        integration_points: ["default-branch-sync-classification"],
        required_tests: []
      }
    ],
    declared_overlaps: [],
    integration: {
      branch_pattern: "gpt/001-default-branch-sync/integration-*",
      required_workstreams: ["classifier", "fixture"],
      e2e_journey_ids: ["default-branch-sync-fixture"],
      convergence_tests: []
    }
  }
};
fs.writeFileSync(path.join(root, contractPath), `${JSON.stringify(fixtureContract, null, 2)}\n`);
fs.writeFileSync(path.join(root, gatePath), "export const version = 2;\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "main classifier update"], root);
const headSha = run("git", ["rev-parse", "HEAD"], root).trim();
run("git", ["update-ref", "refs/heads/main", headSha], root);
run("git", ["update-ref", "refs/remotes/origin/main", headSha], root);

const syncReport = JSON.parse(run(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "main", "--base-ref", "gpt/hostinger-production-release-evidence-r5-20260803"], root));
assert.equal(syncReport.ok, true, JSON.stringify(syncReport.findings));
assert.equal(syncReport.pr_mode, "default_branch_sync");
assert.equal(syncReport.production_promotion, false);
assert.equal(syncReport.production_promotion_identity, null);

const productionReport = JSON.parse(run(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "main", "--base-ref", "Production"], root));
assert.equal(productionReport.ok, true, JSON.stringify(productionReport.findings));
assert.equal(productionReport.pr_mode, "standard");
assert.equal(productionReport.production_promotion, true);
assert.equal(productionReport.production_promotion_identity, "protected_main");

const undeclared = spawnSync(process.execPath, [GATE, "--root", root, "--base", baseSha, "--head", headSha, "--head-ref", "gpt/undeclared-feature", "--base-ref", "main"], { cwd: root, encoding: "utf8" });
assert.notEqual(undeclared.status, 0, JSON.stringify({ status: undeclared.status, stdout: undeclared.stdout, stderr: undeclared.stderr }));
const undeclaredReport = JSON.parse(undeclared.stdout);
assert(undeclaredReport.findings.some((finding) => finding.code === "parallel_work_pr_branch_not_declared"));

console.log(JSON.stringify({ ok: true, tests: 11, default_branch_sync: true, production_promotion_preserved: true, undeclared_feature_fail_closed: true, secrets_included: false }));
