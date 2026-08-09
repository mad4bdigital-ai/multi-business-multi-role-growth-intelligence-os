import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ciWorkflow = readFileSync("../.github/workflows/ci.yml", "utf8");
const recoveryWorkflow = readFileSync("../.github/workflows/ci-pull-request-recovery.yml", "utf8");

for (const input of ["pull_request_number", "candidate_sha", "expected_base_ref", "expected_base_sha"]) {
  assert.match(
    recoveryWorkflow,
    new RegExp(`workflow_dispatch:[\\s\\S]*?${input}:`, "u"),
    `Recovery workflow_dispatch must declare ${input}.`,
  );
}
assert.match(recoveryWorkflow, /pull-requests:\s*read/u);
assert.match(recoveryWorkflow, /- name: Resolve and verify exact PR candidate identity/u);
assert.match(recoveryWorkflow, /uses: actions\/github-script@v8/u);
assert.match(recoveryWorkflow, /pr\.state !== 'open'/u);
assert.match(recoveryWorkflow, /pr\.head\.repo\?\.full_name !== repository/u);
assert.match(recoveryWorkflow, /pr\.head\.sha !== requestedSha/u);
assert.match(recoveryWorkflow, /pr\.base\.ref !== expectedBaseRef/u);
assert.match(recoveryWorkflow, /expectedBaseSha && pr\.base\.sha !== expectedBaseSha/u);
assert.match(recoveryWorkflow, /core\.setOutput\('candidate_sha', pr\.head\.sha\)/u);
assert.match(recoveryWorkflow, /core\.setOutput\('base_sha', pr\.base\.sha\)/u);
assert.match(recoveryWorkflow, /core\.setOutput\('head_ref', pr\.head\.ref\)/u);

assert.match(
  recoveryWorkflow,
  /ref: \$\{\{ steps\.candidate\.outputs\.candidate_sha \}\}/u,
  "Syntax checkout must use the API-verified current PR head.",
);
assert.match(
  recoveryWorkflow,
  /- name: Re-verify candidate is still the current PR head[\s\S]*pr\.head\.sha !== process\.env\.VERIFIED_CANDIDATE_SHA/u,
  "Test job must reject a PR head that moved after syntax verification.",
);
assert.match(
  recoveryWorkflow,
  /ref: \$\{\{ needs\.syntax\.outputs\.candidate_sha \}\}/u,
  "Test checkout must use the syntax-verified candidate SHA.",
);
assert.match(
  recoveryWorkflow,
  /- name: Run tests with exact checked-out identity[\s\S]*EXPECTED_TEST_CANDIDATE_SHA: \$\{\{ needs\.syntax\.outputs\.candidate_sha \}\}/u,
);
assert.match(recoveryWorkflow, /actual_sha="\$\(git rev-parse HEAD\)"/u);
assert.match(recoveryWorkflow, /test "\$actual_sha" = "\$EXPECTED_TEST_CANDIDATE_SHA"/u);
assert.match(recoveryWorkflow, /GITHUB_SHA="\$actual_sha" npm test/u);
assert.match(recoveryWorkflow, /PULL_REQUEST_BASE_SHA: \$\{\{ needs\.syntax\.outputs\.base_sha \}\}/u);
assert.match(recoveryWorkflow, /PULL_REQUEST_HEAD_REF: \$\{\{ needs\.syntax\.outputs\.head_ref \}\}/u);
assert.match(recoveryWorkflow, /PULL_REQUEST_BASE_REF: \$\{\{ needs\.syntax\.outputs\.base_ref \}\}/u);
assert.match(recoveryWorkflow, /DEPLOYMENT_COMMIT_SHA: "\$\{\{ needs\.syntax\.outputs\.candidate_sha \}\}"/u);
assert.doesNotMatch(
  recoveryWorkflow,
  /github\.event\.pull_request\.head\.sha \|\| github\.sha/u,
  "Recovery must not fall back to an event/ref SHA that is not proven to be the current PR head.",
);
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
assert.match(
  recoveryWorkflow,
  /group: ci-pr-recovery-\$\{\{ github\.event\.pull_request\.number \|\| inputs\.pull_request_number \|\| github\.ref \}\}/u,
  "Manual recovery concurrency must be keyed to the target PR rather than only the workflow ref.",
);

console.log("CI PR-bound exact checkout provenance and stale-run rejection tests passed");
