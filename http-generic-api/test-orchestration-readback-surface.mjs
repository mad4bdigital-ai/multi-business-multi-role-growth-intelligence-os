import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/262_sprint68_orchestration_readback_surface.sql", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const service = readFileSync("platformOrchestrationReadback.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");

const module = await import("./platformOrchestrationReadback.js");
assert.equal(typeof module.readPlatformOrchestrationReadback, "function", "readback service must export function");

for (const expected of [
  "v_platform_orchestration_graph_readiness",
  "v_platform_orchestration_ads_governance_readiness",
  "orchestration_intelligence_readback_policy_v1",
  "platform_orchestration_readback",
  "/platform/orchestration/readback",
  "ads_provider_governance_orchestrator",
]) {
  assert(migration.includes(expected), `migration must include ${expected}`);
}

assert(routes.includes("readPlatformOrchestrationReadback"), "route must import readback service");
assert(routes.includes('router.post("/platform/orchestration/readback"'), "route must mount readback endpoint");
assert(service.includes("will_execute_provider_call: false"), "service must declare no provider execution");
assert(service.includes("will_read_credential_payload: false"), "service must declare no credential payload read");
assert(service.includes("will_change_spend: false"), "service must declare no spend change");
assert(service.includes("recommendation_only: true"), "service must remain recommendation only");
assert(service.includes("secrets_included: false"), "service must be no-secret");
assert(openapi.includes("operationId: platformOrchestrationReadback"), "OpenAPI must document readback route");
assert(openapi.includes("x-openai-isConsequential: false"), "OpenAPI route must be non-consequential");
assert(releaseReadiness.includes("262_sprint68_orchestration_readback_surface.sql"), "release readiness must track migration 262");
assert(releaseReadiness.includes('policy_key: "orchestration_intelligence_readback_policy_v1"'), "release readiness must require readback policy");
assert(migration.includes("family_key = 'google_ads_budget'"), "readiness view must use execution_enablement_registry.family_key");
assert(migration.includes("adapter_key = 'google_ads_budget_change_execution_adapter'"), "readiness view must use execution_enablement_registry.adapter_key");
assert(!migration.includes("execution_enablement_registry` WHERE provider_key"), "execution_enablement_registry has no provider_key column");

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;
assert(!forbiddenSql.test(migration), "readback migration must not contain destructive SQL");
for (const forbidden of ["provider_api_mutation", "spend_change", "credential_payload_read"]) {
  assert(!service.includes(`will_${forbidden}: true`), `service must not enable ${forbidden}`);
}

console.log("orchestration readback surface is registered, documented, and read-only");
