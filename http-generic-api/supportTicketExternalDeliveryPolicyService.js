import crypto from "node:crypto";
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

const EXTERNAL_CHANNELS = new Set(["email", "webhook"]);
const ALLOWED_AUDIENCES = new Set(["admin", "customer", "both"]);

function normalizeExternalChannel(channel = "email") {
  const key = String(channel || "email").trim().toLowerCase();
  if (!EXTERNAL_CHANNELS.has(key)) {
    const err = new Error("External delivery approval supports email or webhook only.");
    err.status = 400;
    err.code = "support_ticket_external_delivery_channel_invalid";
    throw err;
  }
  return key;
}

async function fetchTicket(connection, tenant_id, ticket_id) {
  const [rows] = await connection.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  return rows[0] || null;
}

async function findCredentialBinding(connection, { tenant_id, channel, credential_ref = null }) {
  const candidates = [];
  if (credential_ref) {
    candidates.push(["secret_references", "SELECT secret_ref AS credential_ref, tenant_id, provider, label, status, created_at FROM secret_references WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000') AND secret_ref = ? LIMIT 1", [tenant_id, credential_ref]]);
    candidates.push(["api_credentials", "SELECT credential_id AS credential_ref, tenant_id, provider, label, status, created_at FROM api_credentials WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000') AND credential_id = ? LIMIT 1", [tenant_id, credential_ref]]);
  } else {
    const providerLike = channel === "email" ? "%mail%" : "%webhook%";
    candidates.push(["secret_references", "SELECT secret_ref AS credential_ref, tenant_id, provider, label, status, created_at FROM secret_references WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000') AND (provider LIKE ? OR label LIKE ?) AND status IN ('active','ready','configured') ORDER BY tenant_id = ? DESC, created_at DESC LIMIT 1", [tenant_id, providerLike, providerLike, tenant_id]]);
    candidates.push(["api_credentials", "SELECT credential_id AS credential_ref, tenant_id, provider, label, status, created_at FROM api_credentials WHERE tenant_id IN (?, '00000000-0000-0000-0000-000000000000') AND (provider LIKE ? OR label LIKE ?) AND status IN ('active','ready','configured') ORDER BY tenant_id = ? DESC, created_at DESC LIMIT 1", [tenant_id, providerLike, providerLike, tenant_id]]);
  }
  for (const [source_table, sql, params] of candidates) {
    try {
      const [rows] = await connection.query(sql, params);
      if (rows[0]) return { source_table, ...rows[0], secret_value_included: false };
    } catch {
      continue;
    }
  }
  return null;
}

export async function checkSupportTicketExternalDeliveryReadiness({ tenant_id, ticket_id, channel = "email", audience = "admin", credential_ref = null } = {}, options = {}) {
  const externalChannel = normalizeExternalChannel(channel);
  if (!ALLOWED_AUDIENCES.has(String(audience || "admin"))) {
    const err = new Error("Unsupported support ticket external delivery audience.");
    err.status = 400;
    err.code = "support_ticket_external_delivery_audience_invalid";
    throw err;
  }
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
    const credential = await findCredentialBinding(connection, { tenant_id, channel: externalChannel, credential_ref });
    const ready = Boolean(credential);
    return {
      ok: true,
      mode: "external_delivery_readiness",
      ready,
      channel: externalChannel,
      audience,
      credential_binding_present: ready,
      credential: credential ? { credential_ref: credential.credential_ref, tenant_id: credential.tenant_id, provider: credential.provider, label: credential.label, status: credential.status, source_table: credential.source_table, secret_value_included: false } : null,
      blockers: ready ? [] : ["external_delivery_credential_binding_missing"],
      external_send_performed: false,
      ticket: compactTicket(ticket),
      secrets_included: false,
    };
  } finally { if (ownsConnection) connection.release(); }
}

export async function requestSupportTicketExternalDeliveryApproval({ tenant_id, ticket_id, channel = "email", audience = "admin", credential_ref = null, preview_subject = null, preview_body = null, reason = null, actor_id = null, actor_type = "admin", evidence_json = {} } = {}, options = {}) {
  const externalChannel = normalizeExternalChannel(channel);
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const readiness = await checkSupportTicketExternalDeliveryReadiness({ tenant_id, ticket_id, channel: externalChannel, audience, credential_ref }, { connection });
    const holdId = crypto.randomUUID();
    const payload = {
      approval_type: "external_notification_delivery",
      channel: externalChannel,
      audience,
      credential_ref: credential_ref || readiness.credential?.credential_ref || null,
      credential_binding_present: readiness.credential_binding_present,
      preview_subject,
      preview_body,
      reason,
      evidence_json,
      external_send_performed: false,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO approval_holds (hold_id, run_id, tenant_id, hold_type, actor_id, actor_type, request_id, correlation_id, execution_context_json, required_role, status, expires_at)
       VALUES (?, ?, ?, 'supervisor_approval', ?, ?, ?, ?, ?, 'platform_admin', 'open', DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [holdId, holdId, tenant_id, actor_id, actor_type, holdId, `external_delivery:${ticket_id}:${externalChannel}`, JSON.stringify(payload)]
    );
    await connection.query(
      `INSERT INTO ticket_workflow_links (link_id, tenant_id, ticket_id, approval_hold_id, relationship, evidence_json)
       VALUES (UUID(), ?, ?, ?, 'external_notification_delivery_approval', ?)`,
      [tenant_id, ticket_id, holdId, JSON.stringify(payload)]
    );
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'external_delivery_approval_requested', NULL, NULL, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, actor_id, actor_type, reason || "External notification delivery approval requested.", JSON.stringify(payload)]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, approval_hold_id: holdId, status: "open", readiness, external_send_performed: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export async function decideSupportTicketExternalDeliveryApproval({ tenant_id, ticket_id, approval_hold_id, decision, decision_note = null, actor_id = null, actor_type = "admin" } = {}, options = {}) {
  const normalized = String(decision || "").trim().toLowerCase();
  if (!["approved", "rejected"].includes(normalized)) {
    const err = new Error("External delivery approval decision must be approved or rejected.");
    err.status = 400;
    err.code = "support_ticket_external_delivery_decision_invalid";
    throw err;
  }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const [holds] = await connection.query("SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? AND hold_type = 'external_notification_delivery' LIMIT 1", [tenant_id, approval_hold_id]);
    const hold = holds[0];
    if (!hold) {
      const err = new Error("External delivery approval hold not found.");
      err.status = 404;
      err.code = "support_ticket_external_delivery_hold_not_found";
      throw err;
    }
    if (hold.status !== "open") {
      const err = new Error("External delivery approval hold is not open.");
      err.status = 409;
      err.code = "support_ticket_external_delivery_hold_not_open";
      throw err;
    }
    await connection.query(
      "UPDATE approval_holds SET status = ?, decision_by = ?, decision_note = ?, decided_at = NOW() WHERE tenant_id = ? AND hold_id = ?",
      [normalized, actor_id, decision_note, tenant_id, approval_hold_id]
    );
    await connection.query(
      `INSERT INTO ticket_lifecycle_events (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
       VALUES (UUID(), ?, ?, 'external_delivery_approval_decided', NULL, NULL, ?, ?, 'internal_support', ?, ?)`,
      [ticket_id, tenant_id, actor_id, actor_type, decision_note || `External delivery approval ${normalized}.`, JSON.stringify({ approval_hold_id, decision: normalized, external_send_performed: false, secrets_included: false })]
    );
    if (ownsConnection) await connection.commit();
    return { ok: true, approval_hold_id, decision: normalized, external_send_performed: false, secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}
