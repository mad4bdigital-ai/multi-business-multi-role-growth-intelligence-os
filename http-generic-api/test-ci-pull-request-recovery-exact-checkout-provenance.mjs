import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync("../.github/workflows/ci-pull-request-recovery.yml", "utf8");

assert.match(
  workflow,
  /- name: Run tests with exact checked-out identity[\s\S]*EXPECTED_TEST_CANDIDATE_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
);
assert.match(workflow, /actual_sha="\$\(git rev-parse HEAD\)"/u);
assert.match(workflow, /test "\$actual_sha" = "\$EXPECTED_TEST_CANDIDATE_SHA"/u);
assert.match(workflow, /GITHUB_SHA="\$actual_sha" npm test/u);
assert.doesNotMatch(
  workflow,
  /- name: Run tests\s+[\s\S]*?run: npm test/u,
  "Recovery must not emit test reports under an unverified event-level GITHUB_SHA.",
);

console.log("CI Pull Request Recovery exact checkout provenance tests passed");
