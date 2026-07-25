import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyTargetAuthEmailDelivery,
  listAuthEmailDeliveryAttempts,
  normalizeTargetAuthEmailId,
  previewTargetAuthEmailDelivery,
} from "./authEmailTargetedDeliveryWorker.js";

const targetEmailId = "11111111-1111-4111-8111-111111111111";
assert.equal(normalizeTargetAuthEmailId(targetEmailId.toUpperCase()), targetEmailId);
assert.throws(
  () => normalizeTargetAuthEmailId("not-a-uuid"),
  (error) => error?.code === "auth_email_outbox_email_id_invalid" && error?.status === 400,
);

function queuedEmail(emailId) {
  return {
    email_id: emailId,
    purpose: "support_ticket_admin_notification",
    recipient_email: "admin@example.com",
    subject: "New support ticket",
    body_text: "A ticket needs review.",
    body_html: null,
    status: "queued",
    provider: "support_ticket_router",
    metadata_json: JSON.stringify({
      ticket_id: "22222222-2222-4222-8222-222222222222",
      tenant_id: "33333333-3333-4333-8333-333333333333",
      recipient_route_reason: "platform_admin_escalation",
    }),
    resolved_ticket_id: "22222222-2222-4222-8222-222222222222",
    ticket_status: "open",
    ticket_lifecycle_state: "triage_pending",
    ticket_customer_status: "under_review",
    created_at: "2026-07-24T00:00:00.000Z",
  };
}

function createHarness(email) {
  const log = [];
  const connection = {
    async beginTransaction() {
      log.push("begin");
    },
    async commit() {
      log.push("commit");
    },
    async rollback() {
      log.push("rollback");
    },
    release() {
      log.push("release");
    },
    async query(sql, params = []) {
      log.push({ sql, params });
      if (sql.includes("FROM auth_email_outbox e")) return [[email]];
      if (sql.includes("MAX(retry_count)")) return [[{ retry_count: 0 }]];
      if (
        sql.includes("UPDATE auth_email_outbox") &&
        sql.includes("status = 'failed'") &&
        sql.includes("status = 'queued'")
      ) {
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    },
  };
  return {
    log,
    pool: {
      async getConnection() {
        return connection;
      },
      async query(sql, params = []) {
        log.push({ sql, params });
        return [[{
          attempt_id: "55555555-5555-4555-8555-555555555555",
          email_id: targetEmailId,
          status: "sent",
          retry_count: 0,
        }]];
      },
    },
  };
}

const previewHarness = createHarness(queuedEmail(targetEmailId));
const preview = await previewTargetAuthEmailDelivery({
  pool: previewHarness.pool,
  emailId: targetEmailId,
});
assert.equal(preview.send_eligible, true);
assert.equal(preview.external_send_performed, false);
assert.deepEqual(
  previewHarness.log.find(
    (entry) => typeof entry === "object" && entry.sql.includes("FROM auth_email_outbox e"),
  ).params,
  [targetEmailId],
);

const previousFlag = process.env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED;
process.env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED = "true";
try {
  const successHarness = createHarness(queuedEmail(targetEmailId));
  const success = await applyTargetAuthEmailDelivery({
    pool: successHarness.pool,
    emailId: targetEmailId,
    confirm: "SEND_AUTH_EMAIL_OUTBOX",
    resolveSender: async () => ({
      row: { connection_id: "44444444-4444-4444-8444-444444444444" },
      credentials: {},
      secrets_included: false,
    }),
    deliverEmail: async () => {
      successHarness.log.push("provider_send");
      return {
        provider_message_id: "provider-message-1",
        provider_thread_id: "provider-thread-1",
        sender_connection_id: "44444444-4444-4444-8444-444444444444",
        sender_account_label: "sender@example.com",
        secrets_included: false,
      };
    },
  });
  assert.equal(success.ok, true);
  assert.equal(success.delivery_status, "sent");
  assert.equal(success.external_send_performed, true);
  const attemptInsertIndex = successHarness.log.findIndex(
    (entry) => typeof entry === "object" && entry.sql.includes("INSERT INTO auth_email_delivery_attempts"),
  );
  const providerIndex = successHarness.log.indexOf("provider_send");
  const reservationIndex = successHarness.log.findIndex(
    (entry) =>
      typeof entry === "object" &&
      entry.sql.includes("SET status = 'failed'") &&
      entry.sql.includes("status = 'queued'"),
  );
  assert.ok(attemptInsertIndex >= 0 && attemptInsertIndex < providerIndex);
  assert.ok(reservationIndex >= 0 && reservationIndex < providerIndex);
  const sentUpdate = successHarness.log.find(
    (entry) =>
      typeof entry === "object" &&
      entry.sql.includes("SET status = 'sent'") &&
      entry.sql.includes("$.delivery_attempt_id"),
  );
  assert.equal(sentUpdate.params.at(-1), success.attempt_id);

  const unknownEmailId = "66666666-6666-4666-8666-666666666666";
  const unknownHarness = createHarness(queuedEmail(unknownEmailId));
  const unknown = await applyTargetAuthEmailDelivery({
    pool: unknownHarness.pool,
    emailId: unknownEmailId,
    confirm: "SEND_AUTH_EMAIL_OUTBOX",
    resolveSender: async () => ({ row: {}, credentials: {}, secrets_included: false }),
    deliverEmail: async () => {
      unknownHarness.log.push("provider_send");
      const error = new Error("Provider result timed out.");
      error.code = "gmail_timeout";
      throw error;
    },
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.delivery_status, "unknown");
  assert.equal(unknown.error_code, "gmail_delivery_result_unknown");
  assert.equal(unknown.manual_reconciliation_required, true);
  assert.equal(unknown.external_send_performed, null);
  assert.ok(
    unknownHarness.log.find(
      (entry) =>
        typeof entry === "object" &&
        entry.sql.includes("UPDATE auth_email_outbox") &&
        entry.sql.includes("SET status = 'failed'") &&
        entry.sql.includes("$.delivery_attempt_id") &&
        typeof entry.params?.[0] === "string" &&
        entry.params[0].includes('"delivery_state":"delivery_unknown"'),
    ),
  );
} finally {
  if (previousFlag === undefined) delete process.env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED;
  else process.env.AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED = previousFlag;
}

const attemptsHarness = createHarness(queuedEmail(targetEmailId));
const attempts = await listAuthEmailDeliveryAttempts({
  pool: attemptsHarness.pool,
  emailId: targetEmailId,
  limit: 20,
});
assert.equal(attempts.count, 1);
assert.equal(attempts.attempts[0].status, "sent");

const routeSource = readFileSync(
  new URL("./routes/authEmailTargetedDeliveryRoutes.js", import.meta.url),
  "utf8",
);
const indexSource = readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("./migrations/20260724_auth_email_delivery_attempts.sql", import.meta.url),
  "utf8",
);
assert.match(routeSource, /auth-email-outbox\/targeted-dry-run/);
assert.match(routeSource, /auth-email-outbox\/targeted-apply/);
assert.match(routeSource, /auth-email-outbox\/attempts/);
assert.match(indexSource, /buildAuthEmailTargetedDeliveryRoutes/);
assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS `auth_email_delivery_attempts`/);
assert.doesNotMatch(migrationSource, /ALTER TABLE/);
assert.match(migrationSource, /auth_email_outbox_targeted_apply/);

console.log("auth email targeted delivery worker tests passed");
