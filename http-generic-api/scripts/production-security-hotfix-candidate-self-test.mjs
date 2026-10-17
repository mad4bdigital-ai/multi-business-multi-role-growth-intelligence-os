#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectProductionSecurityHotfix } from "./production-security-hotfix-candidate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-prod-hotfix-"));
const root = path.join(fixture, "repo");
const origin = path.join(fixture, "origin.git");
const git = (args, cwd = root) => execFileSync("git", args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
}).trim();
const writeLock = (version, resolvedHost = "registry.npmjs.org", extraPackage = false) => {
  const lock = {
    name: "security-fixture", version: "1.0.0", lockfileVersion: 3,
    packages: {
      "": { name: "security-fixture", version: "1.0.0" },
      "node_modules/fixture-dep": {
        version, resolved: `https://${resolvedHost}/fixture-dep/-/fixture-dep-${version}.tgz`,
        integrity: "sha512-MTIzNA==", license: "MIT"
      }
    }
  };
  if (extraPackage) lock.packages["node_modules/unrelated"] = {
    version: "1.0.0",
    resolved: "https://registry.npmjs.org/unrelated/-/unrelated-1.0.0.tgz",
    integrity: "sha512-MTIzNA=="
  };
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
};
let baseSha;
const report = (headSha, overrides = {}) => inspectProductionSecurityHotfix({
  root, baseRef: "Production", headRef: "security/production-hotfix-20261017",
  baseSha, headSha, ...overrides
});
const assertDenied = (headSha, overrides, reason) => {
  const actual = report(headSha, overrides);
  assert.equal(actual.ok, false, JSON.stringify(actual));
  assert.equal(actual.reason, reason, JSON.stringify(actual));
  assert.equal(actual.authority_eligible, false);
};
try {
  fs.mkdirSync(root);
  git(["init", "--bare", origin], fixture);
  git(["init", "-b", "Production"]);
  git(["config", "user.name", "Security CI"]);
  git(["config", "user.email", "security-ci@example.invalid"]);
  git(["remote", "add", "origin", origin]);
  fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
  fs.copyFileSync(path.resolve(HERE, "../../.specify/e2e-phase-governance.json"),
    path.join(root, ".specify/e2e-phase-governance.json"));
  writeLock("1.0.0");
  git(["add", "."]);
  git(["commit", "-m", "baseline Production"]);
  baseSha = git(["rev-parse", "HEAD"]);
  git(["push", "origin", "Production"]);
  git(["switch", "-c", "security/production-hotfix-20261017"]);
  writeLock("1.0.1");
  git(["add", "package-lock.json"]);
  git(["commit", "-m", "upgrade pinned dependency"]);
  const validHead = git(["rev-parse", "HEAD"]);
  const accepted = report(validHead);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal(accepted.authority_eligible, false);
  assert.equal(accepted.production_promotion, false);
  assert.equal(accepted.requires_independent_owner_attestation, true);
  assert.deepEqual(accepted.changed_files, ["package-lock.json"]);
  assertDenied(validHead, { baseRef: "main" }, "unsupported_identity");
  assertDenied(validHead, { headRef: "feature/hotfix" }, "unsupported_identity");
  assertDenied(validHead, { headRef: "release/production-candidate-12345678" }, "unsupported_identity");
  assertDenied(validHead, { baseSha: "f".repeat(40) }, "production_base_not_live");
  assertDenied("f".repeat(40), {}, "head_unavailable");
  const cli = execFileSync(process.execPath, [
    path.join(HERE, "e2e-parallel-pr-gate-legacy.mjs"),
    "--root", root, "--base", baseSha, "--head", validHead,
    "--head-ref", "security/production-hotfix-20261017", "--base-ref", "Production"
  ], { encoding: "utf8" });
  const legacy = JSON.parse(cli);
  assert.equal(legacy.ok, true, JSON.stringify(legacy.findings));
  assert.equal(legacy.production_promotion, false);
  assert.equal(legacy.production_security_hotfix_candidate, true);
  assert.equal(legacy.production_security_hotfix_authority_eligible, false);
  fs.writeFileSync(path.join(root, "README.md"), "unrelated code changed\n");
  git(["add", "README.md"]);
  git(["commit", "-m", "wrong scope"]);
  assertDenied(git(["rev-parse", "HEAD"]), {}, "scope_outside_lockfiles");
  const resetFixture = () => git(["reset", "--hard", baseSha]); // Isolated disposable fixture only
  resetFixture();
  writeLock("1.0.2", "evil.invalid");
  git(["add", "package-lock.json"]);
  git(["commit", "-m", "nonregistry tarball"]);
  assertDenied(git(["rev-parse", "HEAD"]), {}, "non_upgrade_lockfile_change");
  resetFixture();
  writeLock("0.9.0");
  git(["add", "package-lock.json"]);
  git(["commit", "-m", "unsafe downgrade"]);
  assertDenied(git(["rev-parse", "HEAD"]), {}, "non_upgrade_lockfile_change");
  resetFixture();
  writeLock("1.0.2", "registry.npmjs.org", true);
  git(["add", "package-lock.json"]);
  git(["commit", "-m", "new dependency"]);
  assertDenied(git(["rev-parse", "HEAD"]), {}, "non_upgrade_lockfile_change");
  resetFixture();
  writeLock("1.0.2");
  const data = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  data.packages[""].version = "9.0.0";
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify(data, null, 2));
  git(["add", "package-lock.json"]);
  git(["commit", "-m", "root manifest changed"]);
  assertDenied(git(["rev-parse", "HEAD"]), {}, "non_upgrade_lockfile_change");
  git(["push", "--force", "origin", "HEAD:Production"]); // Disposable local bare fixture only
  assertDenied(validHead, {}, "production_base_not_live");
  console.log(JSON.stringify({
    ok: true, scenarios: 13,
    accepted_only_as_candidate: true,
    owner_approval_required: true,
    live_production_mutated: false
  }));
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
