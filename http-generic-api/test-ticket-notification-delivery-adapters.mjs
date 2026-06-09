import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketNotificationAdapterService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/255_sprint68_ticket_notification_delivery_adapters.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "listSupportTicketNotificationAdapters",
  "previewSupportTicketNotificationDelivery",
  "dispatchSupportTicketNotificationDelivery",
  "activation_inbox",
  "dashboard",
  "internal_timeline",
  "email",
  "webhook",
  "support_ticket_notification_external_delivery_gated",
  "external_send_enabled: false",
  "external_send_performed: false",
  "notification_adapter_recorded",
]) {
  assert(service.includes(expected), `notification adapter service must include ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "external_send_performed: true", "webhook.send"]) {
  assert(!service.includes(forbidden), `notification adapters must not perform external send: ${forbidden}`);
}

assert(routes.includes("supportTicketNotificationAdapterService.js"), "routes must import notification adapter service");
assert(routes.includes('/admin/support/tickets/notifications/adapters'), "routes must expose adapters endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/notification-delivery/preview'), "routes must expose preview endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/notification-delivery/dispatch'), "routes must expose dispatch endpoint");
assert(routes.includes("listSupportTicketNotificationAdapters"), "routes must call adapters service");
assert(routes.includes("previewSupportTicketNotificationDelivery"), "routes must call preview service");
assert(routes.includes("dispatchSupportTicketNotificationDelivery"), "routes must call dispatch service");

for (const expectedTool of ["support_ticket_notification_adapters", "support_ticket_notification_delivery_preview", "support_ticket_notification_delivery_dispatch"]) {
  assert(migration.includes(expectedTool), `migration 255 must register ${expectedTool}`);
}
assert(migration.includes("Email/webhook external sending remains gated"), "migration must document external-send gating");
assert(runner.includes("255_sprint68_ticket_notification_delivery_adapters.sql"), "runner must allowlist migration 255");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 255 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket notification delivery adapter tests passed");
