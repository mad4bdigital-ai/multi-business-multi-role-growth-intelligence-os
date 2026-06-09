import { getPool } from "./db.js";

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function compactTicket(row = {}) {
  return {
    ticket_id: row.ticket_id,
    tenant_id: row.tenant_id,
    user_id: row.user_id || null,
    title: row.title,
    ticket_type: row.ticket_type || null,
    category: row.category,
    priority: row.priority,
    severity: row.severity || null,
    status: row.status,
    lifecycle_state: row.lifecycle_state || null,
    customer_status: row.customer_status || null,
    queue_key: row.queue_key || null,
    assignment_status: row.assignment_status || null,
    assigned_to: row.assigned_to || null,
    service_mode: row.service_mode || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata_json: parseJsonObject(row.metadata_json, null),
    secrets_included: false,
  };
}

const ADAPTERS = {
  activation_inbox: {
    adapter_key: "activation_inbox",
    external_send_supported: false,
    dispatch_supported: true,
    dispatch_mode: "record_only",
    requires_delivery_approval: false,
    summary: "Records an activation inbox delivery event for admin review.",
  },
  dashboard: {
    adapter_key: "dashboard",
    external_send_supported: false,
    dispatch_supported: true,
    dispatch_mode: "record_only",
    requires_delivery_approval: false,
    summary: "Records a dashboard notification event for governed UI surfaces.",
  },
  internal_timeline: {
    adapter_key: "internal_timeline",
    external_send_supported: false,
    dispatch_supported: true,
    dispatch_mode: "record_only",
    requires_delivery_approval: false,
    summary: "Records an internal ticket timeline notification event.",
  },
  email: {
    adapter_key: "email",
    external_send_supported: false,
    dispatch_supported: false,
    dispatch_mode: "gated_external_future",
    requires_delivery_approval: true,
    summary: "Email delivery is intentionally gated; this slice supports preview only and no external send.",
  },
  webhook: {
    adapter_key: "webhook",
    external_send_supported: false,
    dispatch_supported: false,
    dispatch_mode: "gated_external_future",
    requires_delivery_approval: true,
    summary: "Webhook delivery is intentionally gated; this slice supports preview only and no external send.",
  },
};

function normalizeChannel(channel = "activation_inbox") {
  const key = String(channel || "activation_inbox").trim().toLowerCase();
  if (!ADAPTERS[key]) {
    const err = new Error("Unsupported support ticket notification adapter channel.");
    err.status = 400;
    err.code = "support_ticket_notification_adapter_channel_invalid";
    throw err;
  }
  return key;
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

function buildPreview({ ticket, channel, notification_type = null, audience = "admin", subject = null, body = null, payload_json = {} }) {
  const adapter = ADAPTERS[channel];
  const metadata = parseJsonObject(ticket.metadata_json, {});
  const type = notification_type || (ticket.lifecycle_state === "auto_resolution_proposed" ? "admin_auto_resolve_proposal" : ticket.status === "resolved" ? "customer_resolution_update" : "admin_activation_review");
  const safeSubject = subject || `[${ticket.priority || "normal"}] ${ticket.title || "Support ticket notification"}`;
  const safeBody = body || `Ticket ${ticket.ticket_id} is in state ${ticket.lifecycle_state || ticket.status}. Review required action in the activation inbox.`;
  return {
    adapter_key: channel,
    notification_type: type,
    audience,
    subject: safeSubject,
    body: safeBody,
    payload_json: {
      ...payload_json,
      ticket_type: ticket.ticket_type || null,
      category: ticket.category || null,
      source: metadata?.source || metadata?.metadata?.source || null,
      external_send_performed: false,
      secrets_included: false,
    },
    adapter,
    external_send_performed: false,
    secrets_included: false,
  };
}

export async function listSupportTicketNotificationAdapters() {
  return {
    ok: true,
    mode: "support_ticket_notification_adapters",
    adapters: Object.values(ADAPTERS),
    external_send_enabled: false,
    secrets_included: false,
  };
}

export async function previewSupportTicketNotificationDelivery({ tenant_id, ticket_id, channel = "activation_inbox", notification_type = null, audience = "admin", subject = null, body = null, payload_json = {} } = {}, options = {}) {
  const adapterKey = normalizeChannel(channel);
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const preview = buildPreview({ ticket, channel: adapterKey, notification_type, audience, subject, body, payload_json });
    return { ok: true, mode: "dry_run", preview, ticket: compactTicket(ticket), external_send_performed: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function dispatchSupportTicketNotificationDelivery({ tenant_id, ticket_id, channel = "activation_inbox", notification_type = null, audience = "admin", subject = null, body = null, mode = "dry_run", delivery_approval_hold_id = null, actor_id = null, actor_type = "admin", payload_json = {} } = {}, options = {}) {
  const adapterKey = normalizeChannel(channel);
  const runMode = mode === "record" || mode === "dispatch" ? "record" : "dry_run";
  const adapter = ADAPTERS[adapterKey];
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "record") await connection.beginTransaction();
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const preview = buildPreview({ ticket, channel: adapterKey, notification_type, audience, subject, body, payload_json });
    const plan = {
      mode: runMode,
      adapter_key: adapterKey,
      dispatch_supported: adapter.dispatch_supported,
      external_send_supported: adapter.external_send_supported,
      requires_delivery_approval: adapter.requires_delivery_approval,
      delivery_approval_hold_id: delivery_approval_hold_id || null,
      external_send_performed: false,
      secrets_included: false,
    };
    if (runMode !== "record") return { ok: true, mode: "dry_run", plan, preview, ticket: compactTicket(ticket), secrets_included: false };
    if (!adapter.dispatch_supported) {
      const err = new Error("External notification delivery adapter is gated and not configured for dispatch.");
      err.status = 409;
      err.code = "support_ticket_notification_external_delivery_gated";
      err.plan = plan;
      throw err;
    }
    const eventPayload = {
      plan,
      preview,
      payload_json,
      delivery_status: "delivered",
      external_send_performed: false,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'notification_adapter_recorded', ?, ?, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, ticket.lifecycle_state || null, ticket.lifecycle_state || null, actor_id, actor_type, preview.subject, JSON.stringify(eventPayload)]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_notification_adapter_recorded', 'ticket', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify(eventPayload)]
    );
    const updated = await fetchTicket(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "record", plan, preview, ticket: compactTicket(updated), external_send_performed: false, secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "record") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
