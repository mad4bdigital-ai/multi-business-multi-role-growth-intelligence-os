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

function invoke(root, { base, head, headRef, environment = {} }) {
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
    env: {
      ...process.env,
      GITHUB_TOKEN_FOR_REF_LOOKUP: "",
      ...environment
    }
  });
}

function updateRemoteRef(remoteRoot, ref, sha, cwd) {
  run("git", ["--git-dir", remoteRoot, "fetch", "--quiet", cwd, sha], cwd);
  run("git", ["--git-dir", remoteRoot, "update-ref", ref, sha], cwd);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-production-bridge-"));
const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-production-bridge-origin-"));
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-production-bridge-gh-"));
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

const fakeGh = path.join(fakeBin, "gh");
fs.writeFileSync(fakeGh, `#!/usr/bin/env node
const [verb, endpoint, jqFlag, jqQuery] = process.argv.slice(2);
if (process.env.GH_TOKEN !== "synthetic-read-token") process.exit(21);
if (process.env.FAKE_GH_FORCE_FAILURE === "1") process.exit(22);
if (verb !== "api" || jqFlag !== "--jq" || jqQuery !== ".object.sha") process.exit(23);
if (endpoint === "repos/example/private-repo/git/ref/heads/main") {
  process.stdout.write(String(process.env.FAKE_GH_MAIN_SHA || "") + "\\n");
} else if (endpoint === "repos/example/private-repo/git/ref/heads/Production") {
  process.stdout.write(String(process.env.FAKE_GH_PRODUCTION_SHA || "") + "\\n");
} else {
  process.exit(24);
}
`);
fs.chmodSync(fakeGh, 0o755);
const authenticatedEnvironment = {
  GITHUB_TOKEN_FOR_REF_LOOKUP: "synthetic-read-token",
  GITHUB_REPOSITORY: "example/private-repo",
  FAKE_GH_MAIN_SHA: mainSha,
  FAKE_GH_PRODUCTION_SHA: productionSha,
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`
};

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
const pushFallbackRef = `release/production-candidate-${mainSha.slice(0, 12)}-${productionSha.slice(0, 12)}-push-31282314471`;

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

const pushFallbackAccepted = invoke(root, { base: productionSha, head: rearmSha, headRef: pushFallbackRef });
assert.equal(pushFallbackAccepted.status, 0, pushFallbackAccepted.stderr || pushFallbackAccepted.stdout);
const pushFallbackAcceptedReport = JSON.parse(pushFallbackAccepted.stdout);
assert.equal(pushFallbackAcceptedReport.ok, true, JSON.stringify(pushFallbackAcceptedReport.findings));
assert.equal(pushFallbackAcceptedReport.production_promotion, true);
assert.equal(pushFallbackAcceptedReport.production_promotion_identity, "history_preserving_main_reconciliation");
assert.equal(pushFallbackAcceptedReport.phase_evaluation_base, mainSha);
assert.equal(pushFallbackAcceptedReport.production_promotion_anchor_sha, candidateSha);
assert.equal(pushFallbackAcceptedReport.production_promotion_rearm_depth, 1);

const unsupportedGovernedSuffixRef = `release/production-candidate-${mainSha.slice(0, 12)}-${productionSha.slice(0, 12)}-manual-31282314472`;
const unsupportedGovernedSuffix = invoke(root, { base: productionSha, head: rearmSha, headRef: unsupportedGovernedSuffixRef });
assert.notEqual(unsupportedGovernedSuffix.status, 0);
const unsupportedGovernedSuffixReport = JSON.parse(unsupportedGovernedSuffix.stdout);
assert.equal(unsupportedGovernedSuffixReport.production_promotion, false);
assert(unsupportedGovernedSuffixReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));

const authenticatedAccepted = invoke(root, {
  base: productionSha,
  head: rearmSha,
  headRef: bridgeRef,
  environment: authenticatedEnvironment
});
assert.equal(authenticatedAccepted.status, 0, authenticatedAccepted.stderr || authenticatedAccepted.stdout);
const authenticatedAcceptedReport = JSON.parse(authenticatedAccepted.stdout);
assert.equal(authenticatedAcceptedReport.production_promotion, true);
assert.equal(authenticatedAcceptedReport.production_promotion_identity, "history_preserving_main_reconciliation");

const authenticatedFailure = invoke(root, {
  base: productionSha,
  head: rearmSha,
  headRef: bridgeRef,
  environment: { ...authenticatedEnvironment, FAKE_GH_FORCE_FAILURE: "1" }
});
assert.notEqual(authenticatedFailure.status, 0, "authenticated API failure must not fall back to unauthenticated git");
const authenticatedFailureReport = JSON.parse(authenticatedFailure.stdout);
assert.equal(authenticatedFailureReport.production_promotion, false);
assert(authenticatedFailureReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));

const shaBoundRef = `release/production-candidate-${candidateSha.slice(0, 8)}`;
const exactShaBound = invoke(root, { base: productionSha, head: candidateSha, headRef: shaBoundRef });
assert.equal(exactShaBound.status, 0, exactShaBound.stderr || exactShaBound.stdout);
const exactShaBoundReport = JSON.parse(exactShaBound.stdout);
assert.equal(exactShaBoundReport.production_promotion, true);
assert.equal(exactShaBoundReport.production_promotion_identity, "history_preserving_main_reconciliation");
assert.equal(exactShaBoundReport.production_promotion_anchor_sha, candidateSha);
assert.equal(exactShaBoundReport.production_promotion_rearm_depth, 0);

run("git", ["update-ref", "-d", "refs/remotes/origin/main"], root);
const localMainShaBound = invoke(root, { base: productionSha, head: candidateSha, headRef: shaBoundRef });
assert.equal(localMainShaBound.status, 0, localMainShaBound.stderr || localMainShaBound.stdout);
const localMainShaBoundReport = JSON.parse(localMainShaBound.stdout);
assert.equal(localMainShaBoundReport.production_promotion, true);
assert.equal(localMainShaBoundReport.production_promotion_identity, "history_preserving_main_reconciliation");

const bridgeWithoutRemoteTrackingMain = invoke(root, { base: productionSha, head: rearmSha, headRef: bridgeRef });
assert.notEqual(bridgeWithoutRemoteTrackingMain.status, 0, "dispatch bridge must retain strict remote-main identity");
const bridgeWithoutRemoteTrackingMainReport = JSON.parse(bridgeWithoutRemoteTrackingMain.stdout);
assert.equal(bridgeWithoutRemoteTrackingMainReport.production_promotion, false);
assert(bridgeWithoutRemoteTrackingMainReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));
run("git", ["update-ref", "refs/remotes/origin/main", mainSha], root);

const rearmedShaBound = invoke(root, { base: productionSha, head: rearmSha, headRef: shaBoundRef });
assert.notEqual(rearmedShaBound.status, 0);
const rearmedShaBoundReport = JSON.parse(rearmedShaBound.stdout);
assert.equal(rearmedShaBoundReport.production_promotion, false);
assert(rearmedShaBoundReport.findings.some((row) => row.code === "production_promotion_identity_invalid"));

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
  tests: 14,
  contract: "governed_dispatch_bridge_and_push_fallback_authenticated_live_refs_exact_sha_bound_identity_local_main_fallback_and_zero_diff_rearm",
  authenticated_ref_lookup: true,
  authenticated_lookup_fails_closed_without_git_fallback: true,
  secrets_included: false
}));
