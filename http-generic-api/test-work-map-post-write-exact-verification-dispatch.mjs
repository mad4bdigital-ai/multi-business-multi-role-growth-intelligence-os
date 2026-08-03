import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ciWorkflow = readFileSync("../.github/workflows/ci.yml", "utf8");
const integrationWorkflow = readFileSync("../.github/workflows/spec-kit-work-map-integration.yml", "utf8");
const writerWorkflow = readFileSync("../.github/workflows/spec-kit-work-map-autofix.yml", "utf8");

for (const snippet of [
  'actions/workflows/ci.yml/dispatches',
  'actions/workflows/spec-kit-work-map-integration.yml/dispatches',
  "'{ref:$ref,inputs:{expected_head_sha:$expected_head_sha}}'",
  "'{ref:$ref,inputs:{branch:$branch,expected_head_sha:$expected_head_sha}}'",
  'actions/workflows/${workflow}/enable',
  'dispatch-ci.stderr',
  'dispatch-work-map-integration.stderr',
  '.head_sha ==',
  '${RESULT_HEAD_SHA}',
  'ci_run_id=${ci_run_id}',
  'integration_run_id=${integration_run_id}',
  'WORK_MAP_AUTOFIX_V3',
]) {
  assert.ok(writerWorkflow.includes(snippet), `Writer dispatch contract missing: ${snippet}`);
}
assert.doesNotMatch(
  writerWorkflow,
  /gh workflow run (?:ci\.yml|spec-kit-work-map-integration\.yml)/u,
  "The writer must use observable REST dispatches instead of unbounded gh workflow run calls.",
);
assert.match(
  writerWorkflow,
  /test "\$\{remote_head_sha\}" = "\$\{RESULT_HEAD_SHA\}"/u,
  "The writer must read back the committed branch head before verification dispatch.",
);
assert.match(
  writerWorkflow,
  /\[\[ "\$\{ci_run_id\}" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/u,
  "The writer must fail closed unless a CI verification run ID is observed.",
);
assert.match(
  writerWorkflow,
  /\[\[ "\$\{integration_run_id\}" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/u,
  "The writer must fail closed unless a Work Map verification run ID is observed.",
);

assert.match(
  ciWorkflow,
  /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*expected_head_sha:/u,
  "CI must declare the expected_head_sha input sent by the governed writer.",
);
assert.match(
  ciWorkflow,
  /EXPECTED_CHECKED_OUT_SHA: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.expected_head_sha \|\| github\.sha \}\}/u,
);
assert.equal(
  (ciWorkflow.match(/ref: \$\{\{ env\.EXPECTED_CHECKED_OUT_SHA \}\}/gu) || []).length,
  4,
  "Every load-bearing CI job must check out the same selected SHA.",
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
