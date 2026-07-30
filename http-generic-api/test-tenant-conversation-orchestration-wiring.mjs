import assert from "node:assert/strict";
import fs from "node:fs";

const systemLayer = fs.readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");
const manifest = fs.readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");
const orchestrator = fs.readFileSync(new URL("./tenantConversationOrchestrator.js", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("./tenantConversationOrchestrationRuntime.js", import.meta.url), "utf8");
const resourceResolver = fs.readFileSync(new URL("./tenantResourceConnectionResolver.js", import.meta.url), "utf8");

for (const toolName of [
  "tenant_conversation_orchestration_preview",
  "tenant_connection_cleanup_plan",
  "tenant_brand_core_operational_index_preview",
  "tenant_conversation_orchestration_readiness_smoke",
]) {
  assert(orchestrator.includes(`name: "${toolName}"`), `${toolName} descriptor must exist`);
}

assert(systemLayer.includes("TENANT_CONVERSATION_ORCHESTRATION_SYSTEM_TOOLS"));
assert(systemLayer.includes("TenantConversationOrchestrationRuntime"));
assert(systemLayer.includes('source_key: "tenant_conversation_orchestration_v1"'));
assert(systemLayer.includes('readiness_tool: "tenant_conversation_orchestration_readiness_smoke"'));

for (const testName of [
  "test-tenant-resource-connection-binding.mjs",
  "test-tenant-conversation-orchestrator.mjs",
  "test-tenant-conversation-orchestration-wiring.mjs",
]) {
  assert(manifest.includes(testName), `${testName} must be registered`);
}

const lowerRuntime = `${orchestrator}\n${runtime}\n${resourceResolver}`.toLowerCase();
for (const forbidden of [
  "allroyalegypt",
  "momegahed3",
  "nagy essam",
  "nagy.essam.website",
  "allroyalegypt.com",
]) {
  assert.equal(lowerRuntime.includes(forbidden), false, `runtime must not hard-code ${forbidden}`);
}

assert.match(runtime, /FROM memberships/);
assert.match(runtime, /ACTIVE_TENANT_MEMBERSHIP_REQUIRED/);
assert.match(resourceResolver, /cms_site_access_grants/);
assert.match(resourceResolver, /credential_bindings/);
assert.match(resourceResolver, /connection_resource_mismatch/);
assert.match(orchestrator, /execution_allowed: false/);
assert.match(orchestrator, /provider_calls_made: 0/);
assert.match(orchestrator, /mutations_executed: false/);
assert.match(orchestrator, /external_sends: 0/);
assert.match(orchestrator, /secrets_included: false/);

console.log("tenant conversation orchestration wiring tests passed");
