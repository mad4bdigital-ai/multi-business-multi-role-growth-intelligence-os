import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dispatcher = readFileSync("webhookDeliveryDispatcher.js", "utf8");
const credentialRoutes = readFileSync("routes/credentialIntakeRoutes.js", "utf8");
const migration = readFileSync("migrations/206_sprint66_credential_intake_webhook_outbox.sql", "utf8");
const adminCliRoutes = readFileSync("routes/adminCliRoutes.js", "utf8");
const script = readFileSync("scripts/webhook-delivery-dispatcher.mjs", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

assert(dispatcher.includes('credential_intake.completed'), "dispatcher must emit credential_intake.completed events");
assert(dispatcher.includes('buildCredentialIntakeCompletedPayload'), "dispatcher must build a safe completion payload");
assert(dispatcher.includes('secrets_included: false'), "webhook payloads must declare no secrets");
assert(dispatcher.includes('webhook_safe_event'), "payload must include webhook_safe_event metadata");
assert(dispatcher.includes('next_tools'), "payload must include next tools for automation");
assert(dispatcher.includes('assertWebhookTargetAllowed'), "dispatcher must validate webhook targets");
assert(dispatcher.includes('parsed.protocol !== "https:"'), "dispatcher must require https webhook URLs");
assert(dispatcher.includes('isBlockedIp'), "dispatcher must block private/local webhook targets");
assert(dispatcher.includes('AbortSignal.timeout'), "dispatcher must bound webhook delivery time");
assert(dispatcher.includes('X-MAD4B-Delivery'), "dispatcher must include delivery id header");
assert(!dispatcher.includes('encrypted_credentials'), "dispatcher must not read encrypted credentials");
assert(!dispatcher.includes('ssh_password'), "dispatcher must not include SSH password in webhook payloads");
assert(!dispatcher.includes('ssh_private_key'), "dispatcher must not include SSH private key in webhook payloads");

assert(credentialRoutes.includes('enqueueCredentialIntakeCompletedWebhook'), "credential intake route must enqueue webhook completion events");
assert(credentialRoutes.includes('credential_intake.webhook_enqueue_failed'), "enqueue failure must be audited without blocking intake completion");

assert(migration.includes('CREATE TABLE IF NOT EXISTS webhook_deliveries'), "migration must create webhook_deliveries outbox table");
assert(migration.includes("ENUM('queued','delivered','failed','skipped')"), "delivery status enum must be bounded");
assert(migration.includes('webhook_delivery_dispatch'), "migration must register admin dispatcher tool");
assert(migration.includes('INSERT INTO admin_platform_endpoint_tools'), "migration must register dispatcher in the live admin_platform_endpoint_tools table");
assert(!migration.includes('admin_tool_registry'), "migration must not reference legacy/nonexistent admin_tool_registry table");
assert(migration.includes('no_secrets') && migration.includes('ssrf_guard'), "dispatcher registry tags must include no_secrets and ssrf_guard");
assert(runner.includes('"206_sprint66_credential_intake_webhook_outbox.sql"'), "governed runner must allow migration 206");

assert(adminCliRoutes.includes('webhook_delivery_dispatch'), "admin shell allowlist must include webhook dispatcher alias");
assert(adminCliRoutes.includes('scripts/webhook-delivery-dispatcher.mjs'), "webhook dispatcher alias must point to the script");
assert(script.includes('dispatchPendingWebhookDeliveries'), "dispatcher script must call governed delivery service");
assert(script.includes('secrets_included: false'), "dispatcher script failure output must declare no secrets");

console.log("Credential intake webhook outbox guard passed");
