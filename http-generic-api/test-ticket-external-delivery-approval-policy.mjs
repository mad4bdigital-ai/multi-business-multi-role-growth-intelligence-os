import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalDeliveryPolicyService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/256_sprint68_ticket_external_delivery_approval_policy.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "checkSupportTicketExternalDeliveryReadiness",
  "requestSupportTicketExternalDeliveryApproval",
  "decideSupportTicketExternalDeliveryApproval",
  "external_notification_delivery",
  "external_delivery_approval_requested",
  "external_delivery_approval_decided",
  "external_delivery_credential_binding_missing",
  "support_ticket_external_delivery_decision_invalid",
  "external_send_performed: false",
  "secret_value_included: false",
]) {
  assert(service.includes(expected), `external delivery policy service must include ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "external_send_performed: true", "webhook.send"]) {
  assert(!service.includes(forbidden), `external delivery policy must not perform external send: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalDeliveryPolicyService.js"), "routes must import external delivery policy service");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-delivery/readiness'), "routes must expose external delivery readiness endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-delivery/approval/request'), "routes must expose external delivery approval request endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-delivery/approval/decision'), "routes must expose external delivery approval decision endpoint");
assert(routes.includes("checkSupportTicketExternalDeliveryReadiness"), "routes must call readiness service");
assert(routes.includes("requestSupportTicketExternalDeliveryApproval"), "routes must call request service");
assert(routes.includes("decideSupportTicketExternalDeliveryApproval"), "routes must call decision service");

for (const expectedTool of ["support_ticket_external_delivery_readiness", "support_ticket_external_delivery_approval_request", "support_ticket_external_delivery_approval_decision"]) {
  assert(migration.includes(expectedTool), `migration 256 must register ${expectedTool}`);
}
assert(migration.includes("No external email/webhook send"), "migration must document no external send behavior");
assert(runner.includes("256_sprint68_ticket_external_delivery_approval_policy.sql"), "runner must allowlist migration 256");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 256 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external delivery approval policy tests passed");
