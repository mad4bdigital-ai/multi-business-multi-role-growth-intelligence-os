import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

// frontend-surface-operation: POST /platform/orchestration/ads-provider/snapshot-propose

const service = readFileSync("adsProviderGovernanceSnapshotProposal.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/263_sprint68_ads_governance_snapshot_proposal.sql", "utf8");
const openapiSource = readFileSync("openapi.yaml", "utf8");
const openapi = YAML.parse(openapiSource);
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

const module = await import("./adsProviderGovernanceSnapshotProposal.js");
assert.equal(typeof module.proposeAdsProviderGovernanceSnapshot, "function", "snapshot proposal service must export function");

for (const expected of [
  "ads_provider_governance_snapshot_proposal_policy_v1",
  "ads_provider_governance_snapshot_propose",
  "/platform/orchestration/ads-provider/snapshot-propose",
  "snapshot_candidate",
  "recommendation_candidate",
  "writes_database",
  "no_provider_call",
  "no_credential_payload_read",
  "no_spend_change",
  "secrets_included",
]) {
  assert(migration.includes(expected), `migration must include ${expected}`);
}

assert(routes.includes("proposeAdsProviderGovernanceSnapshot"), "route must import proposal service");
assert(routes.includes('router.post("/platform/orchestration/ads-provider/snapshot-propose"'), "route must mount proposal endpoint");
assert(service.includes("writes_database: false"), "service must not write database");
assert(service.includes("will_record_snapshot: false"), "service must not record snapshot in this slice");
assert(service.includes("will_record_recommendation: false"), "service must not record recommendation in this slice");
assert(service.includes("will_execute_provider_call: false"), "service must not execute provider calls");
assert(service.includes("will_read_credential_payload: false"), "service must not read credential payloads");
assert(service.includes("will_change_spend: false"), "service must not change spend");
assert(service.includes("recommendation_only"), "service must classify recommendation-only behavior");

const proposalOperation = openapi?.paths?.["/platform/orchestration/ads-provider/snapshot-propose"]?.post;
assert.equal(proposalOperation?.operationId, "adsProviderGovernanceSnapshotPropose", "OpenAPI must document proposal route");
const writesDatabaseSchema = proposalOperation?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.writes_database;
assert.equal(writesDatabaseSchema?.type, "boolean", "OpenAPI writes_database contract must remain boolean");
assert.deepEqual(writesDatabaseSchema?.enum, [false], "OpenAPI must declare no DB write");

assert(releaseReadiness.includes("263_sprint68_ads_governance_snapshot_proposal.sql"), "release readiness must track migration 263");
assert(releaseReadiness.includes('policy_key: "ads_provider_governance_snapshot_proposal_policy_v1"'), "release readiness must require proposal policy");
assert(runner.includes("263_sprint68_ads_governance_snapshot_proposal.sql"), "governed migration runner must allowlist migration 263");

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;
assert(!forbiddenSql.test(migration), "proposal migration must not contain destructive SQL");

console.log("ads governance snapshot proposal is registered, documented, no-write, and no-execution");
