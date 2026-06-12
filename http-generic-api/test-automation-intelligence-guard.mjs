import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runAutomationIntelligenceGuard } from "./scripts/automation-intelligence-guard.mjs";

const result = runAutomationIntelligenceGuard();

assert.equal(result.ok, true, "automation intelligence guard must pass");
assert.equal(result.provider_calls_made, false, "guard must remain offline/static");
assert.equal(result.mutations_executed, false, "guard must not mutate state");
assert.equal(result.secrets_included, false, "guard must not include secrets");

for (const requiredRule of [
  "P0-runtime-endpoint-call-hidden-from-tenant-discovery",
  "P0-platform-endpoint-exports-block-tenant-mutations",
  "P0-tenant-tool-discovery-blocks-mutating-and-high-risk-tools",
  "P1-guard-tests-track-runtime-contract",
  "P0-secret-boundary-in-new-automation-guard",
]) {
  assert.ok(result.passed.includes(requiredRule), `missing guard rule: ${requiredRule}`);
}

const guard = readFileSync(new URL("./scripts/automation-intelligence-guard.mjs", import.meta.url), "utf8");
assert.match(guard, /runtime_endpoint_call/);
assert.match(guard, /tenant_platform_endpoint_mutation_not_allowed/);
assert.match(guard, /TENANT_HIGH_RISK_TOOL_NAME_PATTERNS/);
assert.match(guard, /provider_calls_made: false/);
assert.doesNotMatch(guard, /child_process|execFile|spawn/);

console.log("automation intelligence guard test passed");
