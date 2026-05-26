import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("platformPluginRestDispatch.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/145_sprint65_platform_plugin_public_rest_dispatch_tool.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(service.includes("resolvePlatformPluginExecution"), "public dispatcher must call resolver first");
assert(service.includes('resolution.mode !== "dispatch_ready"'), "dispatcher must require dispatch_ready mode");
assert(service.includes("resolution.execution?.will_execute !== true"), "dispatcher must require execution.will_execute=true");
assert(service.includes("dispatch_template_missing"), "dispatcher must fail closed when REST action template is missing");
assert(service.includes("platform_plugin_contributions.action_bindings_json"), "dispatcher must use contribution action template source");
assert(service.includes("https_required"), "dispatcher must enforce HTTPS");
assert(service.includes("private_network_blocked"), "dispatcher must block private-network hosts");
assert(service.includes("safeHeaders"), "dispatcher must sanitize outgoing headers");
assert(service.includes("writeExecutionEvidence"), "dispatcher must write execution evidence");
assert(service.includes("secrets_included: false"), "dispatcher must explicitly exclude secrets");

assert(routes.includes("dispatchPlatformPluginRestAction"), "routes must import public dispatch service");
assert(routes.includes("/platform/plugins/dispatch-rest"), "routes must expose public REST dispatch endpoint");
assert(routes.includes("platform_plugin_rest_dispatch_failed"), "routes must use structured dispatch error code");

assert(migration.includes("platform_plugin_dispatch_rest"), "migration must register dispatch tool key");
assert(migration.includes("/platform/plugins/dispatch-rest"), "migration must bind dispatch route path");
assert(migration.includes("state_changing"), "dispatch tool must be state-changing");
assert(migration.includes("no_secrets"), "dispatch tool must be tagged no-secrets");
assert(migration.includes("ON DUPLICATE KEY UPDATE"), "dispatch tool registration must be idempotent");

assert(openapi.includes("/platform/plugins/dispatch-rest:"), "OpenAPI must document dispatch route");
assert(openapi.includes("operationId: platformPluginDispatchRest"), "OpenAPI must expose stable dispatch operationId");
assert(openapi.includes("x-openai-isConsequential: true"), "OpenAPI must mark dispatch route consequential");

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

console.log("platform plugin public REST dispatch tests passed");
