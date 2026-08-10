import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/20260810_remaining_tenant_runtime_lifecycle_gap_closure.sql", import.meta.url), "utf8");
const wordpressAdapter = readFileSync(new URL("./appAdapters/wordpressRest.js", import.meta.url), "utf8");
const activationSnapshot = readFileSync(new URL("./tenantActivationSnapshot.js", import.meta.url), "utf8");
const cmsPlanner = readFileSync(new URL("./cmsAuthorityReconciliation.js", import.meta.url), "utf8");
const cmsRunner = readFileSync(new URL("./scripts/cms-authority-reconciliation.mjs", import.meta.url), "utf8");
const supportResolution = readFileSync(new URL("./supportTicketResolutionService.js", import.meta.url), "utf8");

for (const marker of [
  "no_provider_call=true",
  "no_credential_payload_read=true",
  "no_raw_secrets=true",
  "no_external_send=true",
  "no_external_write=true",
  "no_runtime_dispatch=true",
  "no_live_tenant_repair=true",
  "secrets_included=false",
]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

assert.match(migration, /alert_support_ticket_escalated/);
assert.match(migration, /source_type[^\n]*condition_key[\s\S]*'support_ticket'/);
assert.match(migration, /CREATE OR REPLACE VIEW v_wordpress_action_surface_contract/);
assert.match(migration, /CREATE OR REPLACE VIEW v_wordpress_action_surface_reconciliation/);
assert.match(migration, /'wordpress_rest\.validate_connection'/);
assert.match(migration, /'wordpress_rest\.get_current_user'/);
assert.match(migration, /'wordpress_rest\.read_users'/);
assert.match(migration, /'app_connection_action'/);
assert.match(migration, /'wordpress_api'/);
assert.match(migration, /platform_plugin_selector_allowed/);
assert.match(migration, /invalid_adapter_alias_binding_count/);
assert.match(migration, /adapter_action_incorrectly_promoted_to_platform_action/);

// Adapter read operations remain app-local operations. Do not manufacture new
// canonical action bindings that would bypass the existing wordpress_api group.
for (const operation of [
  "wordpress_rest.validate_connection",
  "wordpress_rest.get_current_user",
  "wordpress_rest.read_users",
]) {
  assert(wordpressAdapter.includes(operation), `${operation} must remain implemented by the wordpress_rest adapter`);
  const aliasInsert = new RegExp(`INSERT INTO app_integration_action_bindings[\\s\\S]{0,1600}${operation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  assert.doesNotMatch(migration, aliasInsert, `${operation} must not become a duplicate canonical Platform Plugin action binding`);
}

assert.match(activationSnapshot, /scopeMode: "activation_pending_tasks"/);
assert.match(activationSnapshot, /activation_visibility = 1/);
assert.match(activationSnapshot, /owner_scope[\s\S]*'tenant'[\s\S]*'user'/);
assert.match(activationSnapshot, /statusFilter\(\["pending", "in_progress", "blocked"\]\)/);
assert.doesNotMatch(
  activationSnapshot,
  /pending_tasks_open[^\n]*closed[^\n]*completed[^\n]*resolved/,
  "pending task summary must not use stale terminal-state exclusions that diverge from v_activation_pending_tasks",
);

assert.match(cmsPlanner, /revoke_stale_cms_site_access_grant/);
for (const reason of [
  "connection_missing",
  "connection_inactive",
  "connection_tenant_mismatch",
  "connection_user_mismatch",
  "connection_app_mismatch",
]) assert.match(cmsPlanner, new RegExp(reason));
assert.match(cmsRunner, /SELECT connection_id, user_id, tenant_id, app_key, status, validation_status/);
for (const forbidden of ["encrypted_credentials", "credential_ref", "access_token", "refresh_token", "password", "secret"]) {
  const connectionInventoryQuery = cmsRunner.match(/SELECT connection_id, user_id, tenant_id, app_key, status, validation_status[\s\S]*?FROM user_app_connections/)?.[0] || "";
  assert.doesNotMatch(connectionInventoryQuery, new RegExp(forbidden, "i"));
}
assert.match(cmsRunner, /UPDATE cms_site_access_grants[\s\S]*status = 'revoked'/);
assert.doesNotMatch(cmsRunner, /DELETE\s+FROM\s+cms_site_access_grants/i);

assert.match(supportResolution, /ticketEscalationEvidence/);
assert.match(supportResolution, /INSERT INTO operational_alerts/);
assert.match(supportResolution, /support_ticket_escalated/);
assert.match(supportResolution, /ON DUPLICATE KEY UPDATE/);
assert.doesNotMatch(supportResolution, /operational_alert_notification_outbox/);
assert.doesNotMatch(supportResolution, /fetch\s*\(/);

console.log("remaining tenant runtime/lifecycle gap closure tests passed");
