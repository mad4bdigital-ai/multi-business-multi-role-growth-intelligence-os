import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("./migrations/20260709_tenant_resolution_registry_schema.sql", import.meta.url),
  "utf8"
);

for (const tableName of [
  "tenant_resolution_playbooks",
  "tenant_resolution_cases",
  "tenant_resolution_case_events",
  "tenant_resolution_readbacks",
]) {
  assert(
    migration.includes(`CREATE TABLE IF NOT EXISTS \`${tableName}\``),
    `${tableName} must be created additively`
  );
}

for (const playbookKey of [
  "wordpress_site_doctor_v1",
  "tenant_skill_approval_decision_v1",
  "task_source_repair_v1",
  "google_ads_setup_preflight_v1",
  "connector_health_repair_v1",
]) {
  assert(migration.includes(`'${playbookKey}'`), `${playbookKey} must be seeded`);
}

for (const rootFamily of [
  "wordpress_site_health",
  "tenant_skill_approval",
  "task_source_quality",
  "provider_setup_ads",
  "connector_runtime_readiness",
]) {
  assert(migration.includes(`'${rootFamily}'`), `${rootFamily} must be represented in seed data`);
}

for (const requiredColumn of [
  "`active_case_key` VARCHAR(191) NULL",
  "`root_fingerprint_sha256` CHAR(64) NOT NULL",
  "`source_alert_keys_json` JSON NULL",
  "`source_refs_json` JSON NULL",
  "`approval_hold_id` VARCHAR(64) NULL",
  "`capability_envelope_id` VARCHAR(64) NULL",
  "`readback_status` ENUM('not_run','passed','failed','blocked','indeterminate')",
  "`secrets_included` TINYINT(1) NOT NULL DEFAULT 0",
]) {
  assert(migration.includes(requiredColumn), `migration must include ${requiredColumn}`);
}

for (const requiredIndex of [
  "UNIQUE KEY `uq_tenant_resolution_cases_active_case_key`",
  "KEY `idx_tenant_resolution_cases_tenant_workspace`",
  "KEY `idx_tenant_resolution_cases_family_status`",
  "KEY `idx_tenant_resolution_case_events_case_created`",
  "KEY `idx_tenant_resolution_readbacks_case_created`",
]) {
  assert(migration.includes(requiredIndex), `migration must include ${requiredIndex}`);
}

for (const invariant of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "no_runtime_dispatch=true",
  "secrets_included=false",
]) {
  assert(migration.includes(invariant), `migration must include safety invariant ${invariant}`);
}

for (const forbiddenSql of [
  /^\s*DROP\s+TABLE\b/mi,
  /^\s*TRUNCATE\s+TABLE\b/mi,
  /^\s*DELETE\s+FROM\b/mi,
  /^\s*ALTER\s+TABLE\b[^;]*\bDROP\b/mi,
]) {
  assert(!forbiddenSql.test(migration), `migration must not include destructive SQL ${forbiddenSql}`);
}

for (const forbiddenSurface of [
  "platform_endpoint_tool_exports",
  "tenant_platform_endpoint_tools",
  "runtime_endpoint_call",
  "/system/tools/call",
  "provider_dispatch_enabled_changed = 1",
  "external_send_performed = 1",
  "spend_change_allowed',true",
  "provider_write_allowed',true",
  "local_command_dispatch_allowed',true",
]) {
  assert(!migration.includes(forbiddenSurface), `schema foundation must not enable ${forbiddenSurface}`);
}

for (const safePolicyMarker of [
  "'diagnostic_only',true",
  "'provider_write_allowed',false",
  "'credential_payload_read_allowed',false",
  "'approval_hold_required',true",
  "'internal_registry_only',true",
  "'spend_change_allowed',false",
  "'local_command_dispatch_allowed',false",
  "'apply_requires_separate_certification',true",
]) {
  assert(migration.includes(safePolicyMarker), `migration must include safe policy marker ${safePolicyMarker}`);
}

console.log("tenant resolution registry schema contract tests passed");
