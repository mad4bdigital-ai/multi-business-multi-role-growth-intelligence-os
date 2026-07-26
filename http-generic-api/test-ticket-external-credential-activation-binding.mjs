import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalCredentialActivationService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/260_sprint68_ticket_external_credential_activation_binding.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "planSupportTicketExternalCredentialActivation",
  "activateAndBindSupportTicketExternalCredential",
  "support_ticket_external_credential_activation_not_ready",
  "support_ticket_external_credential_activation_readback_failed",
  "external_delivery_credential_binding",
  "external_credential_activated_and_bound",
  "ready_to_activate_and_bind",
  "external_credential_validation_evidence_required",
  "SAFE_SECRET_MARKER_KEYS",
  "external_send_performed: false",
  "secret_value_included: false",
]) {
  assert(service.includes(expected), `external credential activation service must include ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "external_send_performed: true", "INSERT INTO secret_values", "raw_secret_value"]) {
  assert(!service.includes(forbidden), `external credential activation must not store raw secrets or send externally: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalCredentialActivationService.js"), "routes must import external credential activation service");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-credential/activation-plan'), "routes must expose activation plan endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-credential/activate-and-bind'), "routes must expose activate-and-bind endpoint");
assert(routes.includes("planSupportTicketExternalCredentialActivation"), "routes must call activation plan service");
assert(routes.includes("activateAndBindSupportTicketExternalCredential"), "routes must call activate-and-bind service");

for (const expectedTool of ["support_ticket_external_credential_activation_plan", "support_ticket_external_credential_activate_and_bind"]) {
  assert(migration.includes(expectedTool), `migration 260 must register ${expectedTool}`);
}
assert(migration.includes("No raw secret values"), "migration must document no raw secret values");
assert(migration.includes("No external email/webhook send"), "migration must document no external send");
assert(runner.includes("260_sprint68_ticket_external_credential_activation_binding.sql"), "runner must allowlist migration 260");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 260 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external credential activation binding tests passed");
