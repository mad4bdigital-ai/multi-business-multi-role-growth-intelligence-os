import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/290_sprint68_platform_health_scorecard.sql", "utf8");
const service = readFileSync("platformHealthScorecard.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const scorecard = readFileSync("scripts/platform-remaining-scope-scorecard.mjs", "utf8");

assert(migration.includes("CREATE OR REPLACE VIEW `v_platform_health_scorecard_components`"), "migration must create component view");
assert(migration.includes("CREATE OR REPLACE VIEW `v_platform_health_scorecard`"), "migration must create aggregate scorecard view");
assert(migration.includes("platform_health_scorecard"), "migration must seed platform_health_scorecard admin tool");
assert(migration.includes("/platform/health/scorecard"), "migration must register scorecard route path");
assert(migration.includes("schema_contract_health"), "scorecard must include schema contract health");
assert(migration.includes("tool_bus_health"), "scorecard must include tool bus health");
assert(migration.includes("orchestration_graph_health"), "scorecard must include orchestration graph health");
assert(migration.includes("migration_authorization_health"), "scorecard must include migration authorization health");
assert(migration.includes("release_readiness_health"), "scorecard must include release readiness health");
assert(migration.includes("provider_credential_health"), "scorecard must include provider credential health");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "scorecard migration must not be destructive");

assert(service.includes("readPlatformHealthScorecard"), "service must export readPlatformHealthScorecard");
assert(service.includes("v_platform_health_scorecard"), "service must read aggregate scorecard view");
assert(service.includes("will_execute_provider_call: false"), "service must be readback-only/no-provider-call");
assert(service.includes("will_external_write: false"), "service must not perform external writes");
assert(service.includes("secrets_included"), "service must expose secrets_included evidence");

assert(routes.includes("readPlatformHealthScorecard"), "route file must import scorecard service");
assert(routes.includes('/platform/health/scorecard'), "route file must expose scorecard endpoint");

assert(scorecard.includes("platform_health_scorecard"), "remaining scope scorecard must track platform health scorecard");
assert(scorecard.includes("platform_health_scorecard_no_provider_call"), "remaining scope scorecard must guard no-provider-call behavior");

console.log("platform health scorecard guard passed");
