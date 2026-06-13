import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "mad4b-deployment-generator-"));
const manifestPath = join(dir, "deployment-manifest.json");
const commitSha = "0123456789abcdef0123456789abcdef01234567";

try {
  execFileSync(process.execPath, [
    "scripts/generate-deployment-manifest.mjs",
    `--out=${manifestPath}`,
  ], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      DEPLOYMENT_BRANCH: "main",
      DEPLOYMENT_COMMIT_SHA: commitSha,
    },
    stdio: "pipe",
  });

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.branch, "main", "explicit deployment branch is recorded");
  assert.equal(manifest.branch_source, "env:DEPLOYMENT_BRANCH", "branch evidence source is recorded");
  assert.equal(manifest.commit_sha, commitSha, "explicit deployment commit is recorded");
  assert.equal(manifest.commit_source, "env:DEPLOYMENT_COMMIT_SHA", "commit evidence source is recorded");
  assert.equal(manifest.build_source, "git", "build source remains git");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("deployment manifest generator test passed");
