import assert from "node:assert/strict";

import {
  buildAuthEmailOutboxWorkerReadiness,
  buildMimeMessage,
  compactEmailOutboxRow,
  encodeGmailRawMessage,
  evaluateAuthEmailOutboxSendEligibility,
  normalizePurposeList,
  resolveAuthEmailOutboxRuntimeDeliveryGate,
} from "./authEmailOutboxWorker.js";

assert.deepEqual(
  normalizePurposeList("support_ticket_admin_notification support_ticket_admin_notification"),
  ["support_ticket_admin_notification"],
  "purpose list should be normalized and deduped",
);
assert.deepEqual(
  normalizePurposeList("bad value with spaces?"),
  ["bad", "value", "with"],
  "invalid purpose tokens should be dropped",
);

const dryReadiness = buildAuthEmailOutboxWorkerReadiness({
  env: {},
  apply: false,
});
assert.equal(dryReadiness.ready, true, "dry-run should be allowed when delivery flag is disabled");
assert.equal(dryReadiness.delivery_feature_flag_enabled, false);
assert.equal(dryReadiness.secrets_included, false);

const blockedReadiness = buildAuthEmailOutboxWorkerReadiness({
  env: {},
  apply: true,
  confirm: "",
});
assert.equal(blockedReadiness.ready, false, "apply should be blocked without feature flag and confirmation");
assert.ok(blockedReadiness.reasons.includes("auth_email_outbox_delivery_feature_flag_disabled"));
assert.ok(blockedReadiness.reasons.includes("auth_email_outbox_send_confirmation_required"));

const ready = buildAuthEmailOutboxWorkerReadiness({
  env: { AUTH_EMAIL_OUTBOX_DELIVERY_ENABLED: "true" },
  apply: true,
  confirm: "SEND_AUTH_EMAIL_OUTBOX",
});
assert.equal(ready.ready, true, "apply should be ready with feature flag and typed confirmation");

const sqlGateReadiness = buildAuthEmailOutboxWorkerReadiness({
  env: {},
  apply: true,
  confirm: "SEND_AUTH_EMAIL_OUTBOX",
  runtimeGateEnabled: true,
});
assert.equal(sqlGateReadiness.ready, true, "a validated SQL runtime gate should enable one bounded apply pass");
assert.equal(sqlGateReadiness.delivery_feature_flag_enabled, false);
assert.equal(sqlGateReadiness.runtime_delivery_gate_enabled, true);
assert.equal(sqlGateReadiness.delivery_enabled, true);

const runtimeGate = await resolveAuthEmailOutboxRuntimeDeliveryGate({
  pool: {
    async query() {
      return [[{
        status: "active",
        config_json: JSON.stringify({
          enabled: true,
          purposes: ["support_ticket_admin_notification"],
          max_messages: 2,
          allowed_email_ids: ["email_1", "email_2"],
          expected_confirm: "SEND_AUTH_EMAIL_OUTBOX",
          expires_at: "2026-07-25T01:00:00.000Z",
        }),
      }]];
    },
  },
  purposes: ["support_ticket_admin_notification"],
  limit: 2,
  now: new Date("2026-07-25T00:00:00.000Z"),
});
assert.equal(runtimeGate.enabled, true);
assert.deepEqual(runtimeGate.allowed_email_ids, ["email_1", "email_2"]);
assert.equal(runtimeGate.allowed_email_count, 2);
assert.equal(runtimeGate.max_messages, 2);
assert.deepEqual(runtimeGate.reasons, []);

const expiredRuntimeGate = await resolveAuthEmailOutboxRuntimeDeliveryGate({
  pool: {
    async query() {
      return [[{
        status: "active",
        config_json: JSON.stringify({
          enabled: true,
          purposes: ["support_ticket_admin_notification"],
          max_messages: 2,
          allowed_email_ids: ["email_1", "email_2"],
          expected_confirm: "SEND_AUTH_EMAIL_OUTBOX",
          expires_at: "2026-07-24T23:59:59.000Z",
        }),
      }]];
    },
  },
  purposes: ["support_ticket_admin_notification"],
  limit: 2,
  now: new Date("2026-07-25T00:00:00.000Z"),
});
assert.equal(expiredRuntimeGate.enabled, false);
assert.ok(expiredRuntimeGate.reasons.includes("auth_email_outbox_runtime_gate_expired"));

const mismatchedRuntimeGate = await resolveAuthEmailOutboxRuntimeDeliveryGate({
  pool: {
    async query() {
      return [[{
        status: "active",
        config_json: JSON.stringify({
          enabled: true,
          purposes: ["support_ticket_admin_notification"],
          max_messages: 1,
          allowed_email_ids: ["email_1"],
          expected_confirm: "WRONG_CONFIRMATION",
          expires_at: "2026-07-25T01:00:00.000Z",
        }),
      }]];
    },
  },
  purposes: ["support_ticket_admin_notification"],
  limit: 2,
  now: new Date("2026-07-25T00:00:00.000Z"),
});
assert.equal(mismatchedRuntimeGate.enabled, false);
assert.ok(mismatchedRuntimeGate.reasons.includes("auth_email_outbox_runtime_gate_limit_exceeded"));
assert.ok(mismatchedRuntimeGate.reasons.includes("auth_email_outbox_runtime_gate_email_scope_invalid"));
assert.ok(mismatchedRuntimeGate.reasons.includes("auth_email_outbox_runtime_gate_confirmation_mismatch"));

const mime = buildMimeMessage({
  from: "sender@example.com",
  to: "Admin@Example.com",
  subject: "Ticket\nNotification",
  bodyText: "A ticket requires review.",
});
assert.match(mime, /To: admin@example.com/);
assert.match(mime, /From: sender@example.com/);
assert.match(mime, /Subject: Ticket Notification/);
assert.match(mime, /Content-Type: text\/plain/);
assert.match(mime, /A ticket requires review\./);
assert.doesNotMatch(mime, /Ticket\nNotification/);

const raw = encodeGmailRawMessage(mime);
assert.equal(typeof raw, "string");
assert.ok(raw.length > 10);
assert.doesNotMatch(raw, /[+/=]/, "Gmail raw message should use base64url form");

assert.throws(
  () => buildMimeMessage({ to: "not-an-email", subject: "Bad", bodyText: "Bad" }),
  /Recipient email is invalid/,
);

const compact = compactEmailOutboxRow({
  email_id: "email_123",
  purpose: "support_ticket_admin_notification",
  recipient_email: "admin@example.com",
  subject: "Subject",
  status: "queued",
  provider: "support_ticket_router",
  metadata_json: JSON.stringify({
    ticket_id: "ticket_123",
    tenant_id: "tenant_123",
    event_type: "ticket_created",
    recipient_route_reason: "platform_admin_escalation",
    secrets_included: false,
  }),
  created_at: "2026-07-22T00:00:00.000Z",
});
assert.deepEqual(compact, {
  email_id: "email_123",
  purpose: "support_ticket_admin_notification",
  recipient_email: "admin@example.com",
  subject: "Subject",
  status: "queued",
  provider: "support_ticket_router",
  ticket_id: "ticket_123",
  tenant_id: "tenant_123",
  event_type: "ticket_created",
  recipient_route_reason: "platform_admin_escalation",
  send_eligible: false,
  skip_reason: "ticket_not_found",
  created_at: "2026-07-22T00:00:00.000Z",
  secrets_included: false,
});

assert.deepEqual(
  evaluateAuthEmailOutboxSendEligibility({
    metadata_json: JSON.stringify({ smoke_test: true, ticket_id: "ticket_123" }),
  }),
  { eligible: false, reason: "smoke_test_notification" },
  "smoke-test notifications must never be sent",
);
assert.deepEqual(
  evaluateAuthEmailOutboxSendEligibility({
    metadata_json: JSON.stringify({ ticket_id: "ticket_123" }),
    resolved_ticket_id: "ticket_123",
    ticket_status: "closed",
    ticket_lifecycle_state: "resolved",
    ticket_customer_status: "resolved",
  }),
  { eligible: false, reason: "ticket_not_open" },
  "closed or resolved ticket notifications must be skipped",
);
assert.deepEqual(
  evaluateAuthEmailOutboxSendEligibility({
    metadata_json: JSON.stringify({ ticket_id: "ticket_123" }),
    resolved_ticket_id: "ticket_123",
    ticket_status: "open",
    ticket_lifecycle_state: "triage_pending",
    ticket_customer_status: "under_review",
  }),
  { eligible: true, reason: null },
  "open ticket notifications should remain eligible",
);

await import("./test-auth-email-outbox-attempt-ledger.mjs");

console.log("auth email outbox worker tests passed");
