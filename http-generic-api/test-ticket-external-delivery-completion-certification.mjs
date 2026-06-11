import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dispatchService = readFileSync("supportTicketExternalProviderDispatchService.js", "utf8");
const liveSendService = readFileSync("supportTicketExternalLiveSendService.js", "utf8");
const completionService = readFileSync("supportTicketExternalDeliveryCompletionService.js", "utf8");
const gateService = readFileSync("supportTicketExternalSendProviderGateService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/906_sprint68_ticket_external_delivery_completion_certification.sql", "utf8");
const dualProviderMigration = readFileSync("migrations/908_sprint68_ticket_external_hostinger_gmail_provider_options.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of [
  "createSupportTicketExternalProviderDispatcher",
  "planSupportTicketExternalProviderDispatch",
  "supports_sandbox",
  "supports_live_send: kind === \"email\"",
  "checkSupportTicketLiveSendReadiness",
  "executeSupportTicketLiveSend",
  "support_ticket_external_provider_live_dispatch_blocked",
  "network_request_performed: false",
]) {
  assert(dispatchService.includes(expected), `dispatch service must include ${expected}`);
}
for (const expected of [
  "SMTP_URL",
  "SUPPORT_TICKET_LIVE_SEND_ALLOWLIST",
  "EXTERNAL_DELIVERY_LIVE_SEND_ALLOWLIST",
  "recipient_not_allowlisted",
  "approval_hold_required",
  "credential_ref_required",
  "idempotency_key_required",
  "external_send_performed: true",
  "secret_value_included: false",
  "smtps://",
  "HOSTINGER_SMTP_URL",
  "gmail_user_oauth_adapter",
  "https://www.googleapis.com/auth/gmail.send",
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  "gmail_user_oauth_connection_ref_required",
  "support_ticket_live_gmail_send_failed",
]) {
  assert(liveSendService.includes(expected), `live send service must include ${expected}`);
}
for (const forbidden of ["nodemailer", "sendMail", "axios", "webhook.send"]) {
  assert(!liveSendService.includes(forbidden), `live send service must not include unsupported primitive ${forbidden}`);
}
for (const expected of ["certifySupportTicketExternalDeliveryCompletion", "AM-1", "AM-16", "complete_with_gated_live_dispatch", "live_external_send_enabled: false", "external_send_performed: false"]) {
  assert(completionService.includes(expected), `completion service must include ${expected}`);
}
assert(gateService.includes("evaluateSupportTicketExternalProviderGatePreflight"), "provider gate must keep execution policy preflight");
assert(gateService.includes("runMode === \"live_send\""), "provider gate attempt must support explicit live_send mode");
assert(gateService.includes("createSupportTicketExternalProviderDispatcher"), "provider gate attempt must call the live provider dispatcher only after gates pass");
assert(gateService.includes("external_send_provider_dispatch_succeeded"), "provider gate attempt must record successful live dispatch events");
assert(gateService.includes("idempotent_replay_not_resent"), "provider gate attempt must avoid duplicate sends for the same idempotency key");
assert(gateService.includes("support_ticket_external_send_provider_dispatch_requires_live_send_mode"), "ready provider dispatch must require explicit live_send mode");
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
