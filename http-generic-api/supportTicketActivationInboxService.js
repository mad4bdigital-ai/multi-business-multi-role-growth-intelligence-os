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

function bucketForTicket(row = {}) {
  if (row.lifecycle_state === "resolved_pending_admin_ack") return "admin_ack_required";
  if (row.status === "resolved" || row.lifecycle_state === "verified") return "recently_resolved";
  if (row.lifecycle_state === "auto_resolution_proposed") return "auto_resolve_candidates";
  if (row.lifecycle_state === "blocked_by_missing_resource_grant" || row.lifecycle_state === "blocked_by_missing_credential") return "blocked";
  if (row.status === "awaiting_approval" || String(row.lifecycle_state || "").includes("awaiting") || Number(row.open_approval_count || 0) > 0) return "needs_approval";
  return "awaiting_activation";
}

function bucketRows(rows = []) {
  const buckets = {
    awaiting_activation: [],
    needs_approval: [],
    auto_resolve_candidates: [],
    blocked: [],
    recently_resolved: [],
    admin_ack_required: [],
  };
  for (const row of rows) {
    const bucket = bucketForTicket(row);
    buckets[bucket].push(compactTicket(row));
  }
  return buckets;
}

export async function getActivationTicketInbox({ tenant_id = null, limit = 50, include_resolved_days = 7 } = {}, options = {}) {
  const pool = options.pool || getPool();
  const max = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const resolvedDays = Math.min(Math.max(Number(include_resolved_days) || 7, 1), 30);
  const params = [resolvedDays];
  const filters = [
    `(t.status IN ('open','in_review','awaiting_approval')
      OR t.lifecycle_state IN ('waiting_for_admin_activation','activation_review_ready','pending_admin_feedback','auto_resolution_proposed','resolved_pending_admin_ack')
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
  const buckets = bucketRows(rows);
  const summary = Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length]));
  return { ok: true, mode: "activation_ticket_inbox", tenant_id: tenant_id || null, summary, buckets, count: rows.length, secrets_included: false };
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

async function insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type, from_state = null, to_state = null, actor_id = null, actor_type = null, summary = null, payload_json = null }) {
  await connection.query(
    `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'internal_support', ?, ?)`,
    [ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, summary, JSON.stringify({ ...(payload_json || {}), secrets_included: false })]
  );
}

export async function recordSupportTicketAdminFeedback({ tenant_id, ticket_id, feedback_action, decision = null, summary = null, queue_key = null, assigned_to = null, actor_id = null, actor_type = "admin", evidence_json = {} } = {}, options = {}) {
  const action = String(feedback_action || "").trim().toLowerCase();
  const allowed = new Set(["acknowledge", "mark_activation_seen", "approve_auto_resolve", "reject_auto_resolve", "request_more_info", "assign_to_queue"]);
  if (!allowed.has(action)) {
    const err = new Error("Unsupported ticket admin feedback action.");
    err.status = 400;
    err.code = "support_ticket_admin_feedback_action_invalid";
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
    const patch = {
      status: ticket.status,
      lifecycle_state: ticket.lifecycle_state,
      customer_status: ticket.customer_status,
      queue_key: queue_key || ticket.queue_key,
      assigned_to: assigned_to || ticket.assigned_to,
    };
    if (action === "acknowledge") { patch.lifecycle_state = ticket.status === "resolved" ? "verified" : "activation_review_ready"; patch.customer_status = ticket.status === "resolved" ? "resolved" : "under_review"; }
    if (action === "mark_activation_seen") { patch.lifecycle_state = "activation_review_ready"; patch.customer_status = "under_review"; }
    if (action === "approve_auto_resolve") { patch.status = "awaiting_approval"; patch.lifecycle_state = "auto_resolution_approved"; patch.customer_status = "in_progress"; }
    if (action === "reject_auto_resolve") { patch.status = "in_review"; patch.lifecycle_state = "auto_resolution_rejected"; patch.customer_status = "under_review"; }
    if (action === "request_more_info") { patch.status = "in_review"; patch.lifecycle_state = "pending_admin_feedback"; patch.customer_status = "under_review"; }
    if (action === "assign_to_queue") { patch.status = "in_review"; patch.lifecycle_state = "queue_review_assigned"; patch.customer_status = "under_review"; }
    await connection.query(
      `UPDATE tickets SET status = ?, lifecycle_state = ?, customer_status = ?, queue_key = ?, assigned_to = ?, updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?`,
      [patch.status, patch.lifecycle_state, patch.customer_status, patch.queue_key || null, patch.assigned_to || null, tenant_id, ticket_id]
    );
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: `admin_feedback_${action}`, from_state: ticket.lifecycle_state || null, to_state: patch.lifecycle_state || null, actor_id, actor_type, summary: summary || `Admin feedback recorded: ${action}.`, payload_json: { feedback_action: action, decision, queue_key, assigned_to, evidence_json } });
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_admin_feedback_recorded', 'ticket', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify({ feedback_action: action, decision, patch, secrets_included: false })]
    );
    const updated = await fetchTicket(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, feedback_action: action, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
