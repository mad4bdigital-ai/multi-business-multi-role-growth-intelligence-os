import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gate = readFileSync("supportTicketExternalSendProviderGateService.js", "utf8");

for (const expected of [
  "external_send_provider_dispatch_failed",
  "support_ticket_external_send_provider_dispatch_failed",
  "safeFailurePayload",
  "smtp_code",
  "smtp_stage",
  "safe_diagnostics",
  "secret_value_included: false",
  "secrets_included: false",
  "body: undefined",
  "body_text: undefined",
  "body_html: undefined",
]) {
  assert(gate.includes(expected), `provider gate must persist safe failure diagnostic ${expected}`);
}

assert(!gate.includes("dispatchError.password"), "failure diagnostics must not read password");
assert(!gate.includes("dispatchError.secret"), "failure diagnostics must not read secret values");
assert(!gate.includes("dispatchError.raw"), "failure diagnostics must not read raw provider response");

console.log("hostinger smtp safe failure diagnostics tests passed");
