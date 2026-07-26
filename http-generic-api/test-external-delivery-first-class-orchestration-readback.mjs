import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readback = readFileSync("platformOrchestrationReadback.js", "utf8");
const scorecard = readFileSync("scripts/platform-remaining-scope-scorecard.mjs", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");

assert(readback.includes("support_ticket_external_delivery_orchestrator"), "External Delivery plugin must be recognized by orchestration readback");
assert(readback.includes("v_platform_orchestration_external_delivery_readiness"), "External Delivery readiness view must be queried by readback");
assert(readback.includes("external_delivery_readiness"), "External Delivery readiness must be returned in readback graph payload");
assert(readback.includes('"support_ticket_external_delivery_orchestrator",'), "External Delivery must be included in explicit seven-stage graph expectations");

assert(scorecard.includes("external_readback_service_first_class"), "scorecard must guard first-class External Delivery readback");
assert(scorecard.includes("287_sprint68_external_delivery_orchestration_graph_plugin.sql"), "scorecard must require graph plugin migration");
assert(scorecard.includes("288_sprint68_external_delivery_no_send_tool_tag_completion.sql"), "scorecard must require no-send tag completion migration");
assert(scorecard.includes("live_external_send_enabled',false"), "scorecard must preserve live-send-disabled no-send guard");

assert(releaseReadiness.includes("support_ticket_external_delivery_orchestration_readback"), "release readiness must require External Delivery orchestration readback policy");
assert(releaseReadiness.includes("support_ticket_external_delivery_orchestration_readback_policy_v1"), "release readiness must check External Delivery policy key");
for (const migration of [
  "284_sprint68_wordpress_schema_import_completion_registry.sql",
  "285_sprint68_governed_migration_authorization_registry.sql",
  "286_sprint68_platform_schema_contract_completion_registry.sql",
  "287_sprint68_external_delivery_orchestration_graph_plugin.sql",
  "288_sprint68_external_delivery_no_send_tool_tag_completion.sql",
]) {
  assert(releaseReadiness.includes(migration), `release readiness must include ${migration} in ledger expectations`);
}

console.log("external delivery first-class orchestration readback guard passed");
