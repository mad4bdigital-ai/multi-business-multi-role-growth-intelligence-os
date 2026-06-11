import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalDeliveryAdminControlService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/955_sprint68_external_delivery_admin_control_surface.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "getExternalDeliveryAdminOverview",
  "upsertExternalDeliveryRecipientAllowlist",
  "disableExternalDeliveryRecipientAllowlist",
  "setExternalDeliveryAdapterDispatch",
  "revokeGmailUserConnection",
  "secret_value_included: false",
  "secrets_included: false",
  "external_delivery_recipient_allowlist_registry",
  "user_app_connections",
]) {
  assert(service.includes(expected), `admin control service must include ${expected}`);
}

for (const expected of [
  "/admin/support/tickets/external-delivery/control/overview",
  "/admin/support/tickets/external-delivery/control/allowlist/upsert",
  "/admin/support/tickets/external-delivery/control/allowlist/disable",
  "/admin/support/tickets/external-delivery/control/adapter/dispatch",
  "/admin/support/tickets/external-delivery/control/gmail/revoke",
]) {
  assert(routes.includes(expected), `support ticket routes must expose ${expected}`);
}

for (const expected of [
  "v_external_delivery_admin_overview",
  "v_external_delivery_recent_send_events",
  "v_external_delivery_gmail_connections",
  "external_delivery_control_overview",
  "external_delivery_allowlist_upsert",
  "external_delivery_allowlist_disable",
  "external_delivery_adapter_dispatch_set",
  "external_delivery_gmail_connection_revoke",
  "support_ticket_external_delivery_admin_control_surface_policy_v1",
  "external_send_performed_by_controls",
]) {
  assert(migration.includes(expected), `migration 955 must include ${expected}`);
}

assert(runner.includes("955_sprint68_external_delivery_admin_control_surface.sql"), "governed migration runner must allowlist migration 955");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 955 must be additive/non-destructive");
assert(!migration.toLowerCase().includes("secret_value"), "migration 955 must not include raw secret-value fields");
console.log("external delivery admin control surface tests passed");
