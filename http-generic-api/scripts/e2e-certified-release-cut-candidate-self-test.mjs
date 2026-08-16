#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCertifiedReleaseCutRef } from "./e2e-parallel-pr-gate.mjs";

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
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_TOKEN_FOR_REF_LOOKUP: "", GITHUB_OUTPUT: "" }
  });
}

function updateRemoteRef(remoteRoot, ref, sha, cwd) {
  run("git", ["--git-dir", remoteRoot, "fetch", "--quiet", cwd, sha], cwd);
  run("git", ["--git-dir", remoteRoot, "update-ref", ref, sha], cwd);
}

assert.deepEqual(
  parseCertifiedReleaseCutRef("release/production-candidate-4607b4be9962-acbfb1351fdf-31862463986-1"),
  {
    release_cut_prefix: "4607b4be9962",
    production_prefix: "acbfb1351fdf",
    launcher_run_id: "31862463986",
    launcher_run_attempt: "1"
  }
);
assert.equal(parseCertifiedReleaseCutRef("release/production-candidate-4607b4be9962-acbfb1351fdf-31862463986-0"), null);
assert.equal(parseCertifiedReleaseCutRef("release/production-candidate-4607b4be9962-acbfb1351fdf-bridge-31862463986"), null);
assert.equal(parseCertifiedReleaseCutRef("release/production-candidate-deadbeef-acbfb135-1-1"), null);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-certified-release-cut-"));
const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-certified-release-cut-origin-"));
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

fs.writeFileSync(path.join(root, "README.md"), "certified release cut\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "certified release cut"], root);
const releaseCutSha = run("git", ["rev-parse", "HEAD"], root).trim();
const releaseCutTree = run("git", ["rev-parse", `${releaseCutSha}^{tree}`], root).trim();

fs.writeFileSync(path.join(root, "AFTER_CUT.md"), "main may advance after certification\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "advance main after release cut"], root);
const currentMainSha = run("git", ["rev-parse", "HEAD"], root).trim();
run("git", ["update-ref", "refs/heads/main", currentMainSha], root);
run("git", ["update-ref", "refs/remotes/origin/main", currentMainSha], root);
updateRemoteRef(remoteRoot, "refs/heads/main", currentMainSha, root);

const candidateSha = run("git", [
  "commit-tree", releaseCutTree,
  "-p", releaseCutSha,
  "-p", productionSha,
  "-m", "immutable certified Production candidate"
], root).trim();
const candidateRef = `release/production-candidate-${releaseCutSha.slice(0, 12)}-${productionSha.slice(0, 12)}-31862463986-1`;

const accepted = invoke(root, { base: productionSha, head: candidateSha, headRef: candidateRef });
assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
const acceptedReport = JSON.parse(accepted.stdout);
assert.equal(acceptedReport.ok, true, JSON.stringify(acceptedReport.findings));
assert.equal(acceptedReport.production_promotion, true);
assert.equal(acceptedReport.production_promotion_identity, "certified_release_cut_reconciliation");
assert.equal(acceptedReport.phase_evaluation_base, releaseCutSha);
assert.equal(acceptedReport.production_promotion_anchor_sha, candidateSha);
assert.equal(acceptedReport.production_promotion_rearm_depth, 0);
assert.equal(acceptedReport.production_release_cut_sha, releaseCutSha);
assert.equal(acceptedReport.production_release_cut_current_main_sha, currentMainSha);
assert.equal(acceptedReport.production_release_cut_mode, true);
assert.equal(acceptedReport.production_ref_stable, true);
assert.equal(acceptedReport.main_tip_may_advance, true);

const wrongCutPrefix = invoke(root, {
  base: productionSha,
  head: candidateSha,
  headRef: `release/production-candidate-deadbeefdead-${productionSha.slice(0, 12)}-31862463986-1`
});
assert.notEqual(wrongCutPrefix.status, 0);
assert(JSON.parse(wrongCutPrefix.stdout).findings.some((row) => row.code === "production_promotion_identity_invalid"));

const wrongTree = run("git", ["rev-parse", `${currentMainSha}^{tree}`], root).trim();
const wrongTreeCandidate = run("git", [
  "commit-tree", wrongTree,
  "-p", releaseCutSha,
  "-p", productionSha,
  "-m", "wrong candidate tree"
], root).trim();
const wrongTreeResult = invoke(root, { base: productionSha, head: wrongTreeCandidate, headRef: candidateRef });
assert.notEqual(wrongTreeResult.status, 0);
assert(JSON.parse(wrongTreeResult.stdout).findings.some((row) => row.code === "production_promotion_identity_invalid"));

const thirdParentCandidate = run("git", [
  "commit-tree", releaseCutTree,
  "-p", releaseCutSha,
  "-p", productionSha,
  "-p", currentMainSha,
  "-m", "unexpected third parent"
], root).trim();
const thirdParentResult = invoke(root, { base: productionSha, head: thirdParentCandidate, headRef: candidateRef });
assert.notEqual(thirdParentResult.status, 0);
assert(JSON.parse(thirdParentResult.stdout).findings.some((row) => row.code === "production_promotion_identity_invalid"));

const productionTree = run("git", ["rev-parse", `${productionSha}^{tree}`], root).trim();
const advancedProductionSha = run("git", [
  "commit-tree", productionTree,
  "-p", productionSha,
  "-m", "Production moved"
], root).trim();
updateRemoteRef(remoteRoot, "refs/heads/Production", advancedProductionSha, root);
const staleProduction = invoke(root, { base: productionSha, head: candidateSha, headRef: candidateRef });
assert.notEqual(staleProduction.status, 0);
assert(JSON.parse(staleProduction.stdout).findings.some((row) => row.code === "production_promotion_identity_invalid"));
updateRemoteRef(remoteRoot, "refs/heads/Production", productionSha, root);

run("git", ["checkout", "--orphan", "unrelated-main"], root);
for (const entry of fs.readdirSync(root)) {
  if (entry !== ".git" && entry !== ".specify") fs.rmSync(path.join(root, entry), { recursive: true, force: true });
}
fs.writeFileSync(path.join(root, "UNRELATED.md"), "not descended from the release cut\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "unrelated main"], root);
const unrelatedMainSha = run("git", ["rev-parse", "HEAD"], root).trim();
updateRemoteRef(remoteRoot, "refs/heads/main", unrelatedMainSha, root);
const staleCut = invoke(root, { base: productionSha, head: candidateSha, headRef: candidateRef });
assert.notEqual(staleCut.status, 0);
assert(JSON.parse(staleCut.stdout).findings.some((row) => row.code === "production_promotion_identity_invalid"));

console.log(JSON.stringify({
  ok: true,
  tests: 9,
  contract: "certified_release_cut_candidate_identity_with_moving_main_and_exact_production_pin",
  main_tip_may_advance: true,
  production_ref_must_remain_exact: true,
  candidate_tree_must_equal_release_cut: true,
  secrets_included: false
}));
