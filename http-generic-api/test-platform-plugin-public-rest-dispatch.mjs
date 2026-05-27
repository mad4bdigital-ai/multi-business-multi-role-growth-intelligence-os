import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("platformPluginRestDispatch.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const routeIndex = readFileSync("routes/index.js", "utf8");
const smokeRoutes = readFileSync("routes/platformSmokeRoutes.js", "utf8");
const migration = readFileSync("migrations/145_sprint65_platform_plugin_public_rest_dispatch_tool.sql", "utf8");
const smokeCertMigration = readFileSync("migrations/151_sprint65_platform_plugin_smoke_certifications.sql", "utf8");
const smokeCertToolsMigration = readFileSync("migrations/152_sprint65_platform_plugin_smoke_certification_tools.sql", "utf8");
const smokeCertLifecycleMigration = readFileSync("migrations/153_sprint65_smoke_certification_lifecycle.sql", "utf8");
const smokeCertLifecycleToolsMigration = readFileSync("migrations/154_sprint65_smoke_certification_lifecycle_tools.sql", "utf8");
const smokeCertSource = readFileSync("platformPluginSmokeCertification.js", "utf8");
const pluginResolverSource = readFileSync("platformPluginResolver.js", "utf8");
const promotionSource = readFileSync("platformPluginPromotion.js", "utf8");
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
assert(service.includes("buildUrl({ baseUrl, path })"), "dispatcher must centralize URL construction");
assert(service.includes("basePath"), "dispatcher must preserve connection api_base_url path prefixes");
assert(service.includes("joinedPath"), "dispatcher must join base path and endpoint path safely");
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
assert(service.includes("validateSmokeCertificationDrift"), "dispatcher must compare current URL/method against smoke certification evidence");
assert(service.includes("smoke_certification_recertification_required"), "dispatcher must block when smoke certification drifts");
assert(service.includes("smoke_certification_origin_drift"), "dispatcher must detect smoke certification origin drift");
assert(service.includes("smoke_certification_path_drift"), "dispatcher must detect smoke certification path drift");
assert(service.includes("smoke_certification_method_drift"), "dispatcher must detect smoke certification method drift");
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
assert(routes.includes("certifyPlatformPluginSmoke"), "routes must import smoke certification writer");
assert(routes.includes("getPlatformPluginSmokeCertification"), "routes must import smoke certification reader");
assert(routes.includes("/platform/plugins/smoke-certifications/certify"), "routes must expose smoke certification writer endpoint");
assert(routes.includes("/platform/plugins/smoke-certifications/status"), "routes must expose smoke certification status endpoint");

assert(migration.includes("platform_plugin_dispatch_rest"), "migration must register dispatch tool key");
assert(migration.includes("/platform/plugins/dispatch-rest"), "migration must bind dispatch route path");
assert(migration.includes("state_changing"), "dispatch tool must be state-changing");
assert(migration.includes("no_secrets"), "dispatch tool must be tagged no-secrets");
assert(migration.includes("ON DUPLICATE KEY UPDATE"), "dispatch tool registration must be idempotent");

assert(smokeRoutes.includes("MOCK_PROVIDER_REGISTRY"), "platform smoke routes must define a reusable mock provider registry");
assert(smokeRoutes.includes("/platform/mock-providers"), "platform smoke routes must expose mock provider registry endpoint");
assert(smokeRoutes.includes("/platform/mock-providers/:provider/:resource"), "platform smoke routes must expose dynamic provider/resource endpoint");
assert(smokeRoutes.includes("/platform/mock-crm/contacts"), "platform smoke routes must keep legacy mock CRM contacts endpoint");
assert(smokeRoutes.includes("platform_mock_crm"), "mock provider registry must include CRM provider");
assert(smokeRoutes.includes("platform_mock_analytics"), "mock provider registry must include analytics provider");
assert(smokeRoutes.includes("smoke_read_only"), "mock provider resources must declare smoke read-only mode");
assert(smokeRoutes.includes("will_mutate: false"), "mock provider resources must declare non-mutating behavior");
assert(smokeRoutes.includes("secrets_included: false"), "mock provider resources must be secret-free");
assert(routeIndex.includes("buildPlatformSmokeRoutes"), "platform smoke routes must be registered");
assert(openapi.includes("/platform/mock-providers:"), "OpenAPI must document mock provider registry endpoint");
assert(openapi.includes("operationId: platformMockProvidersList"), "mock provider registry OpenAPI operationId must be stable");
assert(openapi.includes("/platform/mock-providers/{provider}/{resource}:"), "OpenAPI must document dynamic mock provider resource endpoint");
assert(openapi.includes("operationId: platformMockProviderResource"), "mock provider resource OpenAPI operationId must be stable");
assert(openapi.includes("/platform/mock-crm/contacts:"), "OpenAPI must document legacy mock CRM contacts smoke endpoint");
assert(openapi.includes("operationId: platformMockCrmContacts"), "mock CRM OpenAPI operationId must be stable");
assert(openapi.includes("Public read-only mock CRM contacts endpoint"), "mock CRM OpenAPI description must document public read-only smoke behavior");

const dispatchPathMatches = openapi.match(/\/platform\/plugins\/dispatch-rest:/g) || [];
assert.equal(dispatchPathMatches.length, 1, "OpenAPI must document dispatch route exactly once");
assert(openapi.includes("operationId: platformPluginDispatchRest"), "OpenAPI must expose stable dispatch operationId");
assert(openapi.includes("x-openai-isConsequential: true"), "OpenAPI must mark dispatch route consequential");
assert(openapi.includes("full execution readiness passes"), "OpenAPI must document readiness guard before dispatch");
assert(openapi.includes("Brand, Business Activity, Workflow/Logic, Skill, and Platform Graph"), "OpenAPI must document readiness context fields");
assert(openapi.includes("provider_smoke"), "OpenAPI must document provider smoke flag");
assert(openapi.includes("provider_smoke_expected_origin"), "OpenAPI must document provider smoke expected origin");
assert(openapi.includes("/platform/plugins/smoke-certifications/certify:"), "OpenAPI must document smoke certification writer route");
assert(openapi.includes("operationId: platformPluginSmokeCertify"), "OpenAPI must expose stable smoke certification writer operationId");
assert(openapi.includes("/platform/plugins/smoke-certifications/status:"), "OpenAPI must document smoke certification status route");
assert(openapi.includes("operationId: platformPluginSmokeCertificationStatus"), "OpenAPI must expose stable smoke certification status operationId");

const smokeMigration = readFileSync("migrations/150_sprint65_provider_smoke_guarded_dispatch_schema.sql", "utf8");
assert(smokeMigration.includes("provider_smoke"), "provider smoke schema migration must include provider_smoke field");
assert(smokeMigration.includes("provider_smoke_expected_origin"), "provider smoke schema migration must include expected origin field");
assert(smokeMigration.includes("origin_guard"), "provider smoke schema migration must tag origin guard behavior");
assert(!smokeMigration.includes("updated_at"), "provider smoke schema migration must avoid admin_platform_endpoint_tools.updated_at because live table does not have it");

assert(smokeCertMigration.includes("platform_plugin_smoke_certifications"), "smoke certification table migration must create registry table");
assert(smokeCertMigration.includes("last_smoke_execution_log_id"), "smoke certification table must reference execution log evidence");
assert(smokeCertMigration.includes("UNIQUE KEY `uniq_plugin_action_mock`"), "smoke certification table must enforce one cert per plugin/action/mock pair");
assert(smokeCertMigration.includes("secrets_included` tinyint(1) NOT NULL DEFAULT 0"), "smoke certification table must default secrets_included=false");

assert(smokeCertLifecycleMigration.includes("certification_expires_at"), "smoke certification lifecycle migration must add expiry column");
assert(smokeCertLifecycleMigration.includes("last_recertification_required_at"), "smoke certification lifecycle migration must add recertification timestamp column");
assert(smokeCertLifecycleMigration.includes("recertification_reason"), "smoke certification lifecycle migration must add recertification reason column");
assert(smokeCertLifecycleMigration.includes("INTERVAL 90 DAY"), "smoke certification lifecycle migration must backfill default 90-day expiry");
assert(smokeCertLifecycleToolsMigration.includes("certification_ttl_days"), "smoke certification lifecycle tool migration must expose TTL days");

assert(smokeCertToolsMigration.includes("platform_plugin_smoke_certify"), "smoke certification writer admin tool must be registered");
assert(smokeCertToolsMigration.includes("platform_plugin_smoke_certification_status"), "smoke certification status admin tool must be registered");
assert(smokeCertToolsMigration.includes("/platform/plugins/smoke-certifications/certify"), "smoke certification writer tool must point at route");
assert(smokeCertToolsMigration.includes("/platform/plugins/smoke-certifications/status"), "smoke certification status tool must point at route");

assert(smokeCertSource.includes("validateSmokeEvidence"), "smoke certification module must validate execution log evidence");
assert(smokeCertSource.includes("provider_smoke_flag_missing"), "smoke certification must require provider_smoke=true");
assert(smokeCertSource.includes("dry_run_cannot_certify_smoke"), "smoke certification must reject dry-run logs");
assert(smokeCertSource.includes("smoke_method_must_be_get"), "smoke certification must require GET");
assert(smokeCertSource.includes("smoke_response_status_not_200"), "smoke certification must require 200 response");
assert(smokeCertSource.includes("expected_origin_mismatch"), "smoke certification must require expected origin match");
assert(smokeCertSource.includes("secrets_included: false"), "smoke certification responses must be secret-free");
assert(smokeCertSource.includes("boundedTtlDays"), "smoke certification writer must bound TTL days");
assert(smokeCertSource.includes("certification_expires_at"), "smoke certification writer/status must expose expiry metadata");
assert(smokeCertSource.includes("last_recertification_required_at"), "smoke certification status must expose recertification timestamp");
assert(smokeCertSource.includes("recertification_reason"), "smoke certification status must expose recertification reason");

assert(pluginResolverSource.includes("checkSmokeCertification"), "plugin resolver must check smoke certification before dispatch readiness");
assert(pluginResolverSource.includes("platform_plugin_smoke_certifications"), "plugin resolver must read smoke certification registry");
assert(pluginResolverSource.includes("smoke_certification_required"), "plugin resolver must block dispatch readiness when smoke certification is missing");
assert(pluginResolverSource.includes("smoke_certification: smokeCertification"), "plugin resolver must return smoke certification evidence");
assert(pluginResolverSource.includes("last_response_status = 200"), "plugin resolver must require successful 200 smoke certification");
assert(pluginResolverSource.includes("secrets_included = 0"), "plugin resolver must require secret-free smoke certification");

assert(promotionSource.includes("checkContributionSmokeCertifications"), "promotion must check smoke certifications before platform base promotion");
assert(promotionSource.includes("smoke_certification_required"), "promotion must block when smoke certification is missing");
assert(promotionSource.includes("platform_plugin_smoke_certifications"), "promotion must read smoke certification registry");
assert(promotionSource.includes("last_response_status = 200"), "promotion must require 200 smoke certification evidence");
assert(promotionSource.includes("secrets_included = 0"), "promotion must require secret-free smoke certification evidence");

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
