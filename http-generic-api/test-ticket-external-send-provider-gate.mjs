import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalSendProviderGateService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/262_sprint68_ticket_external_send_provider_gate.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "planSupportTicketExternalSendProviderGate",
  "recordSupportTicketExternalSendProviderGateAttempt",
  "external_send_provider_dispatch_not_enabled",
  "external_send_provider_adapter_not_implemented",
  "provider_dispatch_blocked_not_sent",
  "external_send_provider_gate_recorded",
  "PROVIDER_DISPATCH_ENABLED",
  "provider_adapter_implemented: false",
  "external_send_supported: false",
  "external_send_performed: false",
  "secret_value_included: false",
]) {
  assert(service.includes(expected), `external send provider gate service must include ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "webhook.send", "external_send_performed: true", "delivery_status: \"sent\"", "provider_adapter_implemented: true"]) {
  assert(!service.includes(forbidden), `provider gate must not perform real external send: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalSendProviderGateService.js"), "routes must import external send provider gate service");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-send/provider-gate-plan'), "routes must expose provider gate plan endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-send/provider-gate-attempt'), "routes must expose provider gate attempt endpoint");
assert(routes.includes("planSupportTicketExternalSendProviderGate"), "routes must call provider gate plan service");
assert(routes.includes("recordSupportTicketExternalSendProviderGateAttempt"), "routes must call provider gate attempt service");

for (const expectedTool of ["support_ticket_external_send_provider_gate_plan", "support_ticket_external_send_provider_gate_attempt"]) {
  assert(migration.includes(expectedTool), `migration 262 must register ${expectedTool}`);
}
assert(migration.includes("does not perform external email/webhook delivery"), "migration must document no external send");
assert(runner.includes("262_sprint68_ticket_external_send_provider_gate.sql"), "runner must allowlist migration 262");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 262 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external send provider gate tests passed");
