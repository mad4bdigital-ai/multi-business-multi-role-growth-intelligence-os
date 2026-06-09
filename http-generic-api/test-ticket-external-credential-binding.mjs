import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bindingService = readFileSync("supportTicketExternalCredentialBindingService.js", "utf8");
const policyService = readFileSync("supportTicketExternalDeliveryPolicyService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/258_sprint68_ticket_external_delivery_credential_binding.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "listSupportTicketExternalCredentialCandidates",
  "requestSupportTicketExternalCredentialBinding",
  "decideSupportTicketExternalCredentialBinding",
  "external_delivery_credential_binding",
  "external_delivery_credential_intake",
  "supervisor_approval",
  "secret_value_included: false",
  "external_send_performed: false",
]) {
  assert(bindingService.includes(expected), `credential binding service must include ${expected}`);
}

for (const expected of [
  "lookupCredentialByRef",
  "findApprovedCredentialBinding",
  "approved_ticket_binding",
  "ref_id AS credential_ref",
  "provider_family AS provider",
  "credential_type AS label",
]) {
  assert(policyService.includes(expected), `external delivery policy service must include ${expected}`);
}

for (const forbidden of ["password", "access_token", "refresh_token", "client_secret", "sendMail", "nodemailer", "fetch(", "axios", "external_send_performed: true"]) {
  assert(!bindingService.includes(forbidden), `credential binding service must not expose secrets or send externally: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalCredentialBindingService.js"), "routes must import external credential binding service");
assert(routes.includes('/admin/support/tickets/external-delivery/credential-candidates'), "routes must expose credential candidates endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-delivery/credential-binding/request'), "routes must expose credential binding request endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-delivery/credential-binding/decision'), "routes must expose credential binding decision endpoint");

for (const expectedTool of ["support_ticket_external_credential_candidates", "support_ticket_external_credential_binding_request", "support_ticket_external_credential_binding_decision"]) {
  assert(migration.includes(expectedTool), `migration 258 must register ${expectedTool}`);
}
assert(migration.includes("No raw secret values"), "migration must document no raw secret values");
assert(runner.includes("258_sprint68_ticket_external_delivery_credential_binding.sql"), "runner must allowlist migration 258");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 258 must be additive/non-destructive");

console.log("ticket external credential binding tests passed");
