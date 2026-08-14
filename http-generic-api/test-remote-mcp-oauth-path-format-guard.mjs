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
  "http-generic-api/scripts/remote-mcp-write-scope-inventory.mjs",
  "http-generic-api/scripts/test-remote-mcp-write-scope-inventory.mjs",
  "http-generic-api/openapi/source-operation-coverage.baseline.json",
  "canonicals/openapi/custom-gpt-surfaces.yaml",
  "scripts/remote-mcp-write-scope-inventory.mjs",
  "edge/activation-gateway/**",
];
for (const filter of [trigger.pull_request.paths, trigger.push.paths]) {
  for (const required of requiredPathFragments) {
    assert(filter.includes(required), `workflow path filter must include ${required}`);
  }
}

const guardJob = workflow.jobs?.["path-format-guard"];
const steps = guardJob?.steps || [];
const runText = steps.map((step) => String(step.run || "")).join("\n");
for (const requiredCommand of [
  "npm run ci:path-guard",
  "npm run schemas:check",
  "node scripts/generate-openapi-mutation-policy.mjs",
  "git diff --exit-code -- openapi/openapi-mutation-policy.generated.json",
  "npm run write-scopes:inventory:check",
  "npm run write-scopes:inventory:test",
  "node test-trusted-ingress-contract.mjs",
  "node test-custom-gpt-mutation-governance-contract.mjs",
  "node test-shared-mutation-policy.mjs",
  "npm run activation-gateway:bundle:check",
]) {
  assert(runText.includes(requiredCommand), `workflow must run ${requiredCommand}`);
}
const writeScopeStep = steps.find((step) => step.name === "Verify write-scope inventory classification");
assert(writeScopeStep, "write-scope inventory verification step must exist");
assert.equal(writeScopeStep["working-directory"], undefined, "root write-scope package scripts must run from repository root");

const recoveryJob = workflow.jobs?.["write-scope-recovery-candidate"];
assert(recoveryJob, "read-only exact-head recovery candidate job must exist");
assert.equal(recoveryJob["runs-on"], "ubuntu-24.04");
const recoverySteps = recoveryJob.steps || [];
const recoveryRunText = recoverySteps.map((step) => String(step.run || "")).join("\n");
assert(recoveryRunText.includes("git rev-parse HEAD"), "recovery candidate must verify exact local head");
assert(recoveryRunText.includes("node scripts/remote-mcp-write-scope-inventory.mjs"), "recovery candidate must use canonical root generator");
assert(recoveryRunText.includes("repository_mutation:false"), "recovery manifest must state repository mutation is false");
assert(recoveryRunText.includes("runtime_mutation:false"), "recovery manifest must state runtime mutation is false");
assert(recoverySteps.some((step) => String(step.uses || "").startsWith("actions/upload-artifact@")), "recovery candidate must upload bounded artifact evidence");
const recoveryCheckout = recoverySteps.find((step) => step.name === "Checkout exact pull request head");
assert.equal(recoveryCheckout?.with?.["persist-credentials"], false, "recovery candidate checkout must not persist credentials");

assert.equal(workflow.permissions?.contents, "read", "path guard must remain read-only against repository contents");
assert.equal(guardJob?.["runs-on"], "ubuntu-latest");
console.log("Remote MCP OAuth path-format guard workflow contract passed.");
