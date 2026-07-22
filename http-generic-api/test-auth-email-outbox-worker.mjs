import assert from "node:assert/strict";

import {
  buildAuthEmailOutboxWorkerReadiness,
  buildMimeMessage,
  compactEmailOutboxRow,
  encodeGmailRawMessage,
  normalizePurposeList,
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
  created_at: "2026-07-22T00:00:00.000Z",
  secrets_included: false,
});

console.log("auth email outbox worker tests passed");
