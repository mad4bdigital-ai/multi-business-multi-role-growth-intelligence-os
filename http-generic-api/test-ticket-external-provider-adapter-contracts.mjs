import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalProviderContractService.js", "utf8");
const routes = readFileSync("routes/supportTicketRoutes.js", "utf8");
const migration = readFileSync("migrations/265_sprint68_ticket_external_provider_adapter_contracts.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "listSupportTicketExternalProviderContracts",
  "external_delivery_provider_family_registry",
  "external_delivery_provider_adapter_contract_registry",
  "external_delivery_provider_send_mode_policy_registry",
  "external_send_performed: false",
  "secret_value_included: false",
]) {
  assert(service.includes(expected), `provider contract service must include ${expected}`);
}

for (const expected of [
  "email_delivery",
  "webhook_delivery",
  "messaging_delivery",
  "ads_provider",
  "smtp_email_adapter",
  "sendgrid_email_adapter",
  "generic_webhook_adapter",
  "signed_webhook_adapter",
  "hmac_webhook_adapter",
  "provider_send_blocked",
  "provider_dispatch_enabled', false",
  "adapter_implemented', false",
  "external_send_supported', false",
  "external_send_performed', false",
]) {
  assert(migration.includes(expected), `provider contract migration must include ${expected}`);
}

for (const forbidden of ["sendMail", "nodemailer", "fetch(", "axios", "webhook.send", "external_send_performed: true", "external_send_performed', true", "provider_dispatch_enabled', true", "adapter_implemented', true"]) {
  assert(!service.includes(forbidden), `provider contract service must not send externally: ${forbidden}`);
  assert(!migration.includes(forbidden), `provider contract migration must not enable external send: ${forbidden}`);
}

assert(routes.includes("supportTicketExternalProviderContractService.js"), "routes must import provider contract service");
assert(routes.includes('/admin/support/tickets/external-send/provider-contracts'), "routes must expose provider contracts endpoint");
assert(routes.includes("listSupportTicketExternalProviderContracts"), "routes must call provider contract readback service");
assert(migration.includes("support_ticket_external_provider_contracts"), "migration must register provider contracts tool");
assert(migration.includes("external_provider_adapter_contract_policy_v1"), "migration must seed execution policy");
assert(runner.includes("265_sprint68_ticket_external_provider_adapter_contracts.sql"), "runner must allowlist migration 265");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 265 must be additive/non-destructive");

for (const secret of ["password", "access_token", "refresh_token", "client_secret"]) {
  assert(!migration.toLowerCase().includes(secret), `migration must not contain secret-like field ${secret}`);
}

console.log("ticket external provider adapter contract tests passed");
