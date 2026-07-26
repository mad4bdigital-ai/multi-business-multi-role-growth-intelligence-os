import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalCredentialOrchestrationService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/261_sprint68_ticket_external_credential_orchestration.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "planSupportTicketExternalCredentialOrchestration",
  "approveActivateBindAndVerifySupportTicketExternalCredential",
  "support_ticket_external_credential_orchestration_not_ready",
  "support_ticket_external_credential_orchestration_readback_failed",
  "external_credential_orchestration_verified",
  "approve_activate_bind_verify",
  "readiness_by_ref",
  "readiness_by_binding",
  "ready_to_orchestrate",
  "SAFE_SECRET_MARKER_KEYS",
  "external_send_performed: false",
  "secret_value_included: false",
]) {
  assert(service.includes(expected), `external credential orchestration service must include ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "external_send_performed: true", "INSERT INTO secret_values", "raw_secret_value"]) {
  assert(!service.includes(forbidden), `external credential orchestration must not store raw secrets or send externally: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalCredentialOrchestrationService.js"), "routes must import external credential orchestration service");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-credential/orchestration-plan'), "routes must expose orchestration plan endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-credential/approve-activate-bind-verify'), "routes must expose approve-activate-bind-verify endpoint");
assert(routes.includes("planSupportTicketExternalCredentialOrchestration"), "routes must call orchestration plan service");
assert(routes.includes("approveActivateBindAndVerifySupportTicketExternalCredential"), "routes must call approve-activate-bind-verify service");

for (const expectedTool of ["support_ticket_external_credential_orchestration_plan", "support_ticket_external_credential_approve_activate_bind_verify"]) {
  assert(migration.includes(expectedTool), `migration 261 must register ${expectedTool}`);
}
assert(migration.includes("No raw secret values"), "migration must document no raw secret values");
assert(migration.includes("No external email/webhook send"), "migration must document no external send");
assert(runner.includes("261_sprint68_ticket_external_credential_orchestration.sql"), "runner must allowlist migration 261");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 261 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external credential orchestration tests passed");
