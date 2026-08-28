import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const workflow = YAML.parse(readFileSync("../.github/workflows/remote-mcp-oauth-path-format-guard.yml", "utf8"));
const trigger = workflow.on || workflow["on"];
assert(trigger, "path guard workflow must define triggers");
assert(Array.isArray(trigger.pull_request?.paths), "pull_request path filters must be explicit");
assert(Array.isArray(trigger.push?.paths), "push path filters must be explicit");

const requiredPathFragments = [
  "http-generic-api/openapi.yaml",
  "http-generic-api/openapi/**",
  "http-generic-api/routes/**",
  "http-generic-api/scripts/ci-path-format-guard.mjs",
  "http-generic-api/openapi/source-operation-coverage.baseline.json",
  "http-generic-api/test-remote-mcp-oauth-path-format-guard.mjs",
  "canonicals/openapi/custom-gpt-surfaces.yaml",
  "scripts/remote-mcp-write-scope-inventory.mjs",
  "scripts/remote-mcp-write-scope-semantic-currentness.mjs",
  ".github/derived-state-governance.json",
  "edge/activation-gateway/**",
];
for (const filter of [trigger.pull_request.paths, trigger.push.paths]) {
  for (const required of requiredPathFragments) {
    assert(filter.includes(required), `workflow path filter must include ${required}`);
  }
}

const steps = workflow.jobs?.["path-format-guard"]?.steps || [];
const runText = steps.map((step) => String(step.run || "")).join("\n");
for (const requiredCommand of [
  "npm run ci:path-guard",
  "npm run schemas:check",
  "node scripts/generate-openapi-mutation-policy.mjs",
  "git diff --exit-code -- openapi/openapi-mutation-policy.generated.json",
  "node scripts/remote-mcp-write-scope-semantic-currentness.mjs",
  "npm run write-scopes:inventory:test",
  "node test-trusted-ingress-contract.mjs",
  "node test-custom-gpt-mutation-governance-contract.mjs",
  "node test-shared-mutation-policy.mjs",
  "npm run activation-gateway:bundle:check",
]) {
  assert(runText.includes(requiredCommand), `workflow must run ${requiredCommand}`);
}
assert(!runText.includes("npm run write-scopes:inventory:check"), "workflow must not use raw byte-level write-scope currentness");

const localGuardSource = readFileSync("scripts/ci-path-format-guard.mjs", "utf8");
assert(
  localGuardSource.includes("remote-mcp-write-scope-semantic-currentness.mjs"),
  "local path guard must use the registered semantic Remote MCP inventory verifier",
);
assert(
  !/remote-mcp-write-scope-inventory\.mjs[^\n]*--check/u.test(localGuardSource),
  "local path guard must not reintroduce raw byte-level Remote MCP inventory currentness",
);

const derivedStateGovernance = JSON.parse(readFileSync("../.github/derived-state-governance.json", "utf8"));
const inventoryArtifact = (derivedStateGovernance.artifacts || []).find(
  (artifact) => artifact.artifact_id === "remote_mcp_write_scope_inventory",
);
assert(inventoryArtifact, "Remote MCP write-scope inventory must remain registered as derived state");
assert.equal(
  inventoryArtifact.verifier_id,
  "remote_mcp_write_scope_currentness",
  "Remote MCP write-scope inventory verifier authority drifted",
);
assert.equal(
  inventoryArtifact.currentness_projection?.mode,
  "semantic_projection",
  "Remote MCP write-scope inventory must use semantic currentness",
);
assert.deepEqual(
  inventoryArtifact.currentness_projection?.ignored_json_fields,
  ["file_count"],
  "only file_count may be ignored as JSON observability-only drift",
);
assert.deepEqual(
  inventoryArtifact.currentness_projection?.ignored_markdown_line_patterns,
  ["^\\| Tracked files scanned \\|"],
  "only the tracked-files-scanned Markdown row may be ignored as observability-only drift",
);

assert.equal(workflow.permissions?.contents, "read", "path guard must remain read-only against repository contents");
assert.equal(workflow.jobs?.["path-format-guard"]?.["runs-on"], "ubuntu-latest");
console.log("Remote MCP OAuth path-format guard workflow contract passed.");
