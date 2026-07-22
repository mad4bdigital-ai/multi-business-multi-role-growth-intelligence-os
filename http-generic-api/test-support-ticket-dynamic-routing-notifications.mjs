import assert from "node:assert/strict";

import {
  buildSupportTicketAdminEmail,
  dedupeRoutingRecipients,
  rankTicketRole,
} from "./supportTicketRoutingNotificationService.js";

assert.ok(rankTicketRole("manager") > rankTicketRole("member"), "manager should outrank member");
assert.ok(rankTicketRole("admin") > rankTicketRole("manager"), "admin should outrank manager");
assert.ok(rankTicketRole("owner") > rankTicketRole("admin"), "owner should outrank admin");
assert.equal(rankTicketRole("unknown_role"), rankTicketRole("member"), "unknown roles should fall back to member rank");

const recipients = dedupeRoutingRecipients([
  { email: "Admin@One.Example", role: "admin", route_reason: "same_tenant_superior" },
  { email: "admin@one.example", role: "owner", route_reason: "platform_admin_escalation" },
  { email: "not-an-email", role: "owner", route_reason: "invalid" },
  { email: "Owner@Two.Example", role: "owner", route_reason: "platform_admin_escalation" },
]);

assert.deepEqual(
  recipients.map((recipient) => recipient.email),
  ["admin@one.example", "owner@two.example"],
  "routing recipients should be normalized and deduped by email",
);
assert.equal(recipients[0].route_reason, "same_tenant_superior");
assert.equal(recipients[0].secrets_included, false);

const email = buildSupportTicketAdminEmail({
  ticket: {
    ticket_id: "ticket_123",
    tenant_id: "tenant_abc",
    title: "Brand-scoped manager invitation required",
    priority: "high",
    severity: "sev3",
    status: "open",
    lifecycle_state: "triage_pending",
    queue_key: "tenant_support",
    user_id: "user_submitter",
  },
  recipient: {
    email: "owner@two.example",
    role: "owner",
    route_reason: "same_tenant_superior",
  },
  event_type: "ticket_created",
});

assert.equal(email.purpose, "support_ticket_admin_notification");
assert.equal(email.provider, "support_ticket_router");
assert.equal(email.secrets_included, false);
assert.match(email.subject, /^\[Support high\] Brand-scoped manager invitation required/);
assert.match(email.body_text, /Ticket: ticket_123/);
assert.match(email.body_text, /Tenant: tenant_abc/);
assert.match(email.body_text, /Recipient route: same_tenant_superior/);
assert.equal(email.body_html, null);

console.log("support ticket dynamic routing notification tests passed");
