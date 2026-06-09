import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalSecretIntakeService.js", "utf8");
const policy = readFileSync("supportTicketExternalDeliveryPolicyService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/259_sprint68_ticket_external_secret_intake_surface.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "planSupportTicketExternalSecretIntake",
  "registerSupportTicketExternalSecretReference",
  "activateSupportTicketExternalSecretReference",
  "support_ticket_external_secret_raw_value_rejected",
  "pending_validation",
  "status: \"disabled\"",
  "secret_value_included: false",
  "external_send_performed: false",
  "approved credential intake or binding hold",
]) {
  assert(service.includes(expected), `external secret intake service must include ${expected}`);
}

for (const expected of [
  "validation_status IN ('valid','validated','ready','passed')",
  "consent_status IN ('not_required','granted')",
]) {
  assert(policy.includes(expected), `external delivery readiness must require ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "external_send_performed: true", "INSERT INTO secret_values", "raw_secret_value"]) {
  assert(!service.includes(forbidden), `external secret intake must not store raw secrets or send externally: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalSecretIntakeService.js"), "routes must import external secret intake service");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-secret/intake-plan'), "routes must expose intake plan endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-secret/reference/register'), "routes must expose register endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-secret/reference/activate'), "routes must expose activate endpoint");

for (const expectedTool of ["support_ticket_external_secret_intake_plan", "support_ticket_external_secret_reference_register", "support_ticket_external_secret_reference_activate"]) {
  assert(migration.includes(expectedTool), `migration 259 must register ${expectedTool}`);
}
assert(migration.includes("No raw secret values"), "migration must document no raw secret values");
assert(runner.includes("259_sprint68_ticket_external_secret_intake_surface.sql"), "runner must allowlist migration 259");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 259 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external secret intake surface tests passed");
