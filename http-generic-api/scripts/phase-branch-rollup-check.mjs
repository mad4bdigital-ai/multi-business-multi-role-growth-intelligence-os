import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const worktreeRoot = path.resolve(apiRoot, "..");
const completionPath = path.resolve(
  worktreeRoot,
  "specs/001-capability-security-hardening/completion.json",
);

const gitExecutable = process.env.GIT_EXECUTABLE
  || (existsSync("C:\\Program Files\\Git\\cmd\\git.exe") ? "C:\\Program Files\\Git\\cmd\\git.exe" : "git");

function git(args, cwd = worktreeRoot) {
  return execFileSync(gitExecutable, args, { cwd, encoding: "utf8" }).trim();
}

function isAncestor(commit, cwd) {
  try {
    execFileSync(gitExecutable, ["merge-base", "--is-ancestor", commit, "HEAD"], { cwd, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function parseWorktrees(output) {
  const entries = [];
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length) };
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
  }
  if (current) entries.push(current);
  return entries;
}

const completion = JSON.parse(readFileSync(completionPath, "utf8"));
const rollup = completion.evidence?.phase_branch_rollup;

assert.equal(
  rollup?.status,
  "local_phase_branches_implemented_pending_reconciliation_ci_and_release_gates",
);
assert.equal(rollup.release_merge_allowed, false);
assert.equal(rollup.ci_required_before_merge, true);
assert.equal(rollup.production_promotion_authorized, false);

const worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"]));
const failures = [];

for (const [phaseKey, expected] of Object.entries(rollup.branch_commits || {})) {
  const entry = worktrees.find((item) => item.branch === expected.branch);
  if (!entry) {
    failures.push(`${phaseKey}: missing worktree for ${expected.branch}`);
    continue;
  }
  if (!isAncestor(expected.commit, entry.path)) {
    failures.push(`${phaseKey}: expected ${expected.commit} to be an ancestor of ${entry.head}`);
  }
  const status = git(["-C", entry.path, "status", "--short"]);
  if (status) {
    failures.push(`${phaseKey}: worktree is not clean at ${entry.path}`);
  }
}

assert.deepEqual(failures, []);
console.log("phase branch rollup worktree check passed");
