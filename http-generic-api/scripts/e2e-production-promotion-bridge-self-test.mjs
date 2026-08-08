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

function invoke(root, { base, head, headRef }) {
  return spawnSync(process.execPath, [
    GATE,
    "--root", root,
    "--base", base,
    "--head", head,
    "--head-ref", headRef,
    "--base-ref", "Production"
  ], { cwd: root, encoding: "utf8" });
}

function updateRemoteRef(remoteRoot, ref, sha, cwd) {
  run("git", ["--git-dir", remoteRoot, "update-ref", ref, sha], cwd);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-production-bridge-"));
const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-production-bridge-origin-"));
run("git", ["init", "--bare", remoteRoot], root);
fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
fs.copyFileSync(POLICY, path.join(root, ".specify", "e2e-phase-governance.json"));
run("git", ["init"], root);
run("git", ["config", "user.email", "ci@example.invalid"], root);
run("git", ["config", "user.name", "CI"], root);
run("git", ["remote", "add", "origin", remoteRoot], root);

fs.writeFileSync(path.join(root, "README.md"), "production baseline\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "production baseline"], root);
const productionSha = run("git", ["rev-parse", "HEAD"], root).trim();
run("git", ["update-ref", "refs/heads/Production", productionSha], root);
run("git", ["update-ref", "refs/remotes/origin/Production", productionSha], root);
updateRemoteRef(remoteRoot, "refs/heads/Production", productionSha, root);

fs.writeFileSync(path.join(root, "README.md"), "trusted main\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "trusted main"], root);
const mainSha = run("git", ["rev-parse", "HEAD"], root).trim();
run("git", ["update-ref", "refs/heads/main", mainSha], root);
run("git", ["update-ref", "refs/remotes/origin/main", mainSha], root);
updateRemoteRef(remoteRoot, "refs/heads/main", mainSha, root);
const mainTree = run("git", ["rev-parse", `${mainSha}^{tree}`], root).trim();

const candidateSha = run("git", [
  "commit-tree", mainTree,
  "-p", mainSha,
  "-p", productionSha,
  "-m", "governed Production reconciliation"
], root).trim();
const rearmSha = run("git", [
  "commit-tree", mainTree,
  "-p", candidateSha,
  "-m", "human zero-diff re-arm"
], root).trim();
const bridgeRef = `release/production-candidate-${mainSha.slice(0, 12)}-${productionSha.slice(0, 12)}-bridge-31282314470`;

const accepted = invoke(root, { base: productionSha, head: rearmSha, headRef: bridgeRef });
assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
const acceptedReport = JSON.parse(accepted.stdout);
assert.equal(acceptedReport.ok, true, JSON.stringify(acceptedReport.findings));
assert.equal(acceptedReport.pr_mode, "standard");
assert.equal(acceptedReport.production_promotion, true);
assert.equal(acceptedReport.production_promotion_identity, "history_preserving_main_reconciliation");
assert.equal(acceptedReport.phase_evaluation_base, mainSha);
assert.equal(acceptedReport.production_promotion_anchor_sha, candidateSha);
assert.equal(acceptedReport.production_promotion_rearm_depth, 1);

const productionTree = run("git", ["rev-parse", `${productionSha}^{tree}`], root).trim();
const advancedProductionSha = run("git", [
  "commit-tree", productionTree,
  "-p", productionSha,
  "-m", "advanced live Production"
], root).trim();
updateRemoteRef(remoteRoot, "refs/heads/Production", advancedProductionSha, root);
const staleBase = invoke(root, { base: productionSha, head: rearmSha, headRef: bridgeRef });
assert.notEqual(staleBase.status, 0);
const staleBaseReport = JSON.parse(staleBase.stdout);
assert.equal(staleBaseReport.production_promotion, false);
assert(staleBaseReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));
updateRemoteRef(remoteRoot, "refs/heads/Production", productionSha, root);

const advancedMainSha = run("git", [
  "commit-tree", mainTree,
  "-p", mainSha,
  "-m", "advanced live main"
], root).trim();
updateRemoteRef(remoteRoot, "refs/heads/main", advancedMainSha, root);
const staleMain = invoke(root, { base: productionSha, head: rearmSha, headRef: bridgeRef });
assert.notEqual(staleMain.status, 0);
const staleMainReport = JSON.parse(staleMain.stdout);
assert.equal(staleMainReport.production_promotion, false);
assert(staleMainReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));
updateRemoteRef(remoteRoot, "refs/heads/main", mainSha, root);

const wrongMainRef = `release/production-candidate-deadbeefdead-${productionSha.slice(0, 12)}-bridge-31282314470`;
const wrongMain = invoke(root, { base: productionSha, head: rearmSha, headRef: wrongMainRef });
assert.notEqual(wrongMain.status, 0);
const wrongMainReport = JSON.parse(wrongMain.stdout);
assert.equal(wrongMainReport.production_promotion, false);
assert(wrongMainReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));

const wrongProductionRef = `release/production-candidate-${mainSha.slice(0, 12)}-deadbeefdead-bridge-31282314470`;
const wrongProduction = invoke(root, { base: productionSha, head: rearmSha, headRef: wrongProductionRef });
assert.notEqual(wrongProduction.status, 0);
const wrongProductionReport = JSON.parse(wrongProduction.stdout);
assert.equal(wrongProductionReport.production_promotion, false);
assert(wrongProductionReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));

fs.writeFileSync(path.join(root, "README.md"), "mutated re-arm tree\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "mutated successor"], root);
const mutatedTree = run("git", ["rev-parse", "HEAD^{tree}"], root).trim();
const mutatedRearmSha = run("git", [
  "commit-tree", mutatedTree,
  "-p", candidateSha,
  "-m", "invalid mutated re-arm"
], root).trim();
const mutated = invoke(root, { base: productionSha, head: mutatedRearmSha, headRef: bridgeRef });
assert.notEqual(mutated.status, 0);
const mutatedReport = JSON.parse(mutated.stdout);
assert.equal(mutatedReport.production_promotion, false);
assert(mutatedReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));

console.log(JSON.stringify({
  ok: true,
  tests: 6,
  contract: "governed_dispatch_bridge_live_protected_refs_identity_and_zero_diff_rearm",
  secrets_included: false
}));
