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
    latest_event_at: row.latest_event_at || null,
    open_approval_count: Number(row.open_approval_count || 0),
    metadata_json: parseJsonObject(row.metadata_json, null),
    secrets_included: false,
  };
}

function notificationRecommendation(row = {}) {
  const state = row.lifecycle_state || "";
  if (state === "auto_resolution_proposed") {
    return {
      notification_type: "admin_auto_resolve_proposal",
      audience: "admin",
      action_required: "approve_or_reject_auto_resolve",
      priority: "high",
      summary: "Backend AI proposed an auto-resolution candidate; admin decision is required before execution.",
    };
  }
  if (row.status === "awaiting_approval" || Number(row.open_approval_count || 0) > 0 || state.includes("awaiting")) {
    return {
      notification_type: "admin_approval_required",
      audience: "admin",
      action_required: "review_approval_hold",
      priority: row.priority || "normal",
      summary: "Ticket is waiting for an admin approval decision.",
    };
  }
  if (row.status === "resolved" || state === "verified") {
    return {
      notification_type: "customer_resolution_update",
      audience: "customer",
      action_required: "notify_customer_and_acknowledge",
      priority: "normal",
      summary: "Ticket is verified/resolved and may require customer notification or admin acknowledgment.",
    };
  }
  if (state === "pending_admin_feedback") {
    return {
      notification_type: "admin_feedback_requested",
      audience: "admin",
      action_required: "provide_feedback",
      priority: row.priority || "normal",
      summary: "Ticket is waiting for admin feedback.",
    };
  }
  return {
    notification_type: "admin_activation_review",
    audience: "admin",
    action_required: "review_ticket",
    priority: row.priority || "normal",
    summary: "Ticket is visible during activation and should be reviewed.",
  };
}

export async function listSupportTicketNotificationQueue({ tenant_id = null, limit = 50, include_resolved_days = 7 } = {}, options = {}) {
  const pool = options.pool || getPool();
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const resolvedDays = Math.min(Math.max(Number(include_resolved_days) || 7, 1), 30);
  const params = [resolvedDays];
  const filters = [
    `(t.status IN ('open','in_review','awaiting_approval')
      OR t.lifecycle_state IN ('auto_resolution_proposed','pending_admin_feedback','resolved_pending_admin_ack','activation_review_ready')
      OR t.lifecycle_state LIKE 'awaiting%'
      OR (t.status = 'resolved' AND t.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)))`,
  ];
  if (tenant_id) { filters.push("t.tenant_id = ?"); params.push(tenant_id); }
  params.push(max);
  const [rows] = await pool.query(
    `SELECT t.*,
            COALESCE(ah.open_approval_count, 0) AS open_approval_count,
            le.latest_event_at
       FROM tickets t
       LEFT JOIN (
         SELECT twl.tenant_id, twl.ticket_id, COUNT(*) AS open_approval_count
           FROM ticket_workflow_links twl
           JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id
          WHERE ah.status = 'open'
          GROUP BY twl.tenant_id, twl.ticket_id
       ) ah ON ah.tenant_id = t.tenant_id AND ah.ticket_id = t.ticket_id
       LEFT JOIN (
         SELECT tenant_id, ticket_id, MAX(created_at) AS latest_event_at
           FROM ticket_lifecycle_events
          GROUP BY tenant_id, ticket_id
       ) le ON le.tenant_id = t.tenant_id AND le.ticket_id = t.ticket_id
      WHERE ${filters.join(" AND ")}
      ORDER BY FIELD(t.priority, 'urgent','high','normal','low'), t.updated_at DESC
      LIMIT ?`,
    params
  );
  const items = rows.map((row) => ({ ticket: compactTicket(row), recommendation: notificationRecommendation(row), secrets_included: false }));
  const summary = items.reduce((acc, item) => {
    const key = item.recommendation.notification_type;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return { ok: true, mode: "support_ticket_notification_queue", tenant_id: tenant_id || null, count: items.length, summary, items, secrets_included: false };
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

const ALLOWED_NOTIFICATION_TYPES = new Set([
  "admin_activation_review",
  "admin_auto_resolve_proposal",
  "admin_approval_required",
  "admin_feedback_requested",
  "customer_resolution_update",
  "reminder",
]);

const ALLOWED_AUDIENCES = new Set(["admin", "customer", "both"]);
const ALLOWED_CHANNELS = new Set(["activation_inbox", "email", "dashboard", "webhook", "internal_timeline"]);
const ALLOWED_ACK_ACTIONS = new Set(["queued", "delivered", "acknowledged", "dismissed", "failed", "snoozed", "customer_notified"]);

export async function createSupportTicketNotificationCycle({ tenant_id, ticket_id, notification_type = null, audience = "admin", channel = "activation_inbox", delivery_status = "queued", summary = null, actor_id = null, actor_type = "system", payload_json = {} } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const recommendation = notificationRecommendation(ticket);
    const type = notification_type || recommendation.notification_type;
    if (!ALLOWED_NOTIFICATION_TYPES.has(type)) {
      const err = new Error("Unsupported support ticket notification type.");
      err.status = 400;
      err.code = "support_ticket_notification_type_invalid";
      throw err;
    }
    if (!ALLOWED_AUDIENCES.has(audience)) {
      const err = new Error("Unsupported support ticket notification audience.");
      err.status = 400;
      err.code = "support_ticket_notification_audience_invalid";
      throw err;
    }
    if (!ALLOWED_CHANNELS.has(channel)) {
      const err = new Error("Unsupported support ticket notification channel.");
      err.status = 400;
      err.code = "support_ticket_notification_channel_invalid";
      throw err;
    }
    if (!ALLOWED_ACK_ACTIONS.has(delivery_status)) {
      const err = new Error("Unsupported support ticket notification delivery status.");
      err.status = 400;
      err.code = "support_ticket_notification_delivery_status_invalid";
      throw err;
    }
    const eventPayload = {
      notification_type: type,
      audience,
      channel,
      delivery_status,
      recommendation,
      payload_json,
      external_send_performed: false,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'notification_cycle_recorded', ?, ?, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, ticket.lifecycle_state || null, ticket.lifecycle_state || null, actor_id, actor_type, summary || recommendation.summary, JSON.stringify(eventPayload)]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_notification_cycle_recorded', 'ticket', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify(eventPayload)]
    );
    const updated = await fetchTicket(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, notification_type: type, audience, channel, delivery_status, ticket: compactTicket(updated), recommendation, external_send_performed: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export async function recordSupportTicketNotificationAck({ tenant_id, ticket_id, ack_action, notification_type = null, audience = "admin", channel = "activation_inbox", summary = null, actor_id = null, actor_type = "admin", payload_json = {} } = {}, options = {}) {
  const action = String(ack_action || "").trim().toLowerCase();
  if (!ALLOWED_ACK_ACTIONS.has(action)) {
    const err = new Error("Unsupported support ticket notification acknowledgment action.");
    err.status = 400;
    err.code = "support_ticket_notification_ack_action_invalid";
    throw err;
  }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicket(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const recommendation = notificationRecommendation(ticket);
    const type = notification_type || recommendation.notification_type;
    const eventPayload = { notification_type: type, audience, channel, ack_action: action, payload_json, external_send_performed: false, secrets_included: false };
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'notification_ack_recorded', ?, ?, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, ticket.lifecycle_state || null, ticket.lifecycle_state || null, actor_id, actor_type, summary || `Notification ${action} recorded.`, JSON.stringify(eventPayload)]
    );
    if (action === "acknowledged" && ticket.lifecycle_state === "resolved_pending_admin_ack") {
      await connection.query("UPDATE tickets SET lifecycle_state = 'verified', customer_status = 'resolved', updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [tenant_id, ticket_id]);
    }
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_notification_ack_recorded', 'ticket', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify(eventPayload)]
    );
    const updated = await fetchTicket(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, ack_action: action, notification_type: type, audience, channel, ticket: compactTicket(updated), external_send_performed: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
