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
fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
fs.mkdirSync(path.join(root, ".changes", "e2e"), { recursive: true });
fs.mkdirSync(path.join(root, "http-generic-api", "scripts"), { recursive: true });
fs.copyFileSync(path.join(REPO_ROOT, ".specify", "e2e-phase-governance.json"), path.join(root, ".specify", "e2e-phase-governance.json"));
fs.copyFileSync(path.join(REPO_ROOT, ".changes", "e2e", "e2e-default-branch-and-production-promotion-classification.json"), path.join(root, ".changes", "e2e", "e2e-default-branch-and-production-promotion-classification.json"));
fs.writeFileSync(path.join(root, "http-generic-api", "scripts", "e2e-parallel-pr-gate.mjs"), "export const version = 1;\n");
run("git", ["init"], root);
run("git", ["config", "user.email", "ci@example.invalid"], root);
run("git", ["config", "user.name", "CI"], root);
run("git", ["add", "."], root);
run("git", ["commit", "-m", "baseline governed classifier"], root);
const baseSha = run("git", ["rev-parse", "HEAD"], root).trim();
fs.writeFileSync(path.join(root, "http-generic-api", "scripts", "e2e-parallel-pr-gate.mjs"), "export const version = 2;\n");
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
assert.notEqual(undeclared.status, 0);
const undeclaredReport = JSON.parse(undeclared.stdout);
assert(undeclaredReport.findings.some((finding) => finding.code === "parallel_work_pr_branch_not_declared"));

console.log(JSON.stringify({ ok: true, tests: 11, default_branch_sync: true, production_promotion_preserved: true, undeclared_feature_fail_closed: true, secrets_included: false }));
