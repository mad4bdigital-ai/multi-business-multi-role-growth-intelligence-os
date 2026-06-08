import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const VALID_TICKET_CATEGORIES = new Set(["support", "review_request", "escalation", "managed_task", "billing", "general"]);
const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const VALID_SEVERITIES = new Set(["sev4", "sev3", "sev2", "sev1"]);
const OPEN_TICKET_STATUSES = new Set(["open", "in_review", "awaiting_approval"]);
const SENSITIVE_KEY_PARTS = [
  "password", "passwd", "secret", "token", "api_key", "apikey", "credential",
  "private_key", "client_secret", "refresh_token", "access_token", "authorization",
];

const ISSUE_CLASSIFICATION = {
  brand_authority_missing: { category: "review_request", queue_key: "access_authority", severity: "sev3", lifecycle_state: "permission_review_required", customer_status: "under_review" },
  access_mapping_issue: { category: "review_request", queue_key: "access_authority", severity: "sev3", lifecycle_state: "permission_review_required", customer_status: "under_review" },
  resource_not_visible: { category: "review_request", queue_key: "access_authority", severity: "sev3", lifecycle_state: "resource_authority_checked", customer_status: "under_review" },
  permission_denied: { category: "review_request", queue_key: "access_authority", severity: "sev3", lifecycle_state: "permission_review_required", customer_status: "under_review" },
  connector_unreachable: { category: "escalation", queue_key: "connector_operations", severity: "sev2", lifecycle_state: "diagnostic_running", customer_status: "in_progress" },
  credential_required: { category: "support", queue_key: "credential_intake", severity: "sev3", lifecycle_state: "blocked_by_missing_credential", customer_status: "needs_your_input" },
  workflow_failed: { category: "managed_task", queue_key: "workflow_runtime", severity: "sev2", lifecycle_state: "diagnostic_running", customer_status: "in_progress" },
  approval_required: { category: "review_request", queue_key: "managed_services", severity: "sev3", lifecycle_state: "awaiting_internal_approval", customer_status: "waiting_for_approval" },
  platform_tool_surface_bug: { category: "escalation", queue_key: "platform_engineering", severity: "sev2", lifecycle_state: "internal_review_required", customer_status: "under_review" },
  tenant_onboarding_issue: { category: "escalation", queue_key: "tenant_support", severity: "sev3", lifecycle_state: "triage_pending", customer_status: "under_review" },
  managed_service_request: { category: "managed_task", queue_key: "managed_services", severity: "sev4", lifecycle_state: "triage_pending", customer_status: "received" },
};

const SLA_MINUTES_BY_SEVERITY = {
  sev1: { first_response: 15, triage: 30, resolution: 120 },
  sev2: { first_response: 60, triage: 120, resolution: 480 },
  sev3: { first_response: 240, triage: 480, resolution: 2880 },
  sev4: { first_response: 1440, triage: 2880, resolution: 7200 },
};

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes || 0) * 60_000);
}

function normalizeString(value, fallback = "") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function normalizeCategory(value, fallback = "general") {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return VALID_TICKET_CATEGORIES.has(normalized) ? normalized : fallback;
}

function normalizePriority(value, fallback = "normal") {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return VALID_PRIORITIES.has(normalized) ? normalized : fallback;
}

function normalizeSeverity(value, fallback = "sev3") {
  const normalized = normalizeString(value, fallback).toLowerCase();
  return VALID_SEVERITIES.has(normalized) ? normalized : fallback;
}

function isSensitiveKey(key) {
  const lower = String(key || "").toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

export function sanitizeTicketMetadata(value) {
  if (Array.isArray(value)) return value.map(sanitizeTicketMetadata);
  if (!value || typeof value !== "object") return value ?? null;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? "[redacted]" : sanitizeTicketMetadata(child);
  }
  return out;
}

function jsonOrNull(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(sanitizeTicketMetadata(value));
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function compactTicket(row = {}) {
  const metadata = parseJsonObject(row.metadata_json, null);
  return {
    ticket_id: row.ticket_id,
    tenant_id: row.tenant_id,
    title: row.title,
    category: row.category,
    ticket_type: row.ticket_type || null,
    priority: row.priority,
    severity: row.severity || null,
    status: row.status,
    lifecycle_state: row.lifecycle_state || null,
    customer_status: row.customer_status || null,
    queue_key: row.queue_key || null,
    assignment_status: row.assignment_status || null,
    assigned_to: row.assigned_to || null,
    service_mode: row.service_mode,
    dedupe_key: row.dedupe_key || null,
    occurrence_count: Number(row.occurrence_count || 1),
    customer_message: row.customer_message || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_seen_at: row.last_seen_at || null,
    first_response_due_at: row.first_response_due_at || null,
    triage_due_at: row.triage_due_at || null,
    resolution_due_at: row.resolution_due_at || null,
    sla_status: row.sla_status || null,
    metadata_json: metadata,
    secrets_included: false,
  };
}

function classificationFor(issueType) {
  return ISSUE_CLASSIFICATION[normalizeString(issueType, "general_support")] || {
    category: "support",
    queue_key: "tenant_support",
    severity: "sev4",
    lifecycle_state: "triage_pending",
    customer_status: "received",
  };
}

export function computeSupportTicketDedupeKey(envelope = {}) {
  const tenant = normalizeString(envelope.tenant_id, "tenantless");
  const user = normalizeString(envelope.user_id, "any_user");
  const sourceEvent = normalizeString(envelope.source_event || envelope.ticket_type || envelope.issue_type, "general_support");
  const resourceType = normalizeString(envelope.resource?.type || envelope.resource_type, "none");
  const resourceRef = normalizeString(envelope.resource?.ref || envelope.resource_ref, "none");
  return `tenant:${tenant}:user:${user}:issue:${sourceEvent}:resource:${resourceType}:${resourceRef}`.slice(0, 255);
}

function buildNormalizedEnvelope(envelope = {}) {
  const ticketType = normalizeString(envelope.ticket_type || envelope.issue_type || envelope.source_event, "general_support");
  const classification = classificationFor(ticketType);
  const severity = normalizeSeverity(envelope.severity, classification.severity);
  const priority = normalizePriority(envelope.priority, severity === "sev1" ? "urgent" : severity === "sev2" ? "high" : "normal");
  const category = normalizeCategory(envelope.category, classification.category);
  const now = new Date();
  const sla = SLA_MINUTES_BY_SEVERITY[severity] || SLA_MINUTES_BY_SEVERITY.sev3;
  return {
    ticket_id: envelope.ticket_id || randomUUID(),
    tenant_id: normalizeString(envelope.tenant_id),
    user_id: normalizeString(envelope.user_id),
    actor_id: normalizeString(envelope.actor_id || envelope.user_id),
    actor_type: normalizeString(envelope.actor_type || "system"),
    title: normalizeString(envelope.title, "Support request").slice(0, 512),
    ticket_type: ticketType.slice(0, 128),
    category,
    priority,
    severity,
    service_mode: normalizeString(envelope.service_mode, "managed"),
    source_layer: normalizeString(envelope.source_layer || "system"),
    source_tool: normalizeString(envelope.source_tool || "support_ticket_create"),
    source_event: normalizeString(envelope.source_event || ticketType),
    lifecycle_state: normalizeString(envelope.lifecycle_state, classification.lifecycle_state),
    customer_status: normalizeString(envelope.customer_status, classification.customer_status),
    queue_key: normalizeString(envelope.queue_key, classification.queue_key),
    assignment_status: normalizeString(envelope.assignment_status, "queue_assigned"),
    customer_message: normalizeString(envelope.customer_message || envelope.message, "We received your request and will review it."),
    internal_summary: normalizeString(envelope.internal_summary || envelope.body || envelope.summary, "Support ticket created by governed ticket lifecycle authority."),
    metadata_json: sanitizeTicketMetadata(envelope.metadata_json || envelope.metadata || {}),
    resource: envelope.resource || { type: envelope.resource_type || null, ref: envelope.resource_ref || null },
    authority: envelope.authority || envelope.permission_snapshot || null,
    dedupe_key: normalizeString(envelope.dedupe_key || computeSupportTicketDedupeKey(envelope)),
    first_response_due_at: envelope.first_response_due_at || addMinutes(now, sla.first_response),
    triage_due_at: envelope.triage_due_at || addMinutes(now, sla.triage),
    resolution_due_at: envelope.resolution_due_at || addMinutes(now, sla.resolution),
  };
}

async function queryRows(connection, sql, params = []) {
  const [rows] = await connection.query(sql, params);
  return rows;
}

async function queryOne(connection, sql, params = []) {
  const rows = await queryRows(connection, sql, params);
  return rows[0] || null;
}

async function insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type, from_state = null, to_state = null, actor_id = null, actor_type = null, visibility = "internal_support", summary = null, payload_json = null }) {
  const eventId = randomUUID();
  await connection.query(
    `INSERT INTO ticket_lifecycle_events
       (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventId, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, jsonOrNull(payload_json)]
  );
  return eventId;
}

async function insertTimelineEvent(connection, { ticket_id, tenant_id, event_type, actor_id = null, actor_type = null, summary = null, payload_json = null }) {
  const eventId = randomUUID();
  await connection.query(
    `INSERT INTO timeline_events (event_id, tenant_id, ticket_id, event_type, actor_id, actor_type, summary, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventId, tenant_id, ticket_id, event_type, actor_id, actor_type, summary, jsonOrNull(payload_json)]
  );
  return eventId;
}

async function insertAuditLog(connection, { ticket_id, tenant_id, actor_id = null, actor_type = "system", action, after_json = null }) {
  const auditId = randomUUID();
  await connection.query(
    `INSERT INTO audit_log (audit_id, tenant_id, actor_id, actor_type, action, resource_type, resource_id, after_json, service_mode)
     VALUES (?, ?, ?, ?, ?, 'ticket', ?, ?, 'managed')`,
    [auditId, tenant_id, actor_id, actor_type, action, ticket_id, jsonOrNull(after_json)]
  );
  return auditId;
}

async function attachResourceLink(connection, ticket, resource = {}) {
  const resourceType = normalizeString(resource?.type || resource?.resource_type);
  const resourceRef = normalizeString(resource?.ref || resource?.resource_ref);
  if (!resourceType && !resourceRef) return null;
  const linkId = randomUUID();
  await connection.query(
    `INSERT INTO ticket_resource_links
       (link_id, ticket_id, tenant_id, resource_type, resource_ref, relationship, visibility, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [linkId, ticket.ticket_id, ticket.tenant_id, resourceType || "unknown", resourceRef || null, resource.relationship || "subject", resource.visibility || "internal_support", jsonOrNull(resource.evidence_json || resource.evidence || {})]
  );
  return linkId;
}

async function capturePermissionSnapshot(connection, ticket, envelope) {
  if (!envelope.authority && !envelope.user_id && !envelope.resource?.type) return null;
  const snapshotId = randomUUID();
  const authority = envelope.authority || {};
  await connection.query(
    `INSERT INTO ticket_permission_snapshots
       (snapshot_id, ticket_id, tenant_id, user_id, actor_type, role_at_creation, requested_action, resource_type, resource_ref, access_decision, authority_source, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshotId,
      ticket.ticket_id,
      ticket.tenant_id,
      envelope.user_id || null,
      envelope.actor_type || null,
      authority.role_at_creation || envelope.role_at_creation || null,
      authority.requested_action || envelope.requested_action || envelope.source_event || null,
      envelope.resource?.type || envelope.resource_type || null,
      envelope.resource?.ref || envelope.resource_ref || null,
      authority.decision || authority.access_decision || null,
      authority.source || authority.authority_source || null,
      jsonOrNull(authority),
    ]
  );
  return snapshotId;
}

async function fetchTicketById(connection, tenantId, ticketId) {
  return await queryOne(connection, "SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenantId, ticketId]);
}

export async function createOrAppendSupportTicket(envelope = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const ticket = buildNormalizedEnvelope(envelope);
  if (!ticket.tenant_id) {
    const err = new Error("tenant_id is required for governed support tickets.");
    err.status = 400;
    err.code = "ticket_tenant_required";
    throw err;
  }

  try {
    if (ownsConnection) await connection.beginTransaction();
    const existing = await queryOne(
      connection,
      `SELECT * FROM tickets
        WHERE tenant_id = ? AND dedupe_key = ? AND status IN ('open','in_review','awaiting_approval')
        ORDER BY created_at DESC LIMIT 1`,
      [ticket.tenant_id, ticket.dedupe_key]
    );

    if (existing) {
      await connection.query(
        `UPDATE tickets
            SET occurrence_count = COALESCE(occurrence_count, 1) + 1,
                last_seen_at = NOW(),
                updated_at = NOW()
          WHERE ticket_id = ?`,
        [existing.ticket_id]
      );
      await insertLifecycleEvent(connection, {
        ticket_id: existing.ticket_id,
        tenant_id: existing.tenant_id,
        event_type: "dedupe_matched",
        actor_id: ticket.actor_id || null,
        actor_type: ticket.actor_type || null,
        visibility: "internal_support",
        summary: `Repeated ${ticket.ticket_type} event appended to existing ticket.`,
        payload_json: { source_layer: ticket.source_layer, source_tool: ticket.source_tool, source_event: ticket.source_event, metadata_json: ticket.metadata_json },
      });
      await insertTimelineEvent(connection, {
        ticket_id: existing.ticket_id,
        tenant_id: existing.tenant_id,
        event_type: "ticket_repeated",
        actor_id: ticket.actor_id || null,
        actor_type: ticket.actor_type || null,
        summary: ticket.customer_message,
        payload_json: { customer_visible: true, deduped: true, secrets_included: false },
      });
      if (ownsConnection) await connection.commit();
      return { ok: true, created: false, deduped: true, ticket: compactTicket({ ...existing, occurrence_count: Number(existing.occurrence_count || 1) + 1, last_seen_at: new Date() }), secrets_included: false };
    }

    await connection.query(
      `INSERT INTO tickets
        (ticket_id, tenant_id, title, category, priority, status, service_mode, metadata_json,
         ticket_type, source_layer, source_tool, source_event, severity, lifecycle_state, customer_status,
         queue_key, assignment_status, dedupe_key, first_response_due_at, triage_due_at, resolution_due_at,
         sla_status, last_seen_at, occurrence_count, customer_message, internal_summary)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'on_track', NOW(), 1, ?, ?)`,
      [
        ticket.ticket_id,
        ticket.tenant_id,
        ticket.title,
        ticket.category,
        ticket.priority,
        ticket.service_mode,
        jsonOrNull({ ...ticket.metadata_json, customer_safe: true, source_layer: ticket.source_layer }),
        ticket.ticket_type,
        ticket.source_layer,
        ticket.source_tool,
        ticket.source_event,
        ticket.severity,
        ticket.lifecycle_state,
        ticket.customer_status,
        ticket.queue_key,
        ticket.assignment_status,
        ticket.dedupe_key,
        ticket.first_response_due_at,
        ticket.triage_due_at,
        ticket.resolution_due_at,
        ticket.customer_message,
        ticket.internal_summary,
      ]
    );

    await insertLifecycleEvent(connection, { ticket_id: ticket.ticket_id, tenant_id: ticket.tenant_id, event_type: "ticket_created", to_state: ticket.lifecycle_state, actor_id: ticket.actor_id, actor_type: ticket.actor_type, visibility: "customer", summary: ticket.customer_message, payload_json: { ticket_type: ticket.ticket_type, queue_key: ticket.queue_key, severity: ticket.severity, secrets_included: false } });
    await insertLifecycleEvent(connection, { ticket_id: ticket.ticket_id, tenant_id: ticket.tenant_id, event_type: "queue_assigned", to_state: ticket.lifecycle_state, actor_id: "ticket_router", actor_type: "system", visibility: "internal_support", summary: `Ticket routed to ${ticket.queue_key}.`, payload_json: { queue_key: ticket.queue_key, classification: ticket.ticket_type } });
    await insertTimelineEvent(connection, { ticket_id: ticket.ticket_id, tenant_id: ticket.tenant_id, event_type: "ticket_created", actor_id: ticket.actor_id, actor_type: ticket.actor_type, summary: ticket.customer_message, payload_json: { customer_visible: true, status: ticket.customer_status, secrets_included: false } });
    await insertAuditLog(connection, { ticket_id: ticket.ticket_id, tenant_id: ticket.tenant_id, actor_id: ticket.actor_id, actor_type: ticket.actor_type, action: "support_ticket_created", after_json: { ticket_type: ticket.ticket_type, source_layer: ticket.source_layer, queue_key: ticket.queue_key, secrets_included: false } });
    await attachResourceLink(connection, ticket, ticket.resource);
    await capturePermissionSnapshot(connection, ticket, ticket);

    const inserted = await fetchTicketById(connection, ticket.tenant_id, ticket.ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, created: true, deduped: false, ticket: compactTicket(inserted), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function appendSupportTicketEvent({ tenant_id, ticket_id, event_type = "internal_note_added", summary, actor_id = null, actor_type = "system", visibility = "internal_support", payload_json = {} }, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const eventId = await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type, actor_id, actor_type, visibility, summary, payload_json });
    if (visibility === "customer") {
      await insertTimelineEvent(connection, { ticket_id, tenant_id, event_type, actor_id, actor_type, summary, payload_json: { ...payload_json, customer_visible: true } });
    }
    if (ownsConnection) await connection.commit();
    return { ok: true, event_id: eventId, ticket_id, secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function transitionSupportTicket({ tenant_id, ticket_id, to_state, status = null, customer_status = null, actor_id = null, actor_type = "system", reason = "state transition", evidence_json = {} }, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    await connection.query(
      `UPDATE tickets
          SET lifecycle_state = COALESCE(?, lifecycle_state),
              status = COALESCE(?, status),
              customer_status = COALESCE(?, customer_status),
              updated_at = NOW()
        WHERE tenant_id = ? AND ticket_id = ?`,
      [to_state || null, status || null, customer_status || null, tenant_id, ticket_id]
    );
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: "state_transition", from_state: ticket.lifecycle_state, to_state, actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: evidence_json });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_transitioned", after_json: { from_state: ticket.lifecycle_state, to_state, status, customer_status, reason } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function assignSupportTicket({ tenant_id, ticket_id, queue_key = null, assigned_to = null, assigned_actor_type = null, actor_id = null, actor_type = "system", reason = "assignment updated" }, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const assignmentStatus = assigned_to ? "assigned" : queue_key ? "queue_assigned" : "unassigned";
    await connection.query(
      `UPDATE tickets
          SET queue_key = COALESCE(?, queue_key),
              assigned_to = ?,
              assigned_actor_type = ?,
              assignment_status = ?,
              updated_at = NOW()
        WHERE tenant_id = ? AND ticket_id = ?`,
      [queue_key, assigned_to || null, assigned_actor_type || null, assignmentStatus, tenant_id, ticket_id]
    );
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: "assignee_changed", actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: { queue_key, assigned_to, assigned_actor_type, assignment_status: assignmentStatus } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function listSupportTicketsForTenant({ tenant_id, user_id = null, status = null, customer_visible = false, limit = 100 }, options = {}) {
  const pool = options.pool || getPool();
  const params = [tenant_id];
  const filters = ["tenant_id = ?"];
  if (status) { filters.push("status = ?"); params.push(status); }
  if (customer_visible && user_id) { filters.push("(user_id IS NULL OR user_id = ? OR customer_message IS NOT NULL)"); params.push(user_id); }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  const [rows] = await pool.query(
    `SELECT * FROM tickets WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
    params
  );
  return rows.map(compactTicket);
}

export async function getSupportTicketWithEvents({ tenant_id, ticket_id, customer_visible = false }, options = {}) {
  const pool = options.pool || getPool();
  const [ticketRows] = await pool.query("SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1", [tenant_id, ticket_id]);
  const ticket = ticketRows[0] || null;
  if (!ticket) return null;
  const visibilityClause = customer_visible ? "AND visibility = 'customer'" : "";
  const [eventRows] = await pool.query(
    `SELECT event_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json, created_at
       FROM ticket_lifecycle_events
      WHERE tenant_id = ? AND ticket_id = ? ${visibilityClause}
      ORDER BY created_at ASC LIMIT 500`,
    [tenant_id, ticket_id]
  );
  return { ticket: compactTicket(ticket), events: eventRows.map((row) => ({ ...row, payload_json: parseJsonObject(row.payload_json, null), secrets_included: false })), secrets_included: false };
}

export function _testingTicketClassification() {
  return { ISSUE_CLASSIFICATION, SLA_MINUTES_BY_SEVERITY, OPEN_TICKET_STATUSES: [...OPEN_TICKET_STATUSES] };
}
