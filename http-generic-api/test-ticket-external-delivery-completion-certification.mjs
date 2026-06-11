import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dispatchService = readFileSync("supportTicketExternalProviderDispatchService.js", "utf8");
const liveSendService = readFileSync("supportTicketExternalLiveSendService.js", "utf8");
const completionService = readFileSync("supportTicketExternalDeliveryCompletionService.js", "utf8");
const gateService = readFileSync("supportTicketExternalSendProviderGateService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/906_sprint68_ticket_external_delivery_completion_certification.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of ["createSupportTicketExternalProviderDispatcher", "planSupportTicketExternalProviderDispatch", "supports_sandbox", "supports_live_send: false", "external_network_allowed: false", "support_ticket_external_provider_live_dispatch_not_enabled", "network_request_performed: false"]) {
  assert(dispatchService.includes(expected), `dispatch service must include ${expected}`);
}
for (const forbidden of ["nodemailer", "sendMail", "axios", "fetch(", "smtp.connect", "webhook.send"]) {
  assert(!dispatchService.includes(forbidden), `dispatch service must not include external network primitive ${forbidden}`);
}
for (const expected of ["certifySupportTicketExternalDeliveryCompletion", "AM-1", "AM-16", "complete_with_gated_live_dispatch", "live_external_send_enabled: false", "external_send_performed: false"]) {
  assert(completionService.includes(expected), `completion service must include ${expected}`);
}
assert(gateService.includes("evaluateSupportTicketExternalProviderGatePreflight"), "provider gate must keep execution policy preflight");
assert(routes.includes("certifySupportTicketExternalDeliveryCompletion"), "support ticket routes must import completion certification");
assert(routes.includes("/external-delivery/completion-certification"), "support ticket routes must expose completion certification endpoint");
for (const expected of ["support_ticket_external_delivery_completion_certification_policy_v1", "support_ticket_external_delivery_completion_certification_target_rule_v1", "support_ticket_external_delivery_completion_certify", "sandbox", "live_send", "no_external_send"]) {
  assert(migration.includes(expected), `migration 906 must include ${expected}`);
}
assert(runner.includes("906_sprint68_ticket_external_delivery_completion_certification.sql"), "governed migration runner must allowlist migration 906");
assert(manifest.includes("node test-ticket-external-delivery-completion-certification.mjs"), "test manifest must include completion certification test");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 906 must be additive/non-destructive");
assert(!migration.toLowerCase().includes("secret_value"), "migration 906 must not include raw secret-value fields");
assert(!migration.includes("provider_send_enabled"), "migration 906 must not introduce provider_send_enabled flag");
console.log("support ticket external delivery completion certification tests passed");
