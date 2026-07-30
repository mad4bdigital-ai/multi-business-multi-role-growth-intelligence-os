import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

const service = readFileSync("adsProviderGovernanceSnapshotRecord.js", "utf8");
const routes = readFileSync("routes/platformPluginRoutes.js", "utf8");
const migration = readFileSync("migrations/264_sprint68_ads_governance_snapshot_record_gate.sql", "utf8");
const openapiSource = readFileSync("openapi.yaml", "utf8");
const openapi = YAML.parse(openapiSource);
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

const module = await import("./adsProviderGovernanceSnapshotRecord.js");
assert.equal(typeof module.recordAdsProviderGovernanceSnapshot, "function", "snapshot record service must export function");

for (const expected of [
  "ads_provider_governance_snapshot_record_gate_policy_v1",
  "ads_provider_governance_snapshot_record",
  "/platform/orchestration/ads-provider/snapshot-record",
  "candidate_sha256",
  "idempotency_key",
  "capability_envelope_id",
  "apply_true",
  "platform_orchestration_state_snapshots",
  "platform_orchestration_recommendations",
  "no_provider_call",
  "no_credential_payload_read",
  "no_spend_change",
  "secrets_included",
]) {
  assert(migration.includes(expected), `migration must include ${expected}`);
}

assert(routes.includes("recordAdsProviderGovernanceSnapshot"), "route must import record service");
assert(routes.includes('router.post("/platform/orchestration/ads-provider/snapshot-record"'), "route must mount record endpoint");
assert(service.includes("candidate_sha256_mismatch"), "service must reject mismatched proposal hashes");
assert(service.includes("requireReadyCapabilityEnvelope"), "service must require ready capability envelope");
assert(service.includes("capability_envelope_apply_not_allowed"), "service must reject apply=true when envelope apply_allowed is false");
assert(service.includes("Number(envelope.apply_allowed) !== 1"), "service must explicitly require apply_allowed before DB writes");
assert(service.includes("mode: \"record_dry_run\""), "service must support dry-run default");
assert(service.includes("will_record_snapshot: false"), "dry-run must not record snapshot");
assert(service.includes("will_record_recommendation: false"), "dry-run must not record recommendation");
assert(service.includes("ON DUPLICATE KEY UPDATE"), "recording must be idempotent");
assert(service.includes("will_execute_provider_call: false"), "service must not execute provider calls");
assert(service.includes("will_read_credential_payload: false"), "service must not read credential payloads");
assert(service.includes("will_change_spend: false"), "service must not change spend");

const recordOperation = openapi?.paths?.["/platform/orchestration/ads-provider/snapshot-record"]?.post;
assert.equal(recordOperation?.operationId, "adsProviderGovernanceSnapshotRecord", "OpenAPI must document record route");
assert.equal(recordOperation?.["x-openai-isConsequential"], true, "OpenAPI must mark gated persistence as consequential");
const applySchema = recordOperation?.requestBody?.content?.["application/json"]?.schema?.properties?.apply;
assert.equal(applySchema?.type, "boolean", "OpenAPI apply control must remain boolean");
assert.equal(applySchema?.default, false, "OpenAPI must document apply default false");

assert(releaseReadiness.includes("264_sprint68_ads_governance_snapshot_record_gate.sql"), "release readiness must track migration 264");
assert(releaseReadiness.includes('policy_key: "ads_provider_governance_snapshot_record_gate_policy_v1"'), "release readiness must require record gate policy");
assert(runner.includes("264_sprint68_ads_governance_snapshot_record_gate.sql"), "governed migration runner must allowlist migration 264");

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i;
assert(!forbiddenSql.test(migration), "record gate migration must not contain destructive SQL");

console.log("ads governance snapshot record gate is registered, gated, idempotent, and no-provider/no-secret");
