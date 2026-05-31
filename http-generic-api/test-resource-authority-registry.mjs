import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/175_sprint65_resource_authority_registry_foundation.sql", import.meta.url),
  "utf8"
);
const tenantOpenApi = readFileSync(new URL("./openapi.tenant-gpt.auth.yaml", import.meta.url), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_resource_authority_requirements"));
assert(migration.includes("resource_authority_engine"));
assert(migration.includes("resource_authority_policy_v1"));
assert(migration.includes("'resource_authority'"));

for (const gate of [
  "resource_resolution",
  "ownership_claim",
  "active_grant",
  "scoped_credential",
  "policy_gate",
  "audit_evidence",
  "readback",
]) {
  assert(migration.includes(gate), `resource authority migration must include gate ${gate}`);
}

for (const requirement of [
  "wordpress_post_publish_authority",
  "wordpress_draft_write_authority",
  "google_drive_file_write_authority",
  "github_repo_patch_authority",
  "n8n_workflow_activation_authority",
  "cloudflare_dns_write_authority",
  "local_connector_config_write_authority",
  "crm_contact_update_authority",
  "email_campaign_send_authority",
  "social_post_publish_authority",
  "ai_generated_asset_upload_authority",
]) {
  assert(migration.includes(`'${requirement}'`), `migration must seed authority requirement ${requirement}`);
}

for (const toolKey of [
  "resource_authority_decision_brief",
  "resource_publish_readiness_plan",
  "resource_external_write_readiness_plan",
]) {
  assert(migration.includes(`'${toolKey}'`), `migration must register admin planning tool ${toolKey}`);
}

for (const requiredTag of [
  "read_only",
  "no_execution",
  "no_apply",
  "no_secret_read",
]) {
  assert(migration.includes(requiredTag), `resource authority tools must advertise ${requiredTag}`);
}

assert(migration.includes('"max_files_changed":0'));
assert(migration.includes('"max_rows_mutated":0'));
assert(migration.includes('"max_external_writes":0'));
assert(migration.includes('"publish_allowed":false'));
assert(migration.includes('"apply_supported":false'));
assert(migration.includes('"secrets_returned":false'));
assert(migration.includes("apply_allowed TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("secrets_may_be_returned TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("credential_scope_required TINYINT(1) NOT NULL DEFAULT 1"));
assert(migration.includes("active_grant_required TINYINT(1) NOT NULL DEFAULT 1"));
assert(migration.includes("readback_required TINYINT(1) NOT NULL DEFAULT 1"));

for (const destructiveSql of [/^\s*DROP\s+TABLE\b/mi, /^\s*TRUNCATE\s+TABLE\b/mi, /^\s*DELETE\s+FROM\b/mi]) {
  assert(!destructiveSql.test(migration), `resource authority migration must not include destructive SQL statement ${destructiveSql}`);
}

for (const forbiddenExposure of [
  "platform_engine_task_apply",
  "/platform/engines/task-apply",
  "wordpress.publish",
  "external.write",
  "repo.patch.apply",
  "github.pr.merge",
  "credential_dump",
  "secret_read",
  "token_return",
  "implementation_code",
]) {
  if (["wordpress.publish", "external.write", "repo.patch.apply", "github.pr.merge", "credential_dump", "secret_read", "token_return"].includes(forbiddenExposure)) {
    assert(migration.includes(forbiddenExposure), `${forbiddenExposure} should appear only in forbidden tools`);
    continue;
  }
  assert(!migration.includes(forbiddenExposure), `resource authority must not expose ${forbiddenExposure}`);
}

assert(migration.includes("ON DUPLICATE KEY UPDATE"), "migration must be idempotent");
assert(migration.includes("'/platform/engines/decision-brief'"));
assert(migration.includes("'/platform/engines/task-plan'"));

assert(!tenantOpenApi.includes("resource_authority_decision_brief"));
assert(!tenantOpenApi.includes("resource_publish_readiness_plan"));
assert(!tenantOpenApi.includes("resource_external_write_readiness_plan"));
assert(!tenantOpenApi.includes("resource_authority_engine"));

console.log("resource authority registry tests passed");
