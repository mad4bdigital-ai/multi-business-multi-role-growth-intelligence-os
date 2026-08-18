import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONTRACT = "mad4b.staging-build-context.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : fallback;
}

function fail(message) {
  throw new Error(`STAGING_BUILD_CONTEXT_FAIL_CLOSED: ${message}`);
}

function git(args, cwd) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    fail(`git ${args.join(" ")} failed: ${String(error?.message || error).slice(0, 240)}`);
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function trackedFiles(commit, cwd) {
  return git(["ls-tree", "-r", "--name-only", commit], cwd).split(/\r?\n/u).filter(Boolean);
}

const requestedRepository = argument("--repository-path", repositoryRoot);
const commit = argument("--commit").toLowerCase();
const outputDir = path.resolve(argument("--output-dir"));
const repositoryPath = path.resolve(requestedRepository);
if (!SHA_RE.test(commit)) fail("--commit must be an exact lowercase 40-character SHA");
if (!fs.existsSync(path.join(repositoryPath, ".git"))) fail("--repository-path must be a Git worktree");
if (!outputDir.endsWith(`${path.sep}.staging-build-context`) && path.basename(outputDir) !== ".staging-build-context") {
  fail("--output-dir must be a local .staging-build-context directory");
}
if (outputDir === repositoryPath || outputDir.startsWith(`${repositoryPath}${path.sep}.git${path.sep}`)) {
  fail("refusing to overwrite the repository or its Git metadata");
}

const treeSha = git(["rev-parse", `${commit}^{tree}`], repositoryPath).toLowerCase();
if (!/^[0-9a-f]{40}$/u.test(treeSha)) fail("commit tree identity is not exact");
const files = trackedFiles(commit, repositoryPath);
if (files.length === 0) fail("exact commit tree is empty");

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
const archivePath = path.join(os.tmpdir(), `mad4b-staging-build-context-${process.pid}-${Date.now()}.tar`);
try {
  execFileSync("git", ["-C", repositoryPath, "archive", "--format=tar", "--output", archivePath, commit], { stdio: "inherit" });
  execFileSync("tar", ["-xf", archivePath, "-C", outputDir], { stdio: "inherit" });
} catch (error) {
  fail(`exact Git tree archive extraction failed: ${String(error?.message || error).slice(0, 240)}`);
} finally {
  fs.rmSync(archivePath, { force: true });
}

for (const required of [
  ".dockerignore",
  "canonical-manifest.mjs",
  "http-generic-api/Dockerfile.staging",
  "http-generic-api/docker-compose.staging.yml",
  "edge/activation-gateway/generated/route-policy.staging.json",
]) {
  if (!fs.existsSync(path.join(outputDir, required))) fail(`exact context is missing required tracked file: ${required}`);
}
const metadata = {
  contract: CONTRACT,
  repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  commit_sha: commit,
  tree_sha: treeSha,
  source: "git_archive_exact_commit",
  tracked_file_count: files.length,
  context_file_set_sha256: crypto.createHash("sha256").update(files.join("\n") + "\n").digest("hex"),
  local_ignored_files_included: false,
  secrets_included: false,
};
fs.writeFileSync(path.join(outputDir, ".staging-build-context.json"), `${JSON.stringify(metadata, null, 2)}\n`);

console.log(JSON.stringify({ ok: true, contract: CONTRACT, output_dir: outputDir, commit_sha: commit, tree_sha: treeSha, tracked_file_count: files.length, context_file_set_sha256: metadata.context_file_set_sha256, local_ignored_files_included: false, secrets_included: false }));
