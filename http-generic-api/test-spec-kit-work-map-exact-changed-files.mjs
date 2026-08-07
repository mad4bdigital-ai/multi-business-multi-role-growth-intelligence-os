import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveExactChangedFiles } from "./scripts/spec-kit-work-map-governance-gate.mjs";

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.test",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.test",
    },
    ...options,
  }).trim();
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-exact-diff-"));
git(root, ["init"]);
write(root, "specs/014-retail-commerce-operations-growth-os/README.md", "current readme\n");
write(root, "specs/014-retail-commerce-operations-growth-os/plan.md", "current plan\n");
write(root, "governance.txt", "base\n");
git(root, ["add", "."]);
git(root, ["commit", "-m", "base"]);
const baseSha = git(root, ["rev-parse", "HEAD"]);

git(root, ["checkout", "-b", "historical-parent"]);
write(root, "specs/014-retail-commerce-operations-growth-os/README.md", "historical readme\n");
write(root, "specs/014-retail-commerce-operations-growth-os/plan.md", "historical plan\n");
git(root, ["add", "."]);
git(root, ["commit", "-m", "historical parent"]);
const historicalParent = git(root, ["rev-parse", "HEAD"]);

git(root, ["checkout", "--detach", baseSha]);
write(root, "governance.txt", "bounded cleanup\n");
git(root, ["add", "governance.txt"]);
git(root, ["commit", "-m", "bounded cleanup"]);
const intendedTree = git(root, ["rev-parse", "HEAD^{tree}"]);
const mergeSha = git(root, ["commit-tree", intendedTree, "-p", historicalParent, "-p", baseSha, "-m", "rebuild on exact base"]);
git(root, ["checkout", "--detach", mergeSha]);

const fallbackDiff = git(root, ["diff", "--name-only", "HEAD~1...HEAD"]).split(/\r?\n/).filter(Boolean);
assert(fallbackDiff.includes("specs/014-retail-commerce-operations-growth-os/README.md"));
assert(fallbackDiff.includes("specs/014-retail-commerce-operations-growth-os/plan.md"));

const exact = await resolveExactChangedFiles({
  root,
  env: { GITHUB_EVENT_NAME: "pull_request" },
  eventName: "pull_request",
  eventPayload: {
    pull_request: {
      base: { sha: baseSha },
      head: { sha: mergeSha },
    },
  },
});
assert.deepEqual(exact, ["governance.txt"]);

await assert.rejects(
  resolveExactChangedFiles({
    root,
    env: { GITHUB_EVENT_NAME: "pull_request" },
    eventName: "pull_request",
    eventPayload: {
      pull_request: {
        base: { sha: "f".repeat(40) },
        head: { sha: mergeSha },
      },
    },
  }),
  /base SHA is not available/,
);

const dispatch = await resolveExactChangedFiles({
  root,
  env: {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: "example/repo",
    EXPECTED_CHECKED_OUT_SHA: mergeSha,
  },
  eventName: "workflow_dispatch",
  eventPayload: { inputs: { target_pr: "6314", target_sha: mergeSha } },
  pullRequestIdentity: {
    state: "open",
    baseSha,
    headSha: mergeSha,
    headRef: "feature",
  },
});
assert.deepEqual(dispatch, ["governance.txt"]);

await assert.rejects(
  resolveExactChangedFiles({
    root,
    env: {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REPOSITORY: "example/repo",
      EXPECTED_CHECKED_OUT_SHA: "e".repeat(40),
    },
    eventName: "workflow_dispatch",
    eventPayload: { inputs: { target_pr: "6314", target_sha: "e".repeat(40) } },
    pullRequestIdentity: {
      state: "open",
      baseSha,
      headSha: mergeSha,
      headRef: "feature",
    },
  }),
  /head moved/,
);

console.log("exact Work Map changed-file resolution tests passed");
