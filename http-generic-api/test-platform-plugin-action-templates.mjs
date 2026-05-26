import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("platformPluginActionTemplate.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/146_sprint65_platform_plugin_action_template_tool.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(service.includes("upsertPlatformPluginActionTemplate"), "service must export action template upsert");
assert(service.includes("platform_plugin_contributions"), "service must mutate contribution action metadata");
assert(service.includes("action_bindings_json"), "service must update action_bindings_json");
assert(service.includes("payloadContainsSecret"), "service must reject secret-bearing payloads");
assert(service.includes("BLOCKED_HEADER_KEYS"), "service must block auth/cookie headers");
assert(service.includes("ALLOWED_METHODS"), "service must restrict HTTP methods");
assert(service.includes("path is required and must start with '/'"), "service must require relative REST path");
assert(service.includes("writeExecutionEvidence"), "service must write execution evidence");
assert(service.includes("secrets_included: false"), "service responses must explicitly exclude secrets");

assert(routes.includes("upsertPlatformPluginActionTemplate"), "route must call action template service");
assert(routes.includes("/platform/plugins/action-templates"), "route must expose action template endpoint");
assert(routes.includes("platform_plugin_action_template_upsert_failed"), "route must use structured error code");

assert(migration.includes("platform_plugin_action_template_upsert"), "migration must register admin tool key");
assert(migration.includes("/platform/plugins/action-templates"), "migration must bind route path");
assert(migration.includes("state_changing"), "tool must be state-changing");
assert(migration.includes("no_secrets"), "tool must be tagged no-secrets");
assert(migration.includes("ON DUPLICATE KEY UPDATE"), "tool registration must be idempotent");

const templatePathMatches = openapi.match(/\/platform\/plugins\/action-templates:/g) || [];
assert.equal(templatePathMatches.length, 1, "OpenAPI must document action template route exactly once");
assert(openapi.includes("operationId: platformPluginActionTemplateUpsert"), "OpenAPI must expose stable action template operationId");
assert(openapi.includes("x-openai-isConsequential: true"), "OpenAPI must mark action template route consequential");

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

console.log("platform plugin action template management tests passed");
