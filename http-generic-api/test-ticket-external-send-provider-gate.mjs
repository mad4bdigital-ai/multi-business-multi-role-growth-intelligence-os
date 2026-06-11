import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalSendProviderGateService.js", "utf8");
const contractService = readFileSync("supportTicketExternalProviderContractService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration262 = readFileSync("migrations/262_sprint68_ticket_external_send_provider_gate.sql", "utf8");
const migration272 = readFileSync("migrations/272_sprint68_ticket_external_provider_gate_registry_resolver.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "planSupportTicketExternalSendProviderGate",
  "recordSupportTicketExternalSendProviderGateAttempt",
  "resolveSupportTicketExternalProviderAdapterContract",
  "external_send_provider_dispatch_not_enabled",
  "external_send_provider_adapter_dispatch_not_enabled",
  "external_send_provider_adapter_not_implemented",
  "external_send_provider_mode_invalid",
  "provider_dispatch_blocked_not_sent",
  "external_send_provider_gate_recorded",
  "provider_adapter_implemented: providerAdapterImplemented",
  "external_send_supported: Boolean(safety.external_send_supported && adapter.dispatch_enabled && adapter.provider_dispatch_enabled)",
  "external_send_performed: false",
  "secret_value_included: false",
]) {
  assert(service.includes(expected), `external send provider gate service must include ${expected}`);
}

for (const expected of [
  "resolveSupportTicketExternalProviderAdapterContract",
  "defaultExternalAdapterKeyForChannel",
  "smtp_email_adapter",
  "generic_webhook_adapter",
  "external_delivery_provider_adapter_contract_registry",
  "external_delivery_provider_send_mode_policy_registry",
  "send_mode_allowed",
  "secret_value_included: false",
]) {
  assert(contractService.includes(expected), `provider contract service must include ${expected}`);
}

for (const forbidden of [
  "PROVIDER_DISPATCH_ENABLED",
  "SUPPORT_TICKET_EXTERNAL_SEND_PROVIDER_DISPATCH_ENABLED",
  "function providerAdapterFor",
  "email_provider_adapter",
  "webhook_provider_adapter",
  "sendMail",
  "nodemailer",
  "fetch(",
  "axios",
  "webhook.send",
  "delivery_status: \"sent\"",
  "provider_adapter_implemented: true",
]) {
  assert(!service.includes(forbidden), `provider gate must not retain hard-coded dispatch or real send surface: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalSendProviderGateService.js"), "routes must import external send provider gate service");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-send/provider-gate-plan'), "routes must expose provider gate plan endpoint");
assert(routes.includes('/admin/support/tickets/:ticket_id/external-send/provider-gate-attempt'), "routes must expose provider gate attempt endpoint");
assert(routes.includes("planSupportTicketExternalSendProviderGate"), "routes must call provider gate plan service");
assert(routes.includes("recordSupportTicketExternalSendProviderGateAttempt"), "routes must call provider gate attempt service");

for (const expectedTool of ["support_ticket_external_send_provider_gate_plan", "support_ticket_external_send_provider_gate_attempt"]) {
  assert(migration262.includes(expectedTool), `migration 262 must register ${expectedTool}`);
}
assert(migration262.includes("does not perform external email/webhook delivery"), "migration 262 must document no external send");
assert(migration272.includes("external_provider_gate_registry_resolver_policy_v1"), "migration 272 must seed registry resolver policy");
assert(migration272.includes("external_delivery_provider_adapter_contract_registry"), "migration 272 must reference adapter contract registry");
assert(migration272.includes("external_delivery_provider_send_mode_policy_registry"), "migration 272 must reference send mode policy registry");
assert(migration272.includes("smtp_email_adapter"), "migration 272 must document smtp adapter as default email registry key");
assert(migration272.includes("generic_webhook_adapter"), "migration 272 must document generic webhook adapter as default webhook registry key");
assert(migration272.includes("JSON_ARRAY('dry_run','record_only','provider_send_blocked')"), "migration 272 must allow only blocked/read-only send modes");
assert(migration272.includes("'legacy_provider_send_mode_allowed', false"), "migration 272 must forbid legacy provider_send enablement");
assert(!migration272.includes("provider_send_enabled"), "migration 272 must not introduce provider_send_enabled");
assert(runner.includes("272_sprint68_ticket_external_provider_gate_registry_resolver.sql"), "runner must allowlist migration 272");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration272), "migration 272 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration272.toLowerCase().includes(secret), `migration 272 must not contain secret-like field ${secret}`);
}

console.log("ticket external send provider gate registry resolver tests passed");
