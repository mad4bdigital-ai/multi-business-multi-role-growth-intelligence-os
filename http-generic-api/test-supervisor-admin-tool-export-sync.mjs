import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessMigrationSqlPreflight } from "./releaseReadiness.js";
import { checkSupervisorAdminToolExportSync } from "./scripts/check-supervisor-admin-tool-export-sync.mjs";

const result = checkSupervisorAdminToolExportSync();
assert.equal(result.ok, true, JSON.stringify(result, null, 2));
assert.equal(result.tools_checked, 3);
assert.equal(result.semantic_capabilities_checked, 1);
assert.equal(result.policy_patches_checked, 1);
assert.equal(result.secrets_included, false);

const exportMigrationName = "20260714_supervisor_runtime_admin_tool_exports.sql";
const exportMigration = readFileSync(`migrations/${exportMigrationName}`, "utf8");
for (const marker of [
  "supervisor_runtime_readiness",
  "supervisor_behavioral_certification",
  "APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION",
  "no_provider_call=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(exportMigration.includes(marker), `export migration missing ${marker}`);
}
assert.doesNotMatch(exportMigration, /private_key|refresh_token|client_secret|access_token|value_ciphertext/i);

const exportPreflight = assessMigrationSqlPreflight(exportMigrationName, exportMigration);
assert.equal(exportPreflight.status, "pass", JSON.stringify(exportPreflight, null, 2));
assert.equal(exportPreflight.risk_count, 0, JSON.stringify(exportPreflight, null, 2));
assert.equal(exportPreflight.secrets_included, false, JSON.stringify(exportPreflight, null, 2));

const capabilityMigrationName = "20260715_supervisor_behavioral_certification_capability_policy.sql";
const capabilityMigration = readFileSync(`migrations/${capabilityMigrationName}`, "utf8");
for (const marker of [
  "platform_semantic_capabilities",
  "capability_apply_authorization_policy_registry",
  "supervisor_behavioral_certification",
  "supervisor_behavioral_certification_apply_v1",
  "platform_orchestration",
  "admin_control",
  "APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION",
  "requires_ready_for_dispatch",
  "requires_dispatch_allowed",
  "requires_zero_blocking_gaps",
  "requires_audit_evidence",
  "requires_readback",
  "requires_typed_confirmation",
  "requires_same_cycle_dry_run",
  "transaction_rollback_required",
  "fixture_persistence_forbidden",
  "provider_call_forbidden",
  "external_write_forbidden",
  "credential_payload_read_forbidden",
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(capabilityMigration.includes(marker), `capability migration missing ${marker}`);
}
assert.doesNotMatch(capabilityMigration, /private_key|refresh_token|client_secret|access_token|value_ciphertext/i);
assert.match(capabilityMigration, /allow_external_write[\s\S]+?0,/);
assert.match(capabilityMigration, /allow_credential_binding[\s\S]+?0,/);
assert.match(capabilityMigration, /allow_no_credential_binding[\s\S]+?1,/);

const capabilityPreflight = assessMigrationSqlPreflight(capabilityMigrationName, capabilityMigration);
assert.equal(capabilityPreflight.status, "pass", JSON.stringify(capabilityPreflight, null, 2));
assert.equal(capabilityPreflight.risk_count, 0, JSON.stringify(capabilityPreflight, null, 2));
assert.equal(capabilityPreflight.secrets_included, false, JSON.stringify(capabilityPreflight, null, 2));

const policyPatchMigrationName = "20260715_supervisor_behavioral_certification_policy_sensitive_field_fix.sql";
const policyPatchMigration = readFileSync(`migrations/${policyPatchMigrationName}`, "utf8");
for (const marker of [
  "capability_apply_authorization_policy_registry",
  "supervisor_behavioral_certification_apply_v1",
  "supervisor_behavioral_certification",
  "platform_orchestration",
  "admin_control",
  "JSON_REMOVE",
  "$.confirmation_token",
  "$.required_confirmation",
  "APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION",
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "secrets_included=false",
]) {
  assert.ok(policyPatchMigration.includes(marker), `policy patch migration missing ${marker}`);
}
assert.match(policyPatchMigration, /JSON_REMOVE\s*\([\s\S]*?['"]\$\.confirmation_token['"]\s*\)/);
assert.match(policyPatchMigration, /JSON_SET\s*\([\s\S]*?['"]\$\.required_confirmation['"]/);
assert.doesNotMatch(policyPatchMigration, /private_key|refresh_token|client_secret|access_token|value_ciphertext/i);

const policyPatchPreflight = assessMigrationSqlPreflight(policyPatchMigrationName, policyPatchMigration);
assert.equal(policyPatchPreflight.status, "pass", JSON.stringify(policyPatchPreflight, null, 2));
assert.equal(policyPatchPreflight.risk_count, 0, JSON.stringify(policyPatchPreflight, null, 2));
assert.equal(policyPatchPreflight.secrets_included, false, JSON.stringify(policyPatchPreflight, null, 2));

console.log("supervisor Admin tool export and capability policy sync contract OK");
