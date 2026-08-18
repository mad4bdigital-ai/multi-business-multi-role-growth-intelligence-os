import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiRoot = path.join(repositoryRoot, "http-generic-api");
const generator = path.join(apiRoot, "scripts", "prepare-staging-build-context.mjs");
const commit = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const tree = execFileSync("git", ["-C", repositoryRoot, "rev-parse", `${commit}^{tree}`], { encoding: "utf8" }).trim();
const fixtureRelative = "http-generic-api/.env.staging";
const fixturePath = path.join(repositoryRoot, fixtureRelative);
const contextPath = path.join(repositoryRoot, ".staging-build-context");
const expectedFileSet = crypto.createHash("sha256").update(
  execFileSync("git", ["-C", repositoryRoot, "ls-tree", "-r", "--name-only", commit], { encoding: "utf8" }),
).digest("hex");

fs.writeFileSync(fixturePath, "IGNORED_BUILD_CONTEXT_SECRET=fixture-secret-that-must-never-enter-image\n", "utf8");
try {
  execFileSync("git", ["-C", repositoryRoot, "check-ignore", "-q", fixtureRelative]);
  execFileSync(process.execPath, [generator, "--repository-path", repositoryRoot, "--commit", commit, "--output-dir", contextPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const metadata = JSON.parse(fs.readFileSync(path.join(contextPath, ".staging-build-context.json"), "utf8"));
  assert.equal(metadata.contract, "mad4b.staging-build-context.v1");
  assert.equal(metadata.commit_sha, commit);
  assert.equal(metadata.tree_sha, tree);
  assert.equal(metadata.context_file_set_sha256, expectedFileSet);
  assert.equal(metadata.source, "git_archive_exact_commit");
  assert.equal(metadata.local_ignored_files_included, false);
  assert.equal(metadata.secrets_included, false);
  assert.equal(fs.existsSync(path.join(contextPath, fixtureRelative)), false, "ignored secret fixture must not enter exact Git context");
  for (const required of [
    ".dockerignore",
    ".staging-build-context.json",
    "canonical-manifest.mjs",
    "http-generic-api/Dockerfile.staging",
    "http-generic-api/docker-compose.staging.yml",
    "edge/activation-gateway/generated/route-policy.staging.json",
  ]) {
    assert.equal(fs.existsSync(path.join(contextPath, required)), true, `required context file missing: ${required}`);
  }
  console.log(JSON.stringify({ ok: true, contract: "mad4b.staging-build-context.v1", exact_commit: true, exact_tree: true, ignored_secret_excluded: true, context_file_set_verified: true, secrets_included: false }));
} finally {
  fs.rmSync(fixturePath, { force: true });
  fs.rmSync(contextPath, { recursive: true, force: true });
}
