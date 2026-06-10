import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/274_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "support_ticket_lifecycle_snapshot_record_apply_v1",
  "support_ticket_lifecycle_snapshot_apply_binding_policy_v1",
  "support_ticket_lifecycle_snapshot_propose",
  "support_ticket_lifecycle_snapshot_record",
  "platform_orchestration",
  "capability_apply_authorization_policy_registry",
  "app_integration_action_bindings",
  "app_integration_tool_bindings",
  "allow_no_credential_binding",
  "allowed_source_tiers_json",
  "platform_managed_fallback",
  "no_ticket_mutation",
  "no_workflow_dispatch",
  "no_approval_decision",
  "no_external_send",
  "no_external_write",
  "no_provider_call",
  "no_credential_payload_read",
  "no_spend_change",
  "secrets_included",
]) assert(migration.includes(expected), `migration must include ${expected}`);

assert(migration.includes("'support_ticket_lifecycle_snapshot_record',\n  'support_ticket_lifecycle_snapshot_record'"), "operation intent/runtime surface must match record capability");
assert(migration.includes("'bind_action_support_ticket_lifecycle_snapshot_record'"), "action binding must be present");
assert(migration.includes("'resolver', 'none', 'manual_tools', 'active'"), "action binding must be no-credential resolver binding");
assert(migration.includes("'admin_platform_tool', 'state_changing',\n  `credential_source`, `exposure_scope`, `status`, `notes`") || migration.includes("'admin_platform_tool', 'state_changing', 'none'"), "tool binding must be state-changing but no-credential");
assert(migration.includes("JSON_ARRAY('platform_managed_fallback')"), "apply policy must restrict source tier to platform managed fallback");
assert(releaseReadiness.includes("274_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql"), "release readiness must track migration 274");
assert(releaseReadiness.includes('policy_key: "support_ticket_lifecycle_snapshot_apply_binding_policy_v1"'), "release readiness must require apply binding policy");
assert(runner.includes("274_sprint68_support_ticket_lifecycle_snapshot_apply_binding.sql"), "governed migration runner must allowlist migration 274");

const forbiddenSql = /\b(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|UPDATE\s+tickets|INSERT\s+INTO\s+`?tickets`?)\b/i;
assert(!forbiddenSql.test(migration), "apply binding migration must not contain destructive SQL or ticket mutation");

for (const forbidden of ["runtime_endpoint_call", "callTool.name", "/system/tools/call", "credential_payload", "provider_dispatch_enabled_changed = 1", "external_send_performed = 1"]) {
  assert(!migration.includes(forbidden), `migration must not include forbidden surface ${forbidden}`);
}

console.log("support ticket snapshot apply binding is registry-only, no-credential, and no-execution");
