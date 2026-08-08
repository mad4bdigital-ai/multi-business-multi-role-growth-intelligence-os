import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ciWorkflow = readFileSync("../.github/workflows/ci.yml", "utf8");
const recoveryWorkflow = readFileSync("../.github/workflows/ci-pull-request-recovery.yml", "utf8");

assert.match(
  recoveryWorkflow,
  /- name: Run tests with exact checked-out identity[\s\S]*EXPECTED_TEST_CANDIDATE_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
);
assert.match(recoveryWorkflow, /actual_sha="\$\(git rev-parse HEAD\)"/u);
assert.match(recoveryWorkflow, /test "\$actual_sha" = "\$EXPECTED_TEST_CANDIDATE_SHA"/u);
assert.match(recoveryWorkflow, /GITHUB_SHA="\$actual_sha" npm test/u);
assert.doesNotMatch(
  recoveryWorkflow,
  /- name: Run tests\s+[\s\S]*?run: npm test/u,
  "Recovery must not emit test reports under an unverified event-level GITHUB_SHA.",
);

const pullRequestOnlyCancellation = /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/u;
for (const [name, workflow] of [
  ["CI", ciWorkflow],
  ["CI Pull Request Recovery", recoveryWorkflow],
]) {
  assert.match(
    workflow,
    pullRequestOnlyCancellation,
    `${name} must cancel only superseded pull-request runs.`,
  );
  assert.doesNotMatch(
    workflow,
    /cancel-in-progress:\s*true/u,
    `${name} must not make push or workflow-dispatch runs unconditionally cancellable.`,
  );
  assert.match(workflow, /workflow_dispatch:/u);
}
assert.match(ciWorkflow, /\n  push:\n/u, "CI push verification must remain enabled.");
assert.match(recoveryWorkflow, /group: ci-pr-recovery-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/u);

console.log("CI exact checkout provenance and PR stale-run cancellation tests passed");
