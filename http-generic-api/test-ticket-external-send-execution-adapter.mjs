import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalSendExecutionService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/257_sprint68_ticket_external_send_execution_adapter.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "planSupportTicketExternalSendExecution",
  "recordSupportTicketExternalSendExecution",
  "external_send_execution_recorded",
  "external_delivery_approval_hold_not_approved",
  "external_delivery_credential_binding_missing",
  "external_send_rate_limit_exceeded",
  "external_send_retry_limit_exceeded",
  "support_ticket_external_send_execution_not_ready",
  "recorded_not_sent",
  "external_send_performed: false",
]) {
  assert(service.includes(expected), `external send execution service must include ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "webhook.send", "external_send_performed: true", "delivery_status: \"sent\""]) {
  assert(!service.includes(forbidden), `external send execution adapter must not perform real external send: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalSendExecutionService.js"), "routes must import external send execution service");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-send/execution-plan'), "routes must expose execution plan endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-send/execution-record'), "routes must expose execution record endpoint");
assert(routes.includes("planSupportTicketExternalSendExecution"), "routes must call plan service");
assert(routes.includes("recordSupportTicketExternalSendExecution"), "routes must call record service");

for (const expectedTool of ["support_ticket_external_send_execution_plan", "support_ticket_external_send_execution_record"]) {
  assert(migration.includes(expectedTool), `migration 257 must register ${expectedTool}`);
}
assert(migration.includes("No external email/webhook send"), "migration must document no external send behavior");
assert(runner.includes("257_sprint68_ticket_external_send_execution_adapter.sql"), "runner must allowlist migration 257");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 257 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external send execution adapter tests passed");
