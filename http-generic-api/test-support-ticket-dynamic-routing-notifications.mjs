import assert from "node:assert/strict";

import {
  buildSupportTicketAdminEmail,
  dedupeRoutingRecipients,
  rankTicketRole,
  resolveSupportTicketRoutingRecipients,
} from "./supportTicketRoutingNotificationService.js";

assert.ok(rankTicketRole("manager") > rankTicketRole("member"), "manager should outrank member");
assert.ok(rankTicketRole("admin") > rankTicketRole("manager"), "admin should outrank manager");
assert.ok(rankTicketRole("owner") > rankTicketRole("admin"), "owner should outrank admin");
assert.equal(rankTicketRole("unknown_role"), rankTicketRole("member"), "unknown roles should fall back to member rank");

const recipients = dedupeRoutingRecipients([
  { email: "Admin@One.Example", role: "admin", route_reason: "same_tenant_admin_owner" },
  { email: "admin@one.example", role: "owner", route_reason: "platform_admin_escalation" },
  { email: "not-an-email", role: "owner", route_reason: "invalid" },
  { email: "Owner@Two.Example", role: "owner", route_reason: "platform_admin_escalation" },
]);

assert.deepEqual(
  recipients.map((recipient) => recipient.email),
  ["admin@one.example", "owner@two.example"],
  "routing recipients should be normalized and deduped by email",
);
assert.equal(recipients[0].route_reason, "same_tenant_admin_owner");
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
    route_reason: "same_tenant_admin_owner",
  },
  event_type: "ticket_created",
});

assert.equal(email.purpose, "support_ticket_admin_notification");
assert.equal(email.provider, "support_ticket_router");
assert.equal(email.secrets_included, false);
assert.match(email.subject, /^\[Support high\] Brand-scoped manager invitation required/);
assert.match(email.body_text, /Ticket: ticket_123/);
assert.match(email.body_text, /Tenant: tenant_abc/);
assert.match(email.body_text, /Recipient route: same_tenant_admin_owner/);
assert.equal(email.body_html, null);

// Same-tenant delivery is owner/admin-only; platform escalation remains a separate route class.
const observedSql = [];
const connection = {
  async query(sql) {
    observedSql.push(sql);
    if (sql.includes("m.user_id = ?") && sql.includes("LIMIT 1")) {
      return [[{ user_id: "user_submitter", tenant_id: "tenant_abc", role: "member" }]];
    }
    if (sql.includes("m.role IN ('owner','admin')")) {
      return [[
        {
          user_id: "tenant_owner",
          tenant_id: "tenant_abc",
          role: "owner",
          email: "owner@tenant.example",
          display_name: "Tenant Owner",
          tenant_display_name: "Tenant Example",
        },
        {
          user_id: "tenant_admin",
          tenant_id: "tenant_abc",
          role: "admin",
          email: "admin@tenant.example",
          display_name: "Tenant Admin",
          tenant_display_name: "Tenant Example",
        },
      ]];
    }
    if (sql.includes("m.role IN ('platform_owner','owner','admin')")) {
      return [[{
        user_id: "platform_admin",
        tenant_id: "00000000-0000-0000-0000-000000000000",
        role: "admin",
        email: "platform-admin@example.com",
        display_name: "Platform Admin",
        tenant_display_name: "Platform",
      }]];
    }
    throw new Error(`Unexpected SQL in routing test: ${sql}`);
  },
};

const routing = await resolveSupportTicketRoutingRecipients({
  ticket_id: "ticket_123",
  tenant_id: "tenant_abc",
  user_id: "user_submitter",
}, { connection });

assert.ok(
  observedSql.some((sql) => sql.includes("m.role IN ('owner','admin')")),
  "same-tenant recipient query must restrict roles to owner and admin",
);
assert.deepEqual(
  routing.recipients.map(({ role }) => role),
  ["owner", "admin", "admin"],
);
assert.deepEqual(
  routing.recipients.map(({ route_reason }) => route_reason),
  ["same_tenant_admin_owner", "same_tenant_admin_owner", "platform_admin_escalation"],
);
assert.equal(routing.sources.same_tenant_admin_owner_count, 2);
assert.equal(routing.sources.same_tenant_superior_count, 2);
assert.equal(routing.sources.platform_admin_count, 1);
assert.equal(routing.routing_version, "support-ticket-routing-notification-v2");

console.log("support ticket dynamic routing notification tests passed");
