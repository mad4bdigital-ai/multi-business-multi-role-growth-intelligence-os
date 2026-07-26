import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketActivationInboxService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/252_sprint68_ticket_activation_inbox_feedback.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "getActivationTicketInbox",
  "recordSupportTicketAdminFeedback",
  "activation_ticket_inbox",
  "awaiting_activation",
  "needs_approval",
  "auto_resolve_candidates",
  "admin_ack_required",
  "support_ticket_admin_feedback_action_invalid",
  "admin_feedback_",
]) {
  assert(service.includes(expected), `activation inbox service must include ${expected}`);
}

assert(routes.includes("supportTicketActivationInboxService.js"), "routes must import activation inbox service");
assert(routes.includes('/admin/activation/ticket-inbox'), "routes must expose activation ticket inbox");
assert(routes.includes('/admin/support/tickets/:ticket_id/admin-feedback'), "routes must expose admin feedback endpoint");
assert(routes.includes("getActivationTicketInbox"), "route must call inbox service");
assert(routes.includes("recordSupportTicketAdminFeedback"), "route must call feedback service");

for (const expectedTool of ["support_ticket_activation_inbox", "support_ticket_admin_feedback"]) {
  assert(migration.includes(expectedTool), `migration 252 must register ${expectedTool}`);
}
assert(migration.includes("activation-gated"), "migration must document activation-gated operations");
assert(runner.includes("252_sprint68_ticket_activation_inbox_feedback.sql"), "runner must allowlist migration 252");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 252 must be additive/non-destructive");

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(forbidden), `migration must not contain secret-like field ${forbidden}`);
}

console.log("ticket activation inbox feedback tests passed");
