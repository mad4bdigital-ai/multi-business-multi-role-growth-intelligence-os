import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const workflowSource = await readFile(
  new URL("../.github/workflows/custom-gpt-contract-guard.yml", import.meta.url),
  "utf8",
);
const workflow = parse(workflowSource);
const requiredPaths = [
  "edge/auth-mad4b-proxy/**",
  "http-generic-api/authMad4bProxyRolloutTool.js",
  "http-generic-api/server.js",
  "http-generic-api/operationRuntimeGuard.js",
  "http-generic-api/scripts/test-operation-runtime-guard.mjs",
  "http-generic-api/scripts/test-manifest.mjs",
  "http-generic-api/test-auth-mad4b-proxy-edge.mjs",
  "http-generic-api/test-auth-mad4b-proxy-rollout-tool.mjs",
  "http-generic-api/test-auth-mad4b-proxy-rollout-surface.mjs",
  "http-generic-api/migrations/20260729_auth_mad4b_proxy_rollout_surface.sql",
  "http-generic-api/test-custom-gpt-contract-guard-paths.mjs",
];

for (const eventName of ["pull_request", "push"]) {
  const paths = workflow?.on?.[eventName]?.paths;
  assert.ok(Array.isArray(paths), `${eventName}.paths must be configured`);
  for (const requiredPath of requiredPaths) {
    assert.ok(
      paths.includes(requiredPath),
      `${eventName}.paths must include ${requiredPath}`,
    );
  }
}

// Retain automatic incident handling only for main-branch push events.
// Pull requests must never gain Issue write privileges or Production mutation.
const guardJob = workflow.jobs?.guard;
const incidentJob = workflow.jobs?.alert;
assert.ok(guardJob && incidentJob, "contract guard and incident lifecycle jobs must both exist");
assert.equal(guardJob.permissions?.issues, undefined, "pull-request guard must not hold Issue write permission");
assert.equal(incidentJob.permissions?.issues, "write", "main-only alert must retain Issue lifecycle operations");
assert.equal(incidentJob.if, "${{ always() && github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
  "incident writer must have an exact main-only push condition");
assert.match(workflowSource, /guard_incident_expected_head_sha_mismatch/);
assert.match(workflowSource, /const expected_head_sha = context\.sha/);
assert.match(workflowSource, /github\.rest\.repos\.getBranch/);
assert.match(workflowSource, /currentHead\.commit\.sha !== expected_head_sha/);
assert.match(workflowSource, /await github\.rest\.issues\.(?:create|update|createComment)/);
assert.equal((workflowSource.match(/await verifyFreshHead\(\);/g) || []).length >= 5, true,
  "every GitHub Issue write must recheck exact current HEAD");
console.log("custom GPT Contract Guard path coverage and push-only incident governance passed");
