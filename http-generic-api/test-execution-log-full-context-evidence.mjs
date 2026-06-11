import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeExecutionEvidence } from "./executionEvidenceLogger.js";

const migration = readFileSync(new URL("./migrations/284_sprint68_execution_log_full_context_evidence.sql", import.meta.url), "utf8");
const logger = readFileSync(new URL("./executionEvidenceLogger.js", import.meta.url), "utf8");
const smoke = readFileSync(new URL("./scripts/execution-log-runtime-evidence-smoke.mjs", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

for (const token of [
  "brand_name",
  "brand_core_status",
  "brand_core_asset_keys",
  "brand_evidence_json",
  "business_activity_type_key",
  "activity_key",
  "business_type_key",
  "knowledge_profile_key",
  "business_activity_evidence_json",
  "business_type_evidence_json",
  "installation_id",
  "permission_grant_id",
  "permission_key",
  "connector_family",
  "provider_family",
  "connected_system_evidence_json",
  "permission_evidence_json",
  "resource_authority_binding_id",
  "resource_authority_evidence_json",
  "budget_authority_id",
  "budget_authority_evidence_json",
  "engine_key",
  "engine_policy_key",
  "engine_evidence_json",
  "model_key",
  "model_provider_key",
  "model_run_id",
  "model_evidence_json",
  "logic_key",
  "logic_pack_key",
  "logic_evidence_json",
  "knowledge_evidence_json",
  "v_execution_log_full_context_evidence_readiness",
  "v_execution_log_full_context_evidence_recent",
  "execution_log_full_context_evidence_policy_v1",
]) assert.match(migration, new RegExp(token));

assert.match(runner, /284_sprint68_execution_log_full_context_evidence\.sql/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /encrypted_credentials|value_ciphertext|secret_value|token_value|private_key/i);

for (const token of [
  "brandEvidence",
  "businessActivityEvidence",
  "connectedSystemEvidence",
  "resourceAuthorityEvidence",
  "budgetAuthorityEvidence",
  "engineEvidence",
  "modelEvidence",
  "logicEvidence",
  "knowledgeEvidence",
  "resource_authority_binding_id",
  "budget_authority_id",
]) assert.match(logger, new RegExp(token));

for (const token of [
  "execution_log_full_context_evidence_smoke",
  "brand_core_status",
  "business_activity_type_key",
  "permission_key",
  "resource_authority_binding_id",
  "budget_authority_id",
  "engine_key",
  "model_key",
  "logic_key",
  "blocked_field_leak_detected",
]) assert.match(smoke, new RegExp(token));

const captured = { insert: null, runtimeUpdate: null, fullContextUpdate: null };
const pool = {
  async query(sql, params = []) {
    const text = String(sql).trim();
    if (text.startsWith("INSERT INTO execution_log")) {
      captured.insert = { sql, params };
      return [{ affectedRows: 1, insertId: 456 }];
    }
    if (text.startsWith("UPDATE execution_log") && text.includes("agent_id = ?")) {
      captured.runtimeUpdate = { sql, params };
      return [{ affectedRows: 1, changedRows: 1 }];
    }
    if (text.startsWith("UPDATE execution_log") && text.includes("brand_name = ?")) {
      captured.fullContextUpdate = { sql, params };
      return [{ affectedRows: 1, changedRows: 1 }];
    }
    if (text.includes("FROM execution_log")) {
      return [[{ id: 456, execution_status: "success", execution_trace_id_writeback: "trace-full-context-evidence" }]];
    }
    return [[]];
  },
};

const result = await writeExecutionEvidence({
  pool,
  skipSurfaceAuthority: true,
  traceId: "trace-full-context-evidence",
  entryType: "full_context_evidence_test",
  executionClass: "test",
  sourceLayer: "test",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  brandId: "brand-1",
  brandKey: "brand_key",
  brandName: "Brand Name",
  brandCoreStatus: "ready",
  brandCoreAssetKeys: ["core-doc"],
  activityId: "activity-1",
  activityType: "seo",
  businessActivityTypeKey: "seo_activity",
  activityKey: "seo_activity_key",
  businessTypeKey: "home_services",
  knowledgeProfileKey: "home_services_profile",
  connectedSystemId: "system-1",
  installationId: "installation-1",
  permissionGrantId: "grant-1",
  permissionKey: "wordpress_api",
  connectorFamily: "http_generic_api_connector",
  providerFamily: "wordpress",
  resourceAuthorityBindingId: "authority-1",
  budgetAuthorityId: "budget-1",
  engineKey: "engine-1",
  enginePolicyKey: "engine-policy-1",
  modelKey: "openai/gpt-4o-mini",
  modelProviderKey: "openrouter",
  modelRunId: "model-run-1",
  logicKey: "logic-1",
  logicPackKey: "logic-pack-1",
  roleKeys: ["tenant_admin"],
  policyKeys: ["execution_log_full_context_evidence_policy_v1"],
  brandEvidence: { brand_key: "brand_key", application_password: "must_not_log" },
  businessActivityEvidence: { business_activity_type_key: "seo_activity", brand_core_required: true },
  connectedSystemEvidence: { connected_system_id: "system-1", credential_ref: "must_not_log" },
  resourceAuthorityEvidence: { binding_id: "authority-1", credential_ref: "must_not_log" },
  modelEvidence: { model_key: "openai/gpt-4o-mini", prompt_cache_json: { probe: "must_not_log" } },
  logicEvidence: { logic_key: "logic-1", body_json: { probe: "must_not_log" } },
});

assert.equal(result.ok, true);
assert.ok(captured.insert);
assert.ok(captured.runtimeUpdate);
assert.ok(captured.fullContextUpdate);
assert.equal((captured.fullContextUpdate.sql.match(/\?/g) || []).length, captured.fullContextUpdate.params.length);
assert.match(captured.fullContextUpdate.sql, /brand_name = \?/);
assert.match(captured.fullContextUpdate.sql, /business_activity_type_key = \?/);
assert.match(captured.fullContextUpdate.sql, /resource_authority_binding_id = \?/);
assert.match(captured.fullContextUpdate.sql, /knowledge_evidence_json = \?/);

const serialized = JSON.stringify(captured.fullContextUpdate.params);
for (const expected of ["Brand Name", "ready", "seo_activity", "home_services", "system-1", "wordpress_api", "authority-1", "budget-1", "engine-1", "openai/gpt-4o-mini", "logic-1"]) {
  assert.match(serialized, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.doesNotMatch(serialized, /must_not_log|credential_ref|application_password|prompt_cache_json|body_json/i);

console.log("execution log full context evidence test passed");
