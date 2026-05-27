import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("platformPluginRestDispatch.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const routeIndex = readFileSync("routes/index.js", "utf8");
const smokeRoutes = readFileSync("routes/platformSmokeRoutes.js", "utf8");
const migration = readFileSync("migrations/145_sprint65_platform_plugin_public_rest_dispatch_tool.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(service.includes("resolveExecutionReadinessDryRun"), "public dispatcher must run full execution readiness dry-run before dispatch");
assert(service.includes("execution_readiness_not_dispatch_ready"), "public dispatcher must block when readiness dry-run is not dispatch_ready");
assert(service.includes("preview_enforce: true"), "public dispatcher must enforce manifest guard preview before dispatch");
assert(service.includes("require_plugin_connection: true"), "public dispatcher must require plugin connection before dispatch");
assert(service.includes("resolvePlatformPluginExecution"), "public dispatcher must call resolver after readiness preflight");
assert(service.includes('resolution.mode !== "dispatch_ready"'), "dispatcher must require dispatch_ready mode");
assert(service.includes("resolution.execution?.will_execute !== true"), "dispatcher must require execution.will_execute=true");
assert(service.includes("dispatch_template_missing"), "dispatcher must fail closed when REST action template is missing");
assert(service.includes("platform_plugin_contributions.action_bindings_json"), "dispatcher must use contribution action template source");
assert(service.includes("function normalize(value"), "dispatcher must define normalize helper for endpoint fallback readiness checks");
assert(service.includes("loadEndpointRegistryActionTemplate"), "dispatcher must support endpoint registry template fallback");
assert(service.includes("endpoints.endpoint_path_or_function"), "dispatcher must use endpoint registry path fallback when contribution template is missing");
assert(service.includes("endpoint_key: endpoint?.endpoint_key"), "dispatcher must include endpoint fallback evidence in request summary");
assert(service.includes("https_required"), "dispatcher must enforce HTTPS");
assert(service.includes("private_network_blocked"), "dispatcher must block private-network hosts");
assert(service.includes("safeHeaders"), "dispatcher must sanitize outgoing headers");
assert(service.includes("provider_smoke_expected_origin_required"), "provider smoke must require explicit expected origin");
assert(service.includes("provider_smoke_expected_origin_mismatch"), "provider smoke must block unexpected origins");
assert(service.includes("provider_smoke_get_only"), "provider smoke must be GET-only");
assert(service.includes("provider_smoke_body_not_allowed"), "provider smoke must reject body templates");
assert(service.includes("writeExecutionEvidence"), "dispatcher must write execution evidence");
assert(service.includes("secrets_included: false"), "dispatcher must explicitly exclude secrets");

assert(routes.includes("dispatchPlatformPluginRestAction"), "routes must import public dispatch service");
assert(routes.includes("/platform/plugins/dispatch-rest"), "routes must expose public REST dispatch endpoint");
assert(routes.includes("platform_plugin_rest_dispatch_failed"), "routes must use structured dispatch error code");
assert(routes.includes("enforceExecutionReadiness"), "dispatch route must pass readiness enforcement flag");
assert(routes.includes("businessActivityTypeKey"), "dispatch route must pass business activity context");
assert(routes.includes("logicPackKey"), "dispatch route must pass logic pack context");
assert(routes.includes("edgeDetailLimit"), "dispatch route must pass bounded graph detail limits");
assert(routes.includes("providerSmoke"), "dispatch route must pass provider smoke flag");
assert(routes.includes("providerSmokeExpectedOrigin"), "dispatch route must pass provider smoke expected origin");

assert(migration.includes("platform_plugin_dispatch_rest"), "migration must register dispatch tool key");
assert(migration.includes("/platform/plugins/dispatch-rest"), "migration must bind dispatch route path");
assert(migration.includes("state_changing"), "dispatch tool must be state-changing");
assert(migration.includes("no_secrets"), "dispatch tool must be tagged no-secrets");
assert(migration.includes("ON DUPLICATE KEY UPDATE"), "dispatch tool registration must be idempotent");

const dispatchPathMatches = openapi.match(/\/platform\/plugins\/dispatch-rest:/g) || [];
assert.equal(dispatchPathMatches.length, 1, "OpenAPI must document dispatch route exactly once");
assert(openapi.includes("operationId: platformPluginDispatchRest"), "OpenAPI must expose stable dispatch operationId");
assert(openapi.includes("x-openai-isConsequential: true"), "OpenAPI must mark dispatch route consequential");
assert(openapi.includes("full execution readiness passes"), "OpenAPI must document readiness guard before dispatch");
assert(openapi.includes("Brand, Business Activity, Workflow/Logic, Skill, and Platform Graph"), "OpenAPI must document readiness context fields");
assert(openapi.includes("provider_smoke"), "OpenAPI must document provider smoke flag");
assert(openapi.includes("provider_smoke_expected_origin"), "OpenAPI must document provider smoke expected origin");

const smokeMigration = readFileSync("migrations/150_sprint65_provider_smoke_guarded_dispatch_schema.sql", "utf8");
assert(smokeMigration.includes("provider_smoke"), "provider smoke schema migration must include provider_smoke field");
assert(smokeMigration.includes("provider_smoke_expected_origin"), "provider smoke schema migration must include expected origin field");
assert(smokeMigration.includes("origin_guard"), "provider smoke schema migration must tag origin guard behavior");
assert(!smokeMigration.includes("updated_at"), "provider smoke schema migration must avoid admin_platform_endpoint_tools.updated_at because live table does not have it");

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
