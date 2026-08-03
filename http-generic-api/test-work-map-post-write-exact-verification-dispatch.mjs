import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ciWorkflow = readFileSync("../.github/workflows/ci.yml", "utf8");
const integrationWorkflow = readFileSync("../.github/workflows/spec-kit-work-map-integration.yml", "utf8");
const writerWorkflow = readFileSync("../.github/workflows/spec-kit-work-map-autofix.yml", "utf8");

assert.match(
  writerWorkflow,
  /gh workflow run ci\.yml[\s\S]*-f expected_head_sha="\$\{COMMITTED_HEAD_SHA\}"/u,
  "The governed writer must dispatch CI with the committed exact head SHA.",
);
assert.match(
  writerWorkflow,
  /gh workflow run spec-kit-work-map-integration\.yml[\s\S]*-f branch="\$\{TARGET_BRANCH\}"[\s\S]*-f expected_head_sha="\$\{COMMITTED_HEAD_SHA\}"/u,
  "The governed writer must dispatch Work Map integration with branch and exact head SHA.",
);

assert.match(
  ciWorkflow,
  /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*expected_head_sha:/u,
  "CI must declare the expected_head_sha dispatch input accepted from the governed writer.",
);
assert.match(
  ciWorkflow,
  /EXPECTED_CHECKED_OUT_SHA: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.expected_head_sha \|\| github\.sha \}\}/u,
);
assert.equal(
  (ciWorkflow.match(/ref: \$\{\{ env\.EXPECTED_CHECKED_OUT_SHA \}\}/gu) || []).length,
  4,
  "Every load-bearing CI job must check out the same expected SHA.",
);
assert.equal(
  (ciWorkflow.match(/test "\$\(git rev-parse HEAD\)" = "\$\{EXPECTED_CHECKED_OUT_SHA\}"/gu) || []).length,
  4,
  "Every load-bearing CI job must verify its checked-out SHA.",
);
assert.match(ciWorkflow, /GITHUB_SHA="\$actual_sha" npm test/u);
assert.match(ciWorkflow, /DEPLOYMENT_COMMIT_SHA: "\$\{\{ env\.EXPECTED_CHECKED_OUT_SHA \}\}"/u);

assert.match(
  integrationWorkflow,
  /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*branch:[\s\S]*expected_head_sha:/u,
  "Work Map integration must declare the branch and expected_head_sha inputs sent by the writer.",
);
assert.match(
  integrationWorkflow,
  /TARGET_BRANCH: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.branch/u,
);
assert.match(
  integrationWorkflow,
  /EXPECTED_CHECKED_OUT_SHA: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.expected_head_sha/u,
);
assert.match(integrationWorkflow, /ref: \$\{\{ env\.EXPECTED_CHECKED_OUT_SHA \}\}/u);
assert.match(
  integrationWorkflow,
  /git fetch --no-tags origin "\+refs\/heads\/\$\{TARGET_BRANCH\}:refs\/remotes\/origin\/\$\{TARGET_BRANCH\}"/u,
);
assert.match(
  integrationWorkflow,
  /test "\$\(git rev-parse "refs\/remotes\/origin\/\$\{TARGET_BRANCH\}"\)" = "\$\{EXPECTED_CHECKED_OUT_SHA\}"/u,
);
assert.match(integrationWorkflow, /target_branch: process\.env\.TARGET_BRANCH/u);

console.log("Work Map post-write exact verification dispatch contract tests passed");
