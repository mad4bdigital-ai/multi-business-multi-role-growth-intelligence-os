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

// Pull-request checks must remain read-only. Backend SQL signals remain in
// the original Production-bound job; GitHub Issue mutations require explicit dispatch.
assert.match(workflowSource, /name: Classify and ingest SQL operational signal/);
assert.doesNotMatch(workflowSource, /issues:\\s*write/);
assert.doesNotMatch(workflowSource, /github\\.rest\\.issues\\.(?:create|update|delete)/);
const incidentSource = await readFile(
  new URL("../.github/workflows/custom-gpt-guard-incident-governed.yml", import.meta.url),
  "utf8",
);
const incidentWorkflow = parse(incidentSource);
assert.ok(incidentWorkflow?.on?.workflow_dispatch?.inputs?.expected_head_sha);
assert.ok(incidentWorkflow?.on?.workflow_dispatch?.inputs?.source_run_id);
assert.ok(incidentWorkflow?.on?.workflow_dispatch?.inputs?.confirmation);
assert.equal(incidentWorkflow?.on?.pull_request, undefined);
assert.match(incidentSource, /incident_writer_expected_head_sha_or_source_run_mismatch/);
assert.match(incidentSource, /github\\.rest\\.issues\\.(?:create|update)/);
assert.match(incidentSource, /environment:\\n      name: Production\\n      deployment: false/);
console.log("custom GPT Contract Guard path and incident write separation passed");
