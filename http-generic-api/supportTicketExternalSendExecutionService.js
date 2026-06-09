import { getPool } from "./db.js";
import { checkSupportTicketExternalDeliveryReadiness } from "./supportTicketExternalDeliveryPolicyService.js";

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

const EXTERNAL_CHANNELS = new Set(["email", "webhook"]);
const ALLOWED_AUDIENCES = new Set(["admin", "customer", "both"]);

function normalizeChannel(channel = "email") {
  const key = String(channel || "email").trim().toLowerCase();
  if (!EXTERNAL_CHANNELS.has(key)) {
    const err = new Error("External send execution supports email or webhook only.");
    err.status = 400;
    err.code = "support_ticket_external_send_channel_invalid";
    throw err;
  }
  return key;
}

function normalizeAudience(audience = "admin") {
  const value = String(audience || "admin").trim().toLowerCase();
  if (!ALLOWED_AUDIENCES.has(value)) {
    const err = new Error("Unsupported support ticket external send audience.");
    err.status = 400;
    err.code = "support_ticket_external_send_audience_invalid";
    throw err;
  }
  return value;
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

async function resolveApprovedDeliveryHold(connection, { tenant_id, ticket_id, approval_hold_id = null, channel, audience }) {
  const params = [tenant_id, ticket_id, channel, audience];
  const filters = [
    "ah.tenant_id = ?",
    "twl.ticket_id = ?",
    "JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.approval_type')) = 'external_notification_delivery'",
    "JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.channel')) = ?",
    "JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.audience')) = ?",
    "ah.status = 'approved'",
  ];
  if (approval_hold_id) { filters.push("ah.hold_id = ?"); params.push(approval_hold_id); }
  const [rows] = await connection.query(
    `SELECT ah.hold_id, ah.tenant_id, ah.status, ah.decision_by, ah.decision_note, ah.decided_at,
            JSON_EXTRACT(ah.execution_context_json, '$') AS approval_context_json
       FROM approval_holds ah
       JOIN ticket_workflow_links twl ON twl.approval_hold_id = ah.hold_id AND twl.tenant_id = ah.tenant_id
      WHERE ${filters.join(" AND ")}
      ORDER BY ah.decided_at DESC, ah.created_at DESC
      LIMIT 1`,
    params
  );
  const hold = rows[0] || null;
  if (!hold) return null;
  return { ...hold, approval_context_json: parseJsonObject(hold.approval_context_json, {}), secrets_included: false };
}

async function countRecentExecutionEvents(connection, { tenant_id, ticket_id, channel, audience, minutes }) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
       FROM ticket_lifecycle_events
      WHERE tenant_id = ? AND ticket_id = ?
        AND event_type = 'external_send_execution_recorded'
        AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.channel')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.audience')) = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [tenant_id, ticket_id, channel, audience, minutes]
  );
  return Number(rows[0]?.count || 0);
}

async function buildExecutionPlan(connection, { tenant_id, ticket_id, channel, audience, approval_hold_id = null, credential_ref = null, subject = null, body = null, payload_json = {} }) {
  const ticket = await fetchTicket(connection, tenant_id, ticket_id);
  if (!ticket) {
    const err = new Error("Ticket not found.");
    err.status = 404;
    err.code = "support_ticket_not_found";
    throw err;
  }
  const readiness = await checkSupportTicketExternalDeliveryReadiness({ tenant_id, ticket_id, channel, audience, credential_ref }, { connection });
  const approvedHold = await resolveApprovedDeliveryHold(connection, { tenant_id, ticket_id, approval_hold_id, channel, audience });
  const rateWindowMinutes = 60;
  const retryWindowMinutes = 24 * 60;
  const recentCount = await countRecentExecutionEvents(connection, { tenant_id, ticket_id, channel, audience, minutes: rateWindowMinutes });
  const retryCount = await countRecentExecutionEvents(connection, { tenant_id, ticket_id, channel, audience, minutes: retryWindowMinutes });
  const rateLimitOk = recentCount < 3;
  const retryAllowed = retryCount < 5;
  const blockers = [];
  if (!readiness.credential_binding_present) blockers.push("external_delivery_credential_binding_missing");
  if (!approvedHold) blockers.push("external_delivery_approval_hold_not_approved");
  if (!rateLimitOk) blockers.push("external_send_rate_limit_exceeded");
  if (!retryAllowed) blockers.push("external_send_retry_limit_exceeded");
  const metadata = parseJsonObject(ticket.metadata_json, {});
  const plan = {
    ready_for_record: blockers.length === 0,
    channel,
    audience,
    approval_hold_id: approvedHold?.hold_id || approval_hold_id || null,
    credential_binding_present: readiness.credential_binding_present,
    credential_ref: readiness.credential?.credential_ref || credential_ref || null,
    rate_limit: { window_minutes: rateWindowMinutes, max_records: 3, recent_count: recentCount, ok: rateLimitOk },
    retry_policy: { window_minutes: retryWindowMinutes, max_records: 5, recent_count: retryCount, retry_allowed: retryAllowed },
    subject: subject || `[${ticket.priority || "normal"}] ${ticket.title || "Support ticket notification"}`,
    body: body || `Ticket ${ticket.ticket_id} is in state ${ticket.lifecycle_state || ticket.status}. External send remains record-only in this adapter slice.`,
    payload_json: {
      ...payload_json,
      ticket_type: ticket.ticket_type || null,
      category: ticket.category || null,
      source: metadata?.source || metadata?.metadata?.source || null,
      external_send_performed: false,
      secrets_included: false,
    },
    blockers,
    external_send_performed: false,
    secrets_included: false,
  };
  return { ticket, readiness, approved_hold: approvedHold, plan };
}

export async function planSupportTicketExternalSendExecution({ tenant_id, ticket_id, channel = "email", audience = "admin", approval_hold_id = null, credential_ref = null, subject = null, body = null, payload_json = {} } = {}, options = {}) {
  const externalChannel = normalizeChannel(channel);
  const normalizedAudience = normalizeAudience(audience);
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const { ticket, readiness, approved_hold, plan } = await buildExecutionPlan(connection, { tenant_id, ticket_id, channel: externalChannel, audience: normalizedAudience, approval_hold_id, credential_ref, subject, body, payload_json });
    return { ok: true, mode: "dry_run", plan, readiness, approved_hold, ticket: compactTicket(ticket), external_send_performed: false, secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function recordSupportTicketExternalSendExecution({ tenant_id, ticket_id, channel = "email", audience = "admin", approval_hold_id = null, credential_ref = null, subject = null, body = null, mode = "dry_run", actor_id = null, actor_type = "admin", payload_json = {} } = {}, options = {}) {
  const externalChannel = normalizeChannel(channel);
  const normalizedAudience = normalizeAudience(audience);
  const runMode = String(mode || "dry_run").trim().toLowerCase();
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "record") await connection.beginTransaction();
    const { ticket, readiness, approved_hold, plan } = await buildExecutionPlan(connection, { tenant_id, ticket_id, channel: externalChannel, audience: normalizedAudience, approval_hold_id, credential_ref, subject, body, payload_json });
    if (runMode !== "record") {
      return { ok: true, mode: "dry_run", plan, readiness, approved_hold, ticket: compactTicket(ticket), external_send_performed: false, secrets_included: false };
    }
    if (!plan.ready_for_record) {
      const err = new Error("External send execution is not ready under approval, credential, rate-limit, and retry policy.");
      err.status = 409;
      err.code = "support_ticket_external_send_execution_not_ready";
      err.plan = plan;
      throw err;
    }
    const eventPayload = {
      ...plan,
      mode: "record",
      delivery_status: "recorded_not_sent",
      approved_hold_id: approved_hold?.hold_id || null,
      credential_binding_present: readiness.credential_binding_present,
      external_send_performed: false,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'external_send_execution_recorded', ?, ?, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, ticket.lifecycle_state || null, ticket.lifecycle_state || null, actor_id, actor_type, plan.subject, JSON.stringify(eventPayload)]
    );
    await connection.query(
      `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
       VALUES (UUID(), ?, ?, ?, 'support_ticket_external_send_execution_recorded', 'ticket', ?, ?, 'managed')`,
      [tenant_id, actor_id, actor_type, ticket_id, JSON.stringify(eventPayload)]
    );
    const updated = await fetchTicket(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "record", delivery_status: "recorded_not_sent", plan, ticket: compactTicket(updated), external_send_performed: false, secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "record") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
