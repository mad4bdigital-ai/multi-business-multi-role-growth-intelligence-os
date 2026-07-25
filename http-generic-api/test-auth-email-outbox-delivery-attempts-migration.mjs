import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/20260725_auth_email_outbox_delivery_attempts.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("./authEmailOutboxWorker.js", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./authEmailOutboxAttemptLedger.js", import.meta.url), "utf8");

assert.match(migration, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+auth_email_outbox_delivery_attempts/i, "migration must create the delivery-attempt ledger table");
for (const column of [
  "attempt_id",
  "email_id",
  "attempt_number",
  "idempotency_key",
  "recipient_email",
  "provider",
  "status",
  "retry_count",
  "sender_connection_id",
  "provider_message_id",
  "provider_thread_id",
  "error_code",
  "error_message",
  "lifecycle_event_id",
  "started_at",
  "completed_at",
  "sent_at",
]) {
  assert.match(migration, new RegExp(`\\b${column}\\b`, "i"), `migration must include ${column}`);
}
assert.match(migration, /UNIQUE\s+KEY\s+uq_auth_email_attempts_idempotency/i, "idempotency key must be unique");
assert.match(migration, /UNIQUE\s+KEY\s+uq_auth_email_attempts_email_number/i, "attempt number must be unique per email");
assert.match(migration, /ENUM\('started','sent','failed','abandoned','dead_lettered'\)/i, "status enum must match ledger terminal statuses");
assert.match(ledger, /auth_email_outbox_delivery_attempts/, "ledger service must target the table");
assert.match(ledger, /attempt_number/, "ledger service must use attempt_number");
assert.match(ledger, /idempotency_key/, "ledger service must use idempotency_key");
assert.match(worker, /requireAuthEmailOutboxAttemptLedger/, "worker must require ledger before apply delivery");
assert.match(worker, /claimAuthEmailOutboxDeliveryAttempt/, "worker must claim attempts before Gmail delivery");
assert.match(worker, /updateAuthEmailOutboxDeliveryAttempt/, "worker must finalize attempts after delivery result");
assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/im, "migration must be additive schema only");

console.log("auth email outbox delivery attempts migration test passed");
