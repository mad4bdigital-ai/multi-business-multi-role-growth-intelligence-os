import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const providerGate = readFileSync("supportTicketExternalSendProviderGateService.js", "utf8");
const migration = readFileSync("migrations/1002_sprint68_platform_admin_email_default.sql", "utf8");
const baselineSchema = readFileSync("schema.sql", "utf8");
const hardcodingConfig = JSON.parse(readFileSync("context-kernel-hardcoding-scan.config.json", "utf8"));

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

const sentinelFinding = hardcodingConfig.approved_findings.find((item) => item.path === "http-generic-api/schema.sql" && item.rule_id === "zero_scope_fallback");
assert(sentinelFinding, "hardcoding scanner must explicitly approve the bounded platform-scope sentinel");
assert.equal(sentinelFinding.line, 730, "hardcoding scanner approval must remain line-bound to the baseline sentinel");
assert(sentinelFinding.reason.includes("migrations 909 and 1002"), "sentinel approval must explain the migration dependency");

for (const expected of [
  "external_delivery_recipient_allowlist_registry",
  "allowlist_id",
  "recipient_pattern",
  "approval_hold_id",
  "expires_at",
]) {
  assert(baselineSchema.includes(expected), `baseline schema must include ${expected} before migration 1002`);
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

const allowlistCreateIndex = migration.indexOf("CREATE TABLE IF NOT EXISTS `external_delivery_recipient_allowlist_registry`");
const allowlistInsertIndex = migration.indexOf("INSERT INTO external_delivery_recipient_allowlist_registry");
assert(allowlistCreateIndex >= 0, "migration 1002 must create the allowlist registry idempotently");
assert(allowlistInsertIndex >= 0, "migration 1002 must seed the allowlist registry");
assert(allowlistCreateIndex < allowlistInsertIndex, "migration 1002 must create the allowlist registry before first use");

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
