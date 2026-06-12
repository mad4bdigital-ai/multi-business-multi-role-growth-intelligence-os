import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const providerGate = readFileSync("supportTicketExternalSendProviderGateService.js", "utf8");
const migration = readFileSync("migrations/1002_sprint68_platform_admin_email_default.sql", "utf8");

for (const expected of [
  "resolvePlatformAdminEmail",
  "enrichAdminRecipientPayload",
  "external_delivery.platform_admin_email",
  "support_ticket.platform_admin_email",
  "PLATFORM_ADMIN_EMAIL",
  "SUPPORT_TICKET_ADMIN_EMAIL",
  "recipient_source",
  "official_platform_admin_email",
  "effectivePayloadJson",
]) {
  assert(providerGate.includes(expected), `provider gate must include ${expected}`);
}

for (const expected of [
  "info@mad4b.com",
  "external_delivery_recipient_allowlist_registry",
  "hostinger_smtp_adapter",
  "receive_and_send_admin_notifications",
  "secrets_included",
]) {
  assert(migration.includes(expected), `migration must include ${expected}`);
}

const helperBlock = providerGate.slice(
  providerGate.indexOf("async function resolvePlatformAdminEmail"),
  providerGate.indexOf("async function recipientAllowlistAllowed")
);
assert(!helperBlock.includes("smtp_password"), "admin email default helper must not add SMTP password handling");
assert(!helperBlock.includes("access_token"), "admin email default helper must not add access token handling");
assert(!helperBlock.includes("secret_value"), "admin email default helper must not add secret value handling");
assert(providerGate.includes("recipient_allowlist_allowed: recipientAllowed"), "provider preflight must still enforce recipient allowlist");
assert(providerGate.includes("payload_json: effectivePayloadJson"), "provider plan must use enriched safe payload");

console.log("platform admin email default tests passed");
