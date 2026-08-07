#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const retiredExecutablePaths = [
  ".github/workflows/production-runtime-parity-comment-bridge.yml",
  "http-generic-api/scripts/test-production-runtime-parity-comment-bridge.mjs",
];
for (const relativePath of retiredExecutablePaths) {
  assert.equal(fs.existsSync(path.join(root, relativePath)), false, `retired bridge executable path must remain absent: ${relativePath}`);
}

const tombstonePath = ".changes/e2e/production-runtime-parity-comment-bridge.json";
const tombstoneAbsolutePath = path.join(root, tombstonePath);
assert.equal(fs.existsSync(tombstoneAbsolutePath), true, "retired bridge governance tombstone must remain present");
const tombstone = JSON.parse(fs.readFileSync(tombstoneAbsolutePath, "utf8"));
assert.equal(tombstone.feature_key, "production-runtime-parity-comment-bridge");
assert.equal(tombstone.current_phase, "mvp");
assert.deepEqual(tombstone.scope?.include, [tombstonePath], "tombstone scope must not retain executable bridge ownership");
assert.equal(tombstone.secrets_included, false);
assert.match(tombstone.title || "", /retired|tombstone/i);

const r7Paths = [
  ".github/workflows/hostinger-production-runtime-readback-r7.yml",
  ".changes/e2e/hostinger-production-runtime-readback-r7.json",
  "http-generic-api/test-hostinger-production-runtime-readback-r7.mjs",
];
for (const relativePath of r7Paths) {
  assert.equal(fs.existsSync(path.join(root, relativePath)), true, `canonical R7 path must remain present: ${relativePath}`);
}

const workflowRoot = path.join(root, ".github/workflows");
const liveWorkflows = fs.readdirSync(workflowRoot)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort()
  .map((name) => ({
    name,
    text: fs.readFileSync(path.join(workflowRoot, name), "utf8"),
  }));
const retiredBridgeMarkerPattern = /RUN_PRODUCTION_RUNTIME_PARITY\b|production-runtime-parity-comment-bridge/u;
const closedControlIssueBindingPattern = /github\.event\.issue\.number\s*==\s*4953/u;
for (const workflow of liveWorkflows) {
  assert.equal(
    retiredBridgeMarkerPattern.test(workflow.text) && closedControlIssueBindingPattern.test(workflow.text),
    false,
    `live workflow must not retain the retired bridge bound to closed control issue #4953: ${workflow.name}`,
  );
}

const retirementSelfTestInvocation =
  "http-generic-api/scripts/production-runtime-parity-comment-bridge-retirement-self-test.mjs";
const liveWorkflowText = liveWorkflows
  .map((workflow) => workflow.text.replaceAll(retirementSelfTestInvocation, ""))
  .join("\n");
assert.doesNotMatch(liveWorkflowText, /RUN_PRODUCTION_RUNTIME_PARITY\b/u);
assert.doesNotMatch(liveWorkflowText, /production-runtime-parity-comment-bridge/u);

const r7Workflow = fs.readFileSync(path.join(root, r7Paths[0]), "utf8");
assert.match(r7Workflow, /^  issue_comment:\n    types: \[created\]$/mu);
assert.match(r7Workflow, /github\.event\.issue\.pull_request != null/u);
assert.match(r7Workflow, /RUN_HOSTINGER_PRODUCTION_RUNTIME_READBACK_R7 expected_production_sha=/u);
assert.match(r7Workflow, /^permissions:\n  contents: read$/mu);
assert.doesNotMatch(r7Workflow, /contents: write|issues: write|pull-requests: write|actions: write/u);
assert.match(r7Workflow, /https:\/\/auth\.mad4b\.com\/health/u);
assert.match(r7Workflow, /https:\/\/auth\.mad4b\.com\/version/u);
assert.match(r7Workflow, /https:\/\/auth\.mad4b\.com\/deployment-info/u);
assert.match(r7Workflow, /https:\/\/auth\.mad4b\.com\/connector-agent\/version/u);
assert.match(r7Workflow, /\.public_get_only == true/u);
for (const effect of [
  "repository_content_mutation_performed",
  "provider_credential_accessed",
  "provider_mutation_performed",
  "build_creation_performed",
  "deployment_performed",
  "release_activation_performed",
  "restart_performed",
  "sql_execution_performed",
  "migration_apply_performed",
  "database_mutation_performed",
  "external_business_send_performed",
]) {
  assert.match(r7Workflow, new RegExp(`\\.${effect} == false`, "u"));
}
assert.match(r7Workflow, /\.secrets_included == false/u);

console.log(JSON.stringify({
  ok: true,
  gate: "production_runtime_parity_comment_bridge_retirement",
  retired_executable_path_count: retiredExecutablePaths.length,
  governance_tombstone_present: true,
  canonical_entrypoint: "hostinger-production-runtime-readback-r7",
  public_get_only: true,
  mutation_performed: false,
  secrets_included: false,
}));
