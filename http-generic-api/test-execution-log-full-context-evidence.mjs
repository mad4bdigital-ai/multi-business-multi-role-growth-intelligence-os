import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/284_sprint68_execution_log_full_context_evidence.sql", import.meta.url), "utf8");
const logger = readFileSync(new URL("./executionEvidenceLogger.js", import.meta.url), "utf8");
const smoke = readFileSync(new URL("./scripts/execution-log-runtime-evidence-smoke.mjs", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

for (const token of [
  "brand_name", "brand_core_status", "brand_core_asset_keys", "brand_evidence_json",
  "business_activity_type_key", "activity_key", "business_type_key", "knowledge_profile_key",
  "business_activity_evidence_json", "business_type_evidence_json", "knowledge_evidence_json",
  "installation_id", "permission_grant_id", "permission_key", "connector_family", "provider_family",
  "connected_system_evidence_json", "permission_evidence_json",
  "resource_authority_binding_id", "resource_authority_evidence_json", "budget_authority_id", "budget_authority_evidence_json",
  "engine_key", "engine_policy_key", "engine_evidence_json",
  "model_key", "model_provider_key", "model_run_id", "model_evidence_json",
  "logic_key", "logic_pack_key", "logic_evidence_json",
  "v_execution_log_full_context_evidence_readiness", "v_execution_log_full_context_evidence_recent", "execution_log_full_context_evidence_policy_v1"
]) assert.match(migration, new RegExp(token));

assert.match(runner, /284_sprint68_execution_log_full_context_evidence\.sql/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.doesNotMatch(migration, /encrypted_credentials|value_ciphertext|secret_value|token_value|private_key/i);

for (const token of [
  "brandEvidence", "businessActivityEvidence", "businessTypeEvidence", "connectedSystemEvidence", "permissionEvidence",
  "resourceAuthorityEvidence", "budgetAuthorityEvidence", "engineEvidence", "modelEvidence", "logicEvidence", "knowledgeEvidence",
  "brand_core_status", "business_activity_type_key", "resource_authority_binding_id", "budget_authority_id", "knowledge_profile_key"
]) assert.match(logger, new RegExp(token));

for (const token of [
  "execution_log_full_context_evidence_smoke", "brand_core_status", "business_activity_type_key", "business_type_key", "knowledge_profile_key",
  "permission_key", "resource_authority_binding_id", "budget_authority_id", "engine_key", "model_key", "logic_key",
  "jsonValidityKeys", "blocked_field_leak_detected", "external_provider_called: false", "secrets_included: false"
]) assert.match(smoke, new RegExp(token));

for (const blocked of [
  "credential_ref", "value_ciphertext", "secret_value", "token_value", "password", "private_key", "config_json",
  "capability_json", "encrypted_credentials", "webhook_url", "n8n_webhook_url", "system_prompt", "prompt_template",
  "manifest_json", "tool_manifest_json", "input_schema_json", "output_schema_json"
]) assert.match(smoke, new RegExp(blocked));

assert.doesNotMatch(smoke, /process\.env\.[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|KEY)/i);

console.log("execution log full context evidence guard passed");
