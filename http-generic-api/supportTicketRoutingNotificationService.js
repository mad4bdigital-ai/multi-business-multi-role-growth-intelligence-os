import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const EMAIL_PURPOSE = "support_ticket_admin_notification";
const ROUTING_VERSION = "support-ticket-routing-notification-v2";
const MAX_RECIPIENTS = 20;

const ROLE_RANKS = new Map([
  ["viewer", 10],
  ["member", 20],
  ["operator", 40],
  ["manager", 60],
  ["admin", 80],
  ["owner", 90],
  ["platform_owner", 100],
]);

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeString(value, fallback = "") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function normalizeEmail(value) {
  const email = normalizeString(value).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function rankTicketRole(role) {
  const key = normalizeString(role, "member").toLowerCase();
  return ROLE_RANKS.get(key) ?? ROLE_RANKS.get("member");
}

function compactRecipient(row = {}, route_reason = "platform_admin_escalation") {
  const email = normalizeEmail(row.email);
  if (!email) return null;
  return {
    user_id: row.user_id || null,
    email,
    display_name: row.display_name || null,
    role: row.role || null,
    tenant_id: row.tenant_id || null,
    tenant_display_name: row.tenant_display_name || null,
    route_reason,
    role_rank: rankTicketRole(row.role),
    secrets_included: false,
  };
}

export function dedupeRoutingRecipients(recipients = []) {
  const seen = new Set();
  const deduped = [];
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient?.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    deduped.push({ ...recipient, email, secrets_included: false });
    if (deduped.length >= MAX_RECIPIENTS) break;
  }
  return deduped;
}

async function fetchSubmitterMembership(connection, ticket = {}) {
  if (!ticket.tenant_id || !ticket.user_id) return null;
  const [rows] = await connection.query(
    `SELECT m.user_id, m.tenant_id, m.role, u.email, u.display_name
       FROM memberships m
       LEFT JOIN users u ON u.user_id = m.user_id
      WHERE m.tenant_id = ?
        AND m.user_id = ?
        AND m.status = 'active'
      LIMIT 1`,
    [ticket.tenant_id, ticket.user_id]
  );
  return rows[0] || null;
}

async function fetchSameTenantAdminOwners(connection, ticket = {}) {
  if (!ticket.tenant_id) return [];
  const [rows] = await connection.query(
    `SELECT m.user_id, m.tenant_id, m.role, u.email, u.display_name, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN users u ON u.user_id = m.user_id AND u.status = 'active'
       LEFT JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.tenant_id = ?
        AND m.status = 'active'
        AND m.role IN ('owner','admin')
        AND (m.user_id <> ? OR ? IS NULL)
      ORDER BY FIELD(m.role, 'owner','admin'), m.granted_at ASC`,
    [ticket.tenant_id, ticket.user_id || null, ticket.user_id || null]
  );
  return rows
    .map((row) => compactRecipient(row, "same_tenant_admin_owner"))
    .filter(Boolean);
}

async function fetchPlatformAdmins(connection, ticket = {}) {
  const [rows] = await connection.query(
    `SELECT DISTINCT m.user_id, m.tenant_id, m.role, u.email, u.display_name, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN users u ON u.user_id = m.user_id AND u.status = 'active'
       LEFT JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.status = 'active'
        AND (m.user_id <> ? OR ? IS NULL)
        AND m.role IN ('platform_owner','owner','admin')
        AND (
             m.role = 'platform_owner'
          OR m.tenant_id IN ('00000000-0000-0000-0000-000000000000','00000000-0000-4000-a000-000000000001')
          OR LOWER(COALESCE(t.display_name, '')) LIKE '%platform%'
        )
      ORDER BY FIELD(m.role, 'platform_owner','owner','admin'), m.granted_at ASC
      LIMIT ?`,
    [ticket.user_id || null, ticket.user_id || null, MAX_RECIPIENTS]
  );
  return rows.map((row) => compactRecipient(row, "platform_admin_escalation")).filter(Boolean);
}

export async function resolveSupportTicketRoutingRecipients(ticket = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const metadata = parseJsonObject(ticket.metadata_json, {});
    const submitterMembership = await fetchSubmitterMembership(connection, ticket);
    const submitterRole = submitterMembership?.role || metadata?.role_at_creation || metadata?.authority?.role_at_creation || "member";
    const sameTenantAdminOwners = await fetchSameTenantAdminOwners(connection, ticket);
    const platformAdmins = await fetchPlatformAdmins(connection, ticket);
    const recipients = dedupeRoutingRecipients([...sameTenantAdminOwners, ...platformAdmins]);
    return {
      ok: true,
      routing_version: ROUTING_VERSION,
      submitter_role: submitterRole,
      recipient_count: recipients.length,
      recipients,
      sources: {
        same_tenant_superior_count: sameTenantAdminOwners.length,
        same_tenant_admin_owner_count: sameTenantAdminOwners.length,
        platform_admin_count: platformAdmins.length,
      },
      secrets_included: false,
    };
  } finally {
    if (ownsConnection) connection.release();
  }
}

export function buildSupportTicketAdminEmail({ ticket = {}, recipient = {}, event_type = "ticket_created", deduped = false } = {}) {
  const priority = ticket.priority || "normal";
  const tenantId = ticket.tenant_id || "unknown";
  const title = ticket.title || "Support ticket";
  const subject = `[Support ${priority}] ${title}`.slice(0, 255);
  const bodyLines = [
    `A support ticket requires review.`,
    ``,
    `Ticket: ${ticket.ticket_id || "unknown"}`,
    `Tenant: ${tenantId}`,
    `Title: ${title}`,
    `Priority: ${priority}`,
    `Severity: ${ticket.severity || "unknown"}`,
    `Status: ${ticket.status || "open"}`,
    `Lifecycle: ${ticket.lifecycle_state || "unknown"}`,
    `Queue: ${ticket.queue_key || "tenant_support"}`,
    `Raised by user: ${ticket.user_id || "unknown"}`,
    `Event: ${event_type}${deduped ? " (deduped)" : ""}`,
    `Recipient route: ${recipient.route_reason || "platform_admin_escalation"}`,
    ``,
    `Open the admin support console to inspect the ticket and lifecycle events.`,
  ];
  return {
    purpose: EMAIL_PURPOSE,
    subject,
    body_text: bodyLines.join("\n"),
    body_html: null,
    provider: "support_ticket_router",
    secrets_included: false,
  };
}

async function emailAlreadyQueued(connection, { ticket_id, event_type, recipient_email }) {
  const [rows] = await connection.query(
    `SELECT email_id
       FROM auth_email_outbox
      WHERE purpose = ?
        AND recipient_email = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.ticket_id')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.event_type')) = ?
        AND status IN ('queued','sent')
      ORDER BY created_at DESC
      LIMIT 1`,
    [EMAIL_PURPOSE, recipient_email, ticket_id, event_type]
  );
  return rows[0]?.email_id || null;
}

async function insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type, actor_id = "ticket_router", actor_type = "system", visibility = "internal_support", summary = null, payload_json = {} }) {
  await connection.query(
    `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
     VALUES (UUID(), ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    [ticket_id, tenant_id, event_type, actor_id, actor_type, visibility, summary, JSON.stringify({ ...payload_json, secrets_included: false })]
  );
}

export async function queueSupportTicketRoutingNotifications({ ticket = {}, event_type = "ticket_created", deduped = false } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const routing = await resolveSupportTicketRoutingRecipients(ticket, { connection });
    if (!routing.recipients.length) {
      await insertLifecycleEvent(connection, {
        ticket_id: ticket.ticket_id,
        tenant_id: ticket.tenant_id,
        event_type: "ticket_admin_notification_skipped",
        summary: "No eligible admin email recipients were resolved for this ticket.",
        payload_json: { routing_version: ROUTING_VERSION, event_type, reason: "no_eligible_recipients" },
      });
      return { ok: true, queued_count: 0, skipped_count: 1, routing, secrets_included: false };
    }

    const queued = [];
    const skipped = [];
    for (const recipient of routing.recipients) {
      const email = buildSupportTicketAdminEmail({ ticket, recipient, event_type, deduped });
      const existingEmailId = await emailAlreadyQueued(connection, {
        ticket_id: ticket.ticket_id,
        event_type,
        recipient_email: recipient.email,
      });
      if (existingEmailId) {
        skipped.push({ recipient_email: recipient.email, reason: "already_queued", email_id: existingEmailId });
        continue;
      }
      const emailId = randomUUID();
      const metadata = {
        routing_version: ROUTING_VERSION,
        ticket_id: ticket.ticket_id,
        tenant_id: ticket.tenant_id,
        event_type,
        deduped: Boolean(deduped),
        recipient_user_id: recipient.user_id,
        recipient_role: recipient.role,
        recipient_route_reason: recipient.route_reason,
        submitter_user_id: ticket.user_id || null,
        queue_key: ticket.queue_key || null,
        external_send_performed: false,
        secrets_included: false,
      };
      await connection.query(
        `INSERT INTO auth_email_outbox
           (email_id, purpose, recipient_email, subject, body_text, body_html, status, provider, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        [emailId, email.purpose, recipient.email, email.subject, email.body_text, email.body_html, email.provider, JSON.stringify(metadata)]
      );
      queued.push({ email_id: emailId, recipient_email: recipient.email, route_reason: recipient.route_reason });
    }

    await insertLifecycleEvent(connection, {
      ticket_id: ticket.ticket_id,
      tenant_id: ticket.tenant_id,
      event_type: queued.length ? "ticket_admin_notification_queued" : "ticket_admin_notification_deduped",
      summary: queued.length ? `Queued ${queued.length} admin ticket notification(s).` : "Admin ticket notifications were already queued.",
      payload_json: {
        routing_version: ROUTING_VERSION,
        event_type,
        queued_count: queued.length,
        skipped_count: skipped.length,
        recipient_count: routing.recipient_count,
        queued,
        skipped,
        external_send_performed: false,
      },
    });

    return {
      ok: true,
      queued_count: queued.length,
      skipped_count: skipped.length,
      queued,
      skipped,
      routing: {
        ...routing,
        recipients: routing.recipients.map((recipient) => ({
          user_id: recipient.user_id,
          email: recipient.email,
          role: recipient.role,
          route_reason: recipient.route_reason,
          tenant_id: recipient.tenant_id,
          secrets_included: false,
        })),
      },
      secrets_included: false,
    };
  } finally {
    if (ownsConnection) connection.release();
  }
}
