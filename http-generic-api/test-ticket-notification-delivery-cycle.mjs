import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketNotificationService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/254_sprint68_ticket_notification_delivery_cycle.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "listSupportTicketNotificationQueue",
  "createSupportTicketNotificationCycle",
  "recordSupportTicketNotificationAck",
  "notificationRecommendation",
  "admin_auto_resolve_proposal",
  "admin_approval_required",
  "customer_resolution_update",
  "notification_cycle_recorded",
  "notification_ack_recorded",
  "external_send_performed: false",
]) {
  assert(service.includes(expected), `notification service must include ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "webhook.send", "external_send_performed: true"]) {
  assert(!service.includes(forbidden), `notification cycle must remain record-only and avoid external send: ${forbidden}`);
}

assert(routes.includes("supportTicketNotificationService.js"), "routes must import notification service");
assert(routes.includes('/admin/support/tickets/notifications/queue'), "routes must expose notification queue endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/notification-cycle'), "routes must expose notification cycle endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/notification-ack'), "routes must expose notification ack endpoint");
assert(routes.includes("listSupportTicketNotificationQueue"), "route must call queue service");
assert(routes.includes("createSupportTicketNotificationCycle"), "route must call cycle service");
assert(routes.includes("recordSupportTicketNotificationAck"), "route must call ack service");

for (const expectedTool of ["support_ticket_notification_queue", "support_ticket_notification_cycle_create", "support_ticket_notification_ack"]) {
  assert(migration.includes(expectedTool), `migration 254 must register ${expectedTool}`);
}
assert(migration.includes("Record-only delivery layer"), "migration must document record-only delivery behavior");
assert(runner.includes("254_sprint68_ticket_notification_delivery_cycle.sql"), "runner must allowlist migration 254");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 254 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket notification delivery cycle tests passed");
