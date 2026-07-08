import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(
  new URL("./migrations/20260709_tenant_resolution_registry_schema.sql", import.meta.url),
  "utf8"
);
const spec = fs.readFileSync(
  new URL("../specs/009-tenant-self-healing-resolution-layer/spec.md", import.meta.url),
  "utf8"
);
const plan = fs.readFileSync(
  new URL("../specs/009-tenant-self-healing-resolution-layer/plan.md", import.meta.url),
  "utf8"
);
const tasks = fs.readFileSync(
  new URL("../specs/009-tenant-self-healing-resolution-layer/tasks.md", import.meta.url),
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
  assert(spec.includes(tableName) || plan.includes(tableName), `${tableName} must be documented in the spec kit`);
}

for (const playbookKey of [
  "wordpress_site_doctor_v1",
  "tenant_skill_approval_decision_v1",
  "task_source_repair_v1",
  "google_ads_setup_preflight_v1",
  "connector_health_repair_v1",
]) {
  assert(migration.includes(`'${playbookKey}'`), `${playbookKey} must be seeded`);
  assert(plan.includes(playbookKey), `${playbookKey} must be explained in the implementation plan`);
}

for (const rootFamily of [
  "wordpress_site_health",
  "tenant_skill_approval",
  "task_source_quality",
  "provider_setup_ads",
  "connector_runtime_readiness",
]) {
  assert(migration.includes(`'${rootFamily}'`), `${rootFamily} must be represented in seed data`);
  assert(spec.includes(`\`${rootFamily}\``), `${rootFamily} must be documented as an initial root family`);
}

for (const requiredColumn of [
  "`active_case_key` VARCHAR(191) NULL",
  "`root_fingerprint_sha256` CHAR(64) NOT NULL",
  "`source_alert_keys_json` JSON NULL",
  "`capability_envelope_id` VARCHAR(64) NULL",
  "`readback_status` ENUM('not_run','passed','failed','blocked','indeterminate')",
  "`secrets_included` TINYINT(1) NOT NULL DEFAULT 0",
]) {
  assert(migration.includes(requiredColumn), `migration must include ${requiredColumn}`);
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

for (const childBranch of [
  "gpt/tenant-resolution-registry-schema",
  "gpt/tenant-attention-projection-api",
  "gpt/tenant-resolution-case-api",
  "gpt/tenant-approval-center",
  "gpt/task-source-repair-playbook",
  "gpt/wordpress-site-doctor-playbook",
  "gpt/google-ads-setup-playbook",
  "gpt/connector-health-repair-playbook",
  "gpt/tenant-resolution-apply-gates",
  "gpt/tenant-resolution-readback-closeout",
]) {
  assert(plan.includes(childBranch), `plan must track child PR branch ${childBranch}`);
}

for (const task of [
  "Add `tenant_resolution_playbooks` migration.",
  "Add `tenant_resolution_cases` migration.",
  "Add `tenant_resolution_case_events` migration.",
  "Add `tenant_resolution_readbacks` migration.",
]) {
  assert(tasks.includes(task), `tasks must include schema task: ${task}`);
}

assert(spec.includes("Operational Attention does not mark recovered without same-cycle evidence."));
assert(plan.includes("This father PR."));
assert(tasks.includes("Readback is required before resolved/recovered state."));

console.log("tenant resolution registry schema contract tests passed");
