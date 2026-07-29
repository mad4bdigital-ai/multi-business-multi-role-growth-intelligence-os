import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildAuthEmailOutboxAttemptIdempotencyKey,
  claimAuthEmailOutboxDeliveryAttempt,
  isAuthEmailOutboxAttemptClaimConflict,
  updateAuthEmailOutboxDeliveryAttempt,
} from "./authEmailOutboxAttemptLedger.js";

const migration = fs.readFileSync(
  new URL("./migrations/20260723_auth_email_outbox_delivery_attempts.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS `auth_email_outbox_delivery_attempts`/);
assert.match(migration, /UNIQUE KEY `uq_auth_email_outbox_attempt_number`/);
assert.match(migration, /UNIQUE KEY `uq_auth_email_outbox_attempt_idempotency`/);
assert.match(migration, /UNIQUE KEY `uq_auth_email_outbox_active_claim`/);
assert.match(migration, /GENERATED ALWAYS AS/);
assert.match(migration, /provider_message_id/);
assert.match(migration, /lifecycle_event_id/);
assert.match(migration, /retry_count/);

assert.equal(
  buildAuthEmailOutboxAttemptIdempotencyKey("email_123", 2),
  "email_123:gmail_api:2",
);
assert.throws(
  () => buildAuthEmailOutboxAttemptIdempotencyKey("", 1),
  /Email id is required/,
);

const calls = [];
const connection = {
  async beginTransaction() { calls.push({ type: "begin" }); },
  async commit() { calls.push({ type: "commit" }); },
  async rollback() { calls.push({ type: "rollback" }); },
  release() { calls.push({ type: "release" }); },
  async query(sql, params = []) {
    calls.push({ type: "query", sql, params });
    if (sql.includes("SELECT COALESCE(MAX(attempt_number)")) {
      return [[{ next_attempt_number: 2 }]];
    }
    return [{ affectedRows: 1 }];
  },
};
const pool = { async getConnection() { return connection; } };
const claim = await claimAuthEmailOutboxDeliveryAttempt({
  pool,
  email: { email_id: "email_123", recipient_email: "admin@example.com" },
  attemptId: "attempt_123",
});
assert.deepEqual(claim, {
  attempt_id: "attempt_123",
  attempt_number: 2,
  idempotency_key: "email_123:gmail_api:2",
  status: "started",
  provider: "gmail_api",
  secrets_included: false,
});
assert.ok(calls.some((entry) => entry.type === "commit"));
assert.ok(calls.some((entry) => entry.sql?.includes("INSERT INTO auth_email_outbox_delivery_attempts")));

await updateAuthEmailOutboxDeliveryAttempt(connection, {
  attemptId: "attempt_123",
  status: "sent",
  senderConnectionId: "connection_123",
  providerMessageId: "message_123",
  providerThreadId: "thread_123",
  lifecycleEventId: "event_123",
});
assert.ok(calls.some((entry) => entry.sql?.includes("UPDATE auth_email_outbox_delivery_attempts")));

const duplicateConnection = {
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {},
  async query(sql) {
    if (sql.includes("SELECT COALESCE(MAX(attempt_number)")) return [[{ next_attempt_number: 1 }]];
    const error = new Error("duplicate");
    error.code = "ER_DUP_ENTRY";
    throw error;
  },
};
await assert.rejects(
  claimAuthEmailOutboxDeliveryAttempt({
    pool: { async getConnection() { return duplicateConnection; } },
    email: { email_id: "email_123", recipient_email: "admin@example.com" },
    attemptId: "attempt_duplicate",
  }),
  (error) => isAuthEmailOutboxAttemptClaimConflict(error),
);

console.log("auth email outbox attempt ledger tests passed");
