import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/292_sprint68_platform_health_scorecard_operationalization.sql", "utf8");
const service = readFileSync("platformHealthScorecard.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

for (const token of [
  "platform_health_scorecard_component_registry",
  "platform_health_scorecard_remediation_registry",
  "platform_health_scorecard_snapshots",
  "v_platform_health_scorecard_remediation_plan",
  "v_platform_health_scorecard_tenant_rollout_readiness",
  "v_platform_health_scorecard_ledger_hygiene",
  "platform_health_scorecard_snapshot_record",
  "platform_health_scorecard_remediation_plan",
  "platform_health_scorecard_tenant_rollout_readiness",
  "platform_health_scorecard_ledger_hygiene_report",
]) {
  assert(migration.includes(token), `migration must include ${token}`);
}
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "operationalization migration must not be destructive");
assert(migration.includes("no_provider_call"), "migration must preserve no-provider-call safety metadata");
assert(migration.includes("no_external_write"), "migration must preserve no-external-write safety metadata");
assert(migration.includes("no_raw_secrets"), "migration must preserve no-raw-secrets safety metadata");

for (const fn of [
  "recordPlatformHealthScorecardSnapshot",
  "readPlatformHealthScorecardRemediationPlan",
  "readPlatformHealthScorecardTenantRollout",
  "readPlatformHealthScorecardLedgerHygiene",
]) {
  assert(service.includes(`export async function ${fn}`), `service must export ${fn}`);
}
assert(service.includes("will_execute_provider_call: false"), "service must remain no-provider-call");
assert(service.includes("will_external_write: false"), "service must not perform external writes");
assert(service.includes("will_read_credential_payload: false"), "service must not read credential payloads");

for (const path of [
  "/platform/health/scorecard/snapshot-record",
  "/platform/health/scorecard/remediation-plan",
  "/platform/health/scorecard/tenant-rollout",
  "/platform/health/scorecard/ledger-hygiene",
]) {
  assert(routes.includes(path), `routes must expose ${path}`);
  assert(openapi.includes(path), `OpenAPI must document ${path}`);
}

assert(routes.includes("recordPlatformHealthScorecardSnapshot"), "routes must call snapshot service");
assert(routes.includes("readPlatformHealthScorecardRemediationPlan"), "routes must call remediation service");
assert(routes.includes("readPlatformHealthScorecardTenantRollout"), "routes must call tenant rollout service");
assert(routes.includes("readPlatformHealthScorecardLedgerHygiene"), "routes must call ledger hygiene service");

console.log("platform health scorecard operationalization guard passed");
