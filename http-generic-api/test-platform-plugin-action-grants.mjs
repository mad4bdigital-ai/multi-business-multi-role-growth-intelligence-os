import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("platformPluginActionGrant.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/144_sprint65_platform_plugin_action_grant_tool.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(service.includes("upsertPlatformPluginActionGrant"), "service must export action grant upsert");
assert(service.includes("payloadContainsSecret"), "service must reject secret-bearing payloads");
assert(service.includes("FROM app_integrations"), "service must validate plugin registry row");
assert(service.includes("FROM app_integration_action_bindings"), "service must validate action binding row");
assert(service.includes("FROM user_app_connections"), "service must validate active connection row");
assert(service.includes("INSERT INTO app_action_grants"), "service must write app_action_grants");
assert(service.includes("ON DUPLICATE KEY UPDATE"), "service must idempotently upsert grant scope");
assert(service.includes("writeExecutionEvidence"), "service must write execution evidence");
assert(service.includes("secrets_included: false"), "service response must explicitly exclude secrets");

assert(routes.includes("upsertPlatformPluginActionGrant"), "route module must call action grant service");
assert(routes.includes("/platform/plugins/action-grants"), "route must expose action grant endpoint");
assert(routes.includes("platform_plugin_action_grant_upsert_failed"), "route must use structured error code");

assert(migration.includes("platform_plugin_action_grant_upsert"), "migration must register admin tool key");
assert(migration.includes("/platform/plugins/action-grants"), "migration must bind route path");
assert(migration.includes("state_changing"), "tool must be marked state-changing");
assert(migration.includes("no_secrets"), "tool must be tagged as no-secrets");
assert(migration.includes("ON DUPLICATE KEY UPDATE"), "tool registration must be idempotent");

assert(openapi.includes("/platform/plugins/action-grants:"), "OpenAPI must document action grant route");
assert(openapi.includes("operationId: platformPluginActionGrantUpsert"), "OpenAPI must expose stable operationId");
assert(openapi.includes("x-openai-isConsequential: true"), "OpenAPI must mark grant route consequential");

for (const forbidden of [
  "api_key_value",
  "access_token",
  "refresh_token",
  "client_secret",
  "encrypted_credentials",
  "GITHUB_TOKEN",
]) {
  assert(!migration.toLowerCase().includes(forbidden.toLowerCase()), `migration must not reference secret field ${forbidden}`);
}

console.log("platform plugin action grant tool tests passed");
