import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { queueSupportTicketRoutingNotifications } from "./supportTicketRoutingNotificationService.js";
import {
  ensureSupportTicketResolutionCase,
  getSupportTicketResolution,
} from "./supportTicketResolutionService.js";

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
      const existingTicket = {
        ...existing,
        occurrence_count: Number(existing.occurrence_count || 1) + 1,
        last_seen_at: new Date(),
      };
      const resolution = await ensureSupportTicketResolutionCase({
        connection,
        ticket: existingTicket,
        actor_id: ticket.actor_id || "support_ticket_resolution_router",
      });
      if (resolution.created) {
        await insertLifecycleEvent(connection, {
          ticket_id: existing.ticket_id,
          tenant_id: existing.tenant_id,
          event_type: "resolution_case_linked",
          actor_id: "support_ticket_resolution_router",
          actor_type: "system",
          visibility: "internal_support",
          summary: `Linked ticket to ${resolution.summary.playbook_key}.`,
          payload_json: { ...resolution.summary, secrets_included: false },
        });
      }
      const notification = await queueSupportTicketRoutingNotifications({
        ticket: existingTicket,
        event_type: "dedupe_matched",
        deduped: true,
      }, { connection });
      if (ownsConnection) await connection.commit();
      return {
        ok: true,
        created: false,
        deduped: true,
        ticket: compactTicket(existingTicket),
        resolution: resolution.summary,
        notification,
        secrets_included: false,
      };
    }

    await connection.query(
      `INSERT INTO tickets
        (ticket_id, tenant_id, user_id, actor_id, actor_type, title, category, priority, status, service_mode, metadata_json,
         ticket_type, source_layer, source_tool, source_event, severity, lifecycle_state, customer_status,
         queue_key, assignment_status, dedupe_key, first_response_due_at, triage_due_at, resolution_due_at,
         sla_status, last_seen_at, occurrence_count, customer_message, internal_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'on_track', NOW(), 1, ?, ?)`,
      [
        ticket.ticket_id,
        ticket.tenant_id,
        ticket.user_id || null,
        ticket.actor_id || null,
        ticket.actor_type || null,
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

    const resolution = await ensureSupportTicketResolutionCase({
      connection,
      ticket,
      actor_id: ticket.actor_id || "support_ticket_resolution_router",
    });
    await insertLifecycleEvent(connection, {
      ticket_id: ticket.ticket_id,
      tenant_id: ticket.tenant_id,
      event_type: "resolution_case_linked",
      actor_id: "support_ticket_resolution_router",
      actor_type: "system",
      visibility: "internal_support",
      summary: `Linked ticket to ${resolution.summary.playbook_key}.`,
      payload_json: { ...resolution.summary, secrets_included: false },
    });

    const notification = await queueSupportTicketRoutingNotifications({
      ticket,
      event_type: "ticket_created",
      deduped: false,
    }, { connection });

    const inserted = await fetchTicketById(connection, ticket.tenant_id, ticket.ticket_id);
    if (ownsConnection) await connection.commit();
    return {
      ok: true,
      created: true,
      deduped: false,
      ticket: compactTicket(inserted),
      resolution: resolution.summary,
      notification,
      secrets_included: false,
    };
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

export async function getSupportTicketWithEvents({
  tenant_id,
  ticket_id,
  customer_visible = false,
  include_resolution = false,
}, options = {}) {
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
  const resolution = include_resolution
    ? await getSupportTicketResolution({ tenant_id, ticket_id, pool })
    : null;
  return {
    ticket: compactTicket(ticket),
    events: eventRows.map((row) => ({
      ...row,
      payload_json: parseJsonObject(row.payload_json, null),
      secrets_included: false,
    })),
    ...(include_resolution ? { resolution } : {}),
    secrets_included: false,
  };
}

function ticketTextForClassification(row = {}) {
  const metadata = typeof row.metadata_json === "string" ? row.metadata_json : JSON.stringify(row.metadata_json || {});
  return `${row.title || ""}\n${row.category || ""}\n${row.priority || ""}\n${metadata || ""}`.toLowerCase();
}

export function classifyExistingSupportTicket(row = {}) {
  const text = ticketTextForClassification(row);
  const rules = [
    {
      key: "brand_authority_missing",
      match: /brand[-_\s]?access|brand[-_\s]?mapping|workspace_brands_list|brand list|brand-authority|براند/i,
      patch: { ticket_type: "brand_authority_missing", source_event: "brand_authority_missing", category: "review_request", severity: "sev3", queue_key: "access_authority", lifecycle_state: "permission_review_required", customer_status: "under_review" },
    },
    {
      key: "hostinger_wordpress_provisioning",
      match: /hostinger|wordpress|deployment connector|provisioning|wovacation|hpanel/i,
      patch: { ticket_type: "managed_service_request", source_event: "hostinger_wordpress_provisioning", category: "managed_task", severity: "sev3", queue_key: "managed_services", lifecycle_state: "automation_planned", customer_status: "in_progress" },
    },
    {
      key: "device_install_runtime_bug",
      match: /localapps|device_install_failed|device installer backend|local_apps|device-install route/i,
      patch: { ticket_type: "platform_tool_surface_bug", source_event: "device_install_runtime_bug", category: "escalation", severity: "sev2", queue_key: "platform_engineering", lifecycle_state: "internal_review_required", customer_status: "under_review" },
    },
    {
      key: "tenant_onboarding_issue",
      match: /tenant onboarding|workspace_ready_not_activated|connect_escalate|activate|workspace_required/i,
      patch: { ticket_type: "tenant_onboarding_issue", source_event: "tenant_onboarding_issue", category: "escalation", severity: "sev3", queue_key: "tenant_support", lifecycle_state: "triage_pending", customer_status: "under_review" },
    },
    {
      key: "platform_facade_bug",
      match: /admin shell|alias passthrough|google docs|getdocument|facade|runtime_endpoint_call|schema validation/i,
      patch: { ticket_type: "platform_tool_surface_bug", source_event: "platform_facade_bug", category: "managed_task", severity: "sev2", queue_key: "platform_engineering", lifecycle_state: "internal_review_required", customer_status: "under_review" },
    },
  ];
  const matched = rules.find((rule) => rule.match.test(text));
  const patch = matched?.patch || { ticket_type: "general_support", source_event: "general_support", category: row.category || "support", severity: "sev4", queue_key: "tenant_support", lifecycle_state: "triage_pending", customer_status: "under_review" };
  const needs = {
    ticket_type: !row.ticket_type,
    source_event: !row.source_event,
    queue_key: !row.queue_key,
    assignment_status: !row.assignment_status || row.assignment_status === "unassigned",
    lifecycle_state: !row.lifecycle_state || row.lifecycle_state === "intake_received",
    customer_status: !row.customer_status || row.customer_status === "received",
    category: !row.category || row.category === "general" || (row.category === "escalation" && patch.category !== "escalation"),
    severity: !row.severity || row.severity === "sev3",
  };
  const should_update = Object.values(needs).some(Boolean);
  return { matched_rule: matched?.key || "fallback_general_support", patch, needs, should_update, secrets_included: false };
}

export async function reconcileOpenSupportTickets({ tenant_id = null, limit = 100, apply = false, actor_id = "ticket_reconciler", actor_type = "system" } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const max = Math.min(Math.max(Number(limit) || 100, 1), 250);
  const params = [];
  const filters = ["status IN ('open','in_review','awaiting_approval')"];
  if (tenant_id) { filters.push("tenant_id = ?"); params.push(tenant_id); }
  params.push(max);
  try {
    if (ownsConnection && apply) await connection.beginTransaction();
    const rows = await queryRows(
      connection,
      `SELECT * FROM tickets WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      params
    );
    const findings = [];
    for (const row of rows) {
      const classification = classifyExistingSupportTicket(row);
      const patch = classification.patch;
      const update = {
        ticket_type: classification.needs.ticket_type ? patch.ticket_type : row.ticket_type,
        source_event: classification.needs.source_event ? patch.source_event : row.source_event,
        category: classification.needs.category ? patch.category : row.category,
        severity: classification.needs.severity ? patch.severity : row.severity,
        queue_key: classification.needs.queue_key ? patch.queue_key : row.queue_key,
        lifecycle_state: classification.needs.lifecycle_state ? patch.lifecycle_state : row.lifecycle_state,
        customer_status: classification.needs.customer_status ? patch.customer_status : row.customer_status,
        assignment_status: classification.needs.assignment_status && patch.queue_key ? "queue_assigned" : row.assignment_status,
      };
      findings.push({ ticket_id: row.ticket_id, tenant_id: row.tenant_id, title: row.title, matched_rule: classification.matched_rule, should_update: classification.should_update, update, secrets_included: false });
      if (apply && classification.should_update) {
        await connection.query(
          `UPDATE tickets
              SET ticket_type = ?,
                  source_layer = COALESCE(NULLIF(source_layer, ''), 'legacy_reconciliation'),
                  source_tool = COALESCE(NULLIF(source_tool, ''), 'support_ticket_reconcile'),
                  source_event = ?,
                  category = ?,
                  severity = ?,
                  queue_key = ?,
                  lifecycle_state = ?,
                  customer_status = ?,
                  assignment_status = ?,
                  updated_at = NOW()
            WHERE ticket_id = ?`,
          [update.ticket_type, update.source_event, update.category, update.severity, update.queue_key, update.lifecycle_state, update.customer_status, update.assignment_status, row.ticket_id]
        );
        await insertLifecycleEvent(connection, {
          ticket_id: row.ticket_id,
          tenant_id: row.tenant_id,
          event_type: "legacy_reconciled",
          from_state: row.lifecycle_state || null,
          to_state: update.lifecycle_state || null,
          actor_id,
          actor_type,
          visibility: "internal_support",
          summary: `Legacy ticket classified by ${classification.matched_rule}.`,
          payload_json: { matched_rule: classification.matched_rule, update, previous: { ticket_type: row.ticket_type, queue_key: row.queue_key, lifecycle_state: row.lifecycle_state, customer_status: row.customer_status }, secrets_included: false },
        });
      }
    }
    if (ownsConnection && apply) await connection.commit();
    return { ok: true, mode: apply ? "apply" : "dry_run", count: findings.length, update_count: findings.filter((finding) => finding.should_update).length, findings, secrets_included: false };
  } catch (error) {
    if (ownsConnection && apply) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function linkSupportTicketWorkflow({ tenant_id, ticket_id, plan_id = null, run_id = null, approval_hold_id = null, relationship = "diagnostic", status = "linked", evidence_json = {}, actor_id = null, actor_type = "system" } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  if (!plan_id && !run_id && !approval_hold_id) {
    const err = new Error("At least one workflow link target is required.");
    err.status = 400;
    err.code = "workflow_link_target_required";
    throw err;
  }
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const linkId = randomUUID();
    await connection.query(
      `INSERT INTO ticket_workflow_links
         (link_id, ticket_id, tenant_id, plan_id, run_id, approval_hold_id, relationship, status, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [linkId, ticket_id, tenant_id, plan_id || null, run_id || null, approval_hold_id || null, relationship || "diagnostic", status || "linked", jsonOrNull({ ...evidence_json, secrets_included: false })]
    );
    await insertLifecycleEvent(connection, {
      ticket_id, tenant_id, event_type: approval_hold_id ? "approval_hold_linked" : "workflow_linked",
      from_state: ticket.lifecycle_state || null, to_state: ticket.lifecycle_state || null,
      actor_id, actor_type, visibility: "internal_support",
      summary: `Linked ticket to ${approval_hold_id ? "approval hold" : "workflow artifact"}.`,
      payload_json: { link_id: linkId, plan_id, run_id, approval_hold_id, relationship, status, evidence_json, secrets_included: false },
    });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_workflow_linked", after_json: { link_id: linkId, plan_id, run_id, approval_hold_id, relationship, status, secrets_included: false } });
    if (ownsConnection) await connection.commit();
    return { ok: true, link_id: linkId, ticket_id, tenant_id, plan_id: plan_id || null, run_id: run_id || null, approval_hold_id: approval_hold_id || null, relationship, status, secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function createSupportTicketApprovalHold({ tenant_id, ticket_id, hold_type = "review", required_role = "workspace_owner_admin", assigned_to = null, reason = "Approval required for support ticket action.", expires_at = null, actor_id = null, actor_type = "system", evidence_json = {} } = {}, options = {}) {
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
    const holdId = randomUUID();
    const runId = randomUUID();
    const allowedHoldType = ["review", "supervisor_approval", "managed_handoff", "legal_hold"].includes(hold_type) ? hold_type : "review";
    await connection.query(
      `INSERT INTO approval_holds
         (hold_id, run_id, tenant_id, hold_type, requested_by, user_id, actor_id, actor_type, request_id, correlation_id, execution_context_json, assigned_to, required_role, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [holdId, runId, tenant_id, allowedHoldType, actor_id || null, ticket.user_id || null, actor_id || null, actor_type || null, ticket_id, `ticket:${ticket_id}`, jsonOrNull({ ticket_id, reason, evidence_json, customer_status: ticket.customer_status, lifecycle_state: ticket.lifecycle_state, secrets_included: false }), assigned_to || null, required_role || null, expires_at || null]
    );
    await connection.query(
      `UPDATE tickets
          SET status = 'awaiting_approval', lifecycle_state = 'awaiting_internal_approval', customer_status = 'waiting_for_approval', updated_at = NOW()
        WHERE tenant_id = ? AND ticket_id = ?`,
      [tenant_id, ticket_id]
    );
    await connection.query(
      `INSERT INTO ticket_workflow_links
         (link_id, ticket_id, tenant_id, approval_hold_id, relationship, status, evidence_json)
       VALUES (?, ?, ?, ?, 'approval_gate', 'linked', ?)`,
      [randomUUID(), ticket_id, tenant_id, holdId, jsonOrNull({ hold_type: allowedHoldType, required_role, reason, evidence_json, secrets_included: false })]
    );
    await insertLifecycleEvent(connection, {
      ticket_id, tenant_id, event_type: "approval_hold_created", from_state: ticket.lifecycle_state || null, to_state: "awaiting_internal_approval",
      actor_id, actor_type, visibility: "internal_support", summary: reason,
      payload_json: { hold_id: holdId, run_id: runId, hold_type: allowedHoldType, required_role, assigned_to, evidence_json, secrets_included: false },
    });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_approval_hold_created", after_json: { hold_id: holdId, hold_type: allowedHoldType, required_role, assigned_to, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, hold_id: holdId, run_id: runId, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

function computeTicketSlaStatus(row = {}, now = new Date()) {
  if (![...OPEN_TICKET_STATUSES].includes(row.status)) return { status: row.sla_status || "on_track", reason: "ticket_not_open" };
  const dueFields = ["first_response_due_at", "triage_due_at", "resolution_due_at"];
  const dueDates = dueFields.map((field) => ({ field, value: row[field] ? new Date(row[field]) : null })).filter((entry) => entry.value && !Number.isNaN(entry.value.getTime()));
  if (!dueDates.length) return { status: "on_track", reason: "no_due_dates" };
  const breached = dueDates.find((entry) => entry.value.getTime() < now.getTime());
  if (breached) return { status: "breached", reason: `${breached.field}_past_due` };
  const soon = dueDates.find((entry) => entry.value.getTime() - now.getTime() <= 60 * 60 * 1000);
  if (soon) return { status: "warning", reason: `${soon.field}_within_60m` };
  return { status: "on_track", reason: "due_dates_on_track" };
}

export async function reconcileSupportTicketSla({ tenant_id = null, limit = 100, apply = false, actor_id = "ticket_sla_reconciler", actor_type = "system" } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const max = Math.min(Math.max(Number(limit) || 100, 1), 250);
  const params = [];
  const filters = ["status IN ('open','in_review','awaiting_approval')"];
  if (tenant_id) { filters.push("tenant_id = ?"); params.push(tenant_id); }
  params.push(max);
  try {
    if (ownsConnection && apply) await connection.beginTransaction();
    const rows = await queryRows(connection, `SELECT * FROM tickets WHERE ${filters.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`, params);
    const now = new Date();
    const findings = [];
    for (const row of rows) {
      const computed = computeTicketSlaStatus(row, now);
      const should_update = computed.status !== (row.sla_status || "on_track");
      findings.push({ ticket_id: row.ticket_id, tenant_id: row.tenant_id, title: row.title, current_sla_status: row.sla_status || "on_track", computed_sla_status: computed.status, reason: computed.reason, should_update, secrets_included: false });
      if (apply && should_update) {
        await connection.query("UPDATE tickets SET sla_status = ?, updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [computed.status, row.tenant_id, row.ticket_id]);
        await insertLifecycleEvent(connection, {
          ticket_id: row.ticket_id, tenant_id: row.tenant_id, event_type: computed.status === "breached" ? "sla_breached" : "sla_status_changed",
          from_state: row.sla_status || "on_track", to_state: computed.status,
          actor_id, actor_type, visibility: "internal_support",
          summary: `SLA status changed to ${computed.status}: ${computed.reason}.`,
          payload_json: { reason: computed.reason, previous_sla_status: row.sla_status || "on_track", computed_sla_status: computed.status, secrets_included: false },
        });
      }
    }
    if (ownsConnection && apply) await connection.commit();
    return { ok: true, mode: apply ? "apply" : "dry_run", count: findings.length, update_count: findings.filter((finding) => finding.should_update).length, findings, secrets_included: false };
  } catch (error) {
    if (ownsConnection && apply) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

function executionPlanTemplateForTicket(ticket = {}) {
  const type = ticket.ticket_type || ticket.source_event || "general_support";
  const templates = {
    brand_authority_missing: {
      intent_key: "ticket.brand_authority_diagnostic",
      workflow_key: "workspace_brand_authority_diagnostic",
      target_key: "access_authority",
      route_key: "support_ticket_access_authority_diagnostic",
      access_decision: "REQUIRE_REVIEW",
      steps: [
        { key: "read_workspace_membership", action: "verify requester workspace membership and role" },
        { key: "read_brand_grants", action: "inspect v_workspace_resource_grant_effective for brand grants" },
        { key: "read_workspace_assets", action: "inspect workspace_assets.brand_ref for orphaned references" },
        { key: "recommend_mapping_fix", action: "produce customer-safe mapping recommendation" },
      ],
    },
    hostinger_wordpress_provisioning: {
      intent_key: "ticket.hostinger_wordpress_provisioning_plan",
      workflow_key: "managed_hostinger_wordpress_provisioning",
      target_key: "managed_services",
      route_key: "support_ticket_managed_hostinger_provisioning",
      access_decision: "ROUTE_TO_MANAGED_SERVICE",
      steps: [
        { key: "verify_site_scope", action: "verify tenant/site authority" },
        { key: "verify_credentials", action: "verify credential references without exposing secrets" },
        { key: "prepare_deployment", action: "prepare WordPress installation plan" },
        { key: "request_approval", action: "create approval hold before destructive/provisioning action" },
      ],
    },
    platform_tool_surface_bug: {
      intent_key: "ticket.platform_tool_surface_remediation",
      workflow_key: "platform_tool_surface_bug_remediation",
      target_key: "platform_engineering",
      route_key: "support_ticket_platform_engineering_remediation",
      access_decision: "REQUIRE_REVIEW",
      steps: [
        { key: "capture_repro", action: "capture route/tool/schema evidence" },
        { key: "add_regression", action: "add regression test for tool surface" },
        { key: "patch_surface", action: "patch governed route or registry surface" },
        { key: "verify_release", action: "run release readiness and live smoke" },
      ],
    },
    tenant_onboarding_issue: {
      intent_key: "ticket.tenant_onboarding_diagnostic",
      workflow_key: "tenant_onboarding_recovery_diagnostic",
      target_key: "tenant_support",
      route_key: "support_ticket_tenant_onboarding_diagnostic",
      access_decision: "REQUIRE_REVIEW",
      steps: [
        { key: "read_onboarding_state", action: "inspect onboarding state and workspace readiness" },
        { key: "verify_membership", action: "verify user membership and workspace access" },
        { key: "recommend_next_action", action: "recommend activation/device/escalation next action" },
      ],
    },
    general_support: {
      intent_key: "ticket.general_support_review",
      workflow_key: "support_ticket_general_review",
      target_key: "tenant_support",
      route_key: "support_ticket_general_review",
      access_decision: "REQUIRE_REVIEW",
      steps: [
        { key: "review_ticket", action: "review ticket evidence" },
        { key: "recommend_next_action", action: "recommend customer-safe next action" },
      ],
    },
  };
  return templates[type] || templates[ticket.source_event] || templates.general_support;
}

export async function createSupportTicketExecutionPlan({ tenant_id, ticket_id, workflow_key = null, intent_key = null, target_key = null, route_key = null, service_mode = "managed", access_decision = null, steps_json = null, preview_json = null, actor_id = null, actor_type = "system", reason = "Execution plan created from support ticket.", evidence_json = {} } = {}, options = {}) {
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
    const template = executionPlanTemplateForTicket(ticket);
    const planId = randomUUID();
    const finalWorkflowKey = workflow_key || template.workflow_key;
    const finalIntentKey = intent_key || template.intent_key;
    const finalTargetKey = target_key || template.target_key;
    const finalRouteKey = route_key || template.route_key;
    const finalAccessDecision = access_decision || template.access_decision || "REQUIRE_REVIEW";
    const finalSteps = steps_json || template.steps || [];
    const finalPreview = preview_json || {
      ticket_id,
      ticket_type: ticket.ticket_type || null,
      source_event: ticket.source_event || null,
      queue_key: ticket.queue_key || null,
      reason,
      evidence_json,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO execution_plans
         (plan_id, tenant_id, user_id, actor_id, actor_type, intent_key, request_id, correlation_id, execution_context_json, target_key, workflow_key, route_key, service_mode, access_decision, plan_status, steps_json, preview_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [planId, tenant_id, ticket.user_id || null, actor_id || null, actor_type || null, finalIntentKey, ticket_id, `ticket:${ticket_id}`, jsonOrNull({ ticket_id, source: "support_ticket", ticket_type: ticket.ticket_type, lifecycle_state: ticket.lifecycle_state, customer_status: ticket.customer_status, evidence_json, secrets_included: false }), finalTargetKey, finalWorkflowKey, finalRouteKey, service_mode || ticket.service_mode || "managed", finalAccessDecision, jsonOrNull(finalSteps), jsonOrNull(finalPreview)]
    );
    await connection.query(
      `INSERT INTO ticket_workflow_links
         (link_id, ticket_id, tenant_id, plan_id, relationship, status, evidence_json)
       VALUES (?, ?, ?, ?, 'execution_plan', 'linked', ?)`,
      [randomUUID(), ticket_id, tenant_id, planId, jsonOrNull({ workflow_key: finalWorkflowKey, intent_key: finalIntentKey, route_key: finalRouteKey, target_key: finalTargetKey, reason, evidence_json, secrets_included: false })]
    );
    await connection.query(
      `UPDATE tickets
          SET lifecycle_state = CASE WHEN lifecycle_state IN ('triage_pending','automation_planned','permission_review_required','internal_review_required') THEN 'automation_planned' ELSE lifecycle_state END,
              customer_status = CASE WHEN customer_status IN ('received','under_review') THEN 'in_progress' ELSE customer_status END,
              updated_at = NOW()
        WHERE tenant_id = ? AND ticket_id = ?`,
      [tenant_id, ticket_id]
    );
    await insertLifecycleEvent(connection, {
      ticket_id,
      tenant_id,
      event_type: "execution_plan_created",
      from_state: ticket.lifecycle_state || null,
      to_state: ticket.lifecycle_state === "awaiting_internal_approval" ? ticket.lifecycle_state : "automation_planned",
      actor_id,
      actor_type,
      visibility: "internal_support",
      summary: reason,
      payload_json: { plan_id: planId, workflow_key: finalWorkflowKey, intent_key: finalIntentKey, target_key: finalTargetKey, route_key: finalRouteKey, access_decision: finalAccessDecision, secrets_included: false },
    });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_execution_plan_created", after_json: { plan_id: planId, workflow_key: finalWorkflowKey, intent_key: finalIntentKey, target_key: finalTargetKey, access_decision: finalAccessDecision, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, plan_id: planId, workflow_key: finalWorkflowKey, intent_key: finalIntentKey, target_key: finalTargetKey, route_key: finalRouteKey, access_decision: finalAccessDecision, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

async function resolveTicketExecutionPlan(connection, { tenant_id, ticket_id, plan_id = null }) {
  if (plan_id) {
    const plan = await queryOne(connection, "SELECT * FROM execution_plans WHERE tenant_id = ? AND plan_id = ? LIMIT 1", [tenant_id, plan_id]);
    if (plan) return plan;
  }
  const linked = await queryOne(
    connection,
    `SELECT ep.*
       FROM ticket_workflow_links twl
       JOIN execution_plans ep ON ep.plan_id = twl.plan_id AND ep.tenant_id = twl.tenant_id
      WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.plan_id IS NOT NULL
      ORDER BY twl.created_at DESC
      LIMIT 1`,
    [tenant_id, ticket_id]
  );
  if (linked) return linked;
  return await queryOne(
    connection,
    "SELECT * FROM execution_plans WHERE tenant_id = ? AND request_id = ? ORDER BY created_at DESC LIMIT 1",
    [tenant_id, ticket_id]
  );
}

function ticketStateFromRuntime({ run = null, plan = null, hold = null } = {}) {
  if (hold?.status === "open") return { status: "awaiting_approval", lifecycle_state: "awaiting_internal_approval", customer_status: "waiting_for_approval", reason: "approval_hold_open" };
  if (hold?.status === "rejected") return { status: "in_review", lifecycle_state: "blocked", customer_status: "under_review", reason: "approval_hold_rejected" };
  if (run?.status === "completed" || plan?.plan_status === "completed") return { status: "resolved", lifecycle_state: "verified", customer_status: "resolved", reason: "workflow_completed" };
  if (run?.status === "failed" || plan?.plan_status === "failed") return { status: "in_review", lifecycle_state: "verification_failed", customer_status: "under_review", reason: "workflow_failed" };
  if (run?.status === "cancelled" || plan?.plan_status === "cancelled") return { status: "closed", lifecycle_state: "cancelled", customer_status: "closed", reason: "workflow_cancelled" };
  if (["running", "pending"].includes(run?.status) || plan?.plan_status === "executing") return { status: "in_review", lifecycle_state: "automation_running", customer_status: "in_progress", reason: "workflow_running" };
  if (plan?.plan_status === "approved") return { status: "in_review", lifecycle_state: "automation_planned", customer_status: "in_progress", reason: "plan_approved" };
  return { status: null, lifecycle_state: null, customer_status: null, reason: "no_runtime_status_change" };
}

export async function createSupportTicketWorkflowRun({ tenant_id, ticket_id, plan_id = null, status = "pending", current_step = null, input_json = null, actor_id = null, actor_type = "system", reason = "Workflow run created from support ticket execution plan.", evidence_json = {} } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const validStatus = ["pending", "running", "awaiting_approval", "awaiting_review", "paused"].includes(status) ? status : "pending";
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const plan = await resolveTicketExecutionPlan(connection, { tenant_id, ticket_id, plan_id });
    if (!plan) {
      const err = new Error("Execution plan not found for ticket.");
      err.status = 404;
      err.code = "support_ticket_execution_plan_not_found";
      throw err;
    }
    const runId = randomUUID();
    const initialState = initialWorkflowStateForPlan(plan, validStatus);
    const finalInput = input_json || {
      ticket_id,
      plan_id: plan.plan_id,
      workflow_key: plan.workflow_key,
      intent_key: plan.intent_key,
      source: "support_ticket_workflow_run",
      evidence_json,
      secrets_included: false,
    };
    await connection.query(
      `INSERT INTO workflow_runs
         (run_id, tenant_id, user_id, actor_id, actor_type, request_id, correlation_id, execution_context_json, workflow_key, agent_id, plan_id, service_mode, status, current_step, input_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'running' THEN NOW() ELSE NULL END)`,
      [runId, tenant_id, ticket.user_id || plan.user_id || null, actor_id || null, actor_type || null, ticket_id, `ticket:${ticket_id}`, jsonOrNull({ ticket_id, plan_id: plan.plan_id, source: "support_ticket", reason, evidence_json, secrets_included: false }), plan.workflow_key, plan.agent_id || null, plan.plan_id, plan.service_mode || ticket.service_mode || "managed", initialState.run_status, current_step || null, jsonOrNull(finalInput), initialState.run_status]
    );
    await connection.query("UPDATE execution_plans SET plan_status = ?, updated_at = NOW() WHERE tenant_id = ? AND plan_id = ?", [initialState.plan_status, tenant_id, plan.plan_id]);
    await connection.query(
      `INSERT INTO ticket_workflow_links
         (link_id, ticket_id, tenant_id, plan_id, run_id, relationship, status, evidence_json)
       VALUES (?, ?, ?, ?, ?, 'workflow_run', 'linked', ?)`,
      [randomUUID(), ticket_id, tenant_id, plan.plan_id, runId, jsonOrNull({ workflow_key: plan.workflow_key, status: initialState.run_status, reason, evidence_json, secrets_included: false })]
    );
    await connection.query(
      `UPDATE tickets
          SET status = COALESCE(?, status), lifecycle_state = COALESCE(?, lifecycle_state), customer_status = COALESCE(?, customer_status), updated_at = NOW()
        WHERE tenant_id = ? AND ticket_id = ?`,
      [initialState.ticket_status, initialState.lifecycle_state, initialState.customer_status, tenant_id, ticket_id]
    );
    await insertLifecycleEvent(connection, {
      ticket_id,
      tenant_id,
      event_type: "workflow_run_created",
      from_state: ticket.lifecycle_state || null,
      to_state: initialState.lifecycle_state || ticket.lifecycle_state || null,
      actor_id,
      actor_type,
      visibility: "internal_support",
      summary: reason,
      payload_json: { run_id: runId, plan_id: plan.plan_id, workflow_key: plan.workflow_key, status: initialState.run_status, runtime_state: initialState, secrets_included: false },
    });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_workflow_run_created", after_json: { run_id: runId, plan_id: plan.plan_id, workflow_key: plan.workflow_key, status: initialState.run_status, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, run_id: runId, plan_id: plan.plan_id, workflow_key: plan.workflow_key, status: initialState.run_status, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function syncSupportTicketRuntimeStatus({ tenant_id, ticket_id, run_id = null, plan_id = null, approval_hold_id = null, actor_id = null, actor_type = "system", reason = "Runtime status synchronized to support ticket." } = {}, options = {}) {
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
    const run = run_id
      ? await queryOne(connection, "SELECT * FROM workflow_runs WHERE tenant_id = ? AND run_id = ? LIMIT 1", [tenant_id, run_id])
      : await queryOne(connection, `SELECT wr.* FROM ticket_workflow_links twl JOIN workflow_runs wr ON wr.run_id = twl.run_id AND wr.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.run_id IS NOT NULL ORDER BY twl.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    const plan = plan_id
      ? await queryOne(connection, "SELECT * FROM execution_plans WHERE tenant_id = ? AND plan_id = ? LIMIT 1", [tenant_id, plan_id])
      : run?.plan_id ? await queryOne(connection, "SELECT * FROM execution_plans WHERE tenant_id = ? AND plan_id = ? LIMIT 1", [tenant_id, run.plan_id]) : await resolveTicketExecutionPlan(connection, { tenant_id, ticket_id });
    const hold = approval_hold_id
      ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, approval_hold_id])
      : await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.approval_hold_id IS NOT NULL ORDER BY twl.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    const next = ticketStateFromRuntime({ run, plan, hold });
    const changed = Boolean(next.status || next.lifecycle_state || next.customer_status) && (next.status !== ticket.status || next.lifecycle_state !== ticket.lifecycle_state || next.customer_status !== ticket.customer_status);
    if (changed) {
      await connection.query(
        `UPDATE tickets SET status = COALESCE(?, status), lifecycle_state = COALESCE(?, lifecycle_state), customer_status = COALESCE(?, customer_status), updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?`,
        [next.status, next.lifecycle_state, next.customer_status, tenant_id, ticket_id]
      );
      await insertLifecycleEvent(connection, {
        ticket_id,
        tenant_id,
        event_type: "runtime_status_synced",
        from_state: ticket.lifecycle_state || null,
        to_state: next.lifecycle_state || null,
        actor_id,
        actor_type,
        visibility: "internal_support",
        summary: `${reason} (${next.reason})`,
        payload_json: { reason: next.reason, run_id: run?.run_id || null, run_status: run?.status || null, plan_id: plan?.plan_id || null, plan_status: plan?.plan_status || null, approval_hold_id: hold?.hold_id || null, approval_status: hold?.status || null, secrets_included: false },
      });
      await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_runtime_status_synced", after_json: { next, run_id: run?.run_id || null, plan_id: plan?.plan_id || null, approval_hold_id: hold?.hold_id || null, secrets_included: false } });
    }
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, changed, reason: next.reason, run: run ? { run_id: run.run_id, status: run.status } : null, plan: plan ? { plan_id: plan.plan_id, plan_status: plan.plan_status } : null, approval_hold: hold ? { hold_id: hold.hold_id, status: hold.status } : null, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

function normalizePlanSteps(stepsJson) {
  const parsed = parseJsonObject(stepsJson, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((step, index) => ({
    key: normalizeString(step?.key || step?.step_key || `step_${index + 1}`).slice(0, 128),
    action: normalizeString(step?.action || step?.description || step?.label || "Execute step"),
    type: ["action", "review", "approval", "managed_op", "branch", "wait", "end"].includes(step?.type) ? step.type : "action",
    index,
    raw: sanitizeTicketMetadata(step),
  })).filter((step) => step.key);
}

function workflowStateFromSteps({ run = null, stepRows = [] } = {}) {
  const total = stepRows.length;
  const failed = stepRows.find((row) => row.status === "failed");
  if (failed) return { run_status: "failed", plan_status: "failed", ticket_status: "in_review", lifecycle_state: "verification_failed", customer_status: "under_review", current_step: failed.step_key, reason: "step_failed" };
  const running = stepRows.find((row) => row.status === "running");
  if (running) return { run_status: "running", plan_status: "executing", ticket_status: "in_review", lifecycle_state: "automation_running", customer_status: "in_progress", current_step: running.step_key, reason: "step_running" };
  const awaiting = stepRows.find((row) => row.status === "awaiting");
  if (awaiting) return { run_status: "awaiting_review", plan_status: "executing", ticket_status: "in_review", lifecycle_state: "awaiting_internal_approval", customer_status: "waiting_for_approval", current_step: awaiting.step_key, reason: "step_awaiting" };
  const pending = stepRows.find((row) => row.status === "pending");
  if (pending) return { run_status: run?.status === "running" ? "running" : "pending", plan_status: "executing", ticket_status: "in_review", lifecycle_state: "automation_running", customer_status: "in_progress", current_step: pending.step_key, reason: "step_pending" };
  if (total > 0 && stepRows.every((row) => ["completed", "skipped"].includes(row.status))) return { run_status: "completed", plan_status: "completed", ticket_status: "resolved", lifecycle_state: "verified", customer_status: "resolved", current_step: null, reason: "all_steps_completed" };
  return { run_status: run?.status || "pending", plan_status: null, ticket_status: null, lifecycle_state: null, customer_status: null, current_step: run?.current_step || null, reason: "no_steps" };
}

export function initialWorkflowStateForPlan(plan = {}, requestedRunStatus = "running") {
  const accessDecision = normalizeString(plan.access_decision).toUpperCase();
  const approvalRequired = requestedRunStatus === "awaiting_approval"
    || ["REQUIRE_SUPERVISOR_APPROVAL", "REQUIRE_REVIEW"].includes(accessDecision);
  const runStatus = approvalRequired ? "awaiting_approval" : requestedRunStatus;
  const planStatus = approvalRequired ? "awaiting_approval" : "executing";
  const ticketState = approvalRequired
    ? {
        status: "awaiting_approval",
        lifecycle_state: "awaiting_internal_approval",
        customer_status: "waiting_for_approval",
        reason: "approval_required",
      }
    : ticketStateFromRuntime({ run: { status: runStatus }, plan: { plan_status: planStatus } });
  return {
    approval_required: approvalRequired,
    run_status: runStatus,
    plan_status: planStatus,
    ticket_status: ticketState.status,
    lifecycle_state: ticketState.lifecycle_state,
    customer_status: ticketState.customer_status,
    reason: ticketState.reason,
    started_at_allowed: !approvalRequired,
  };
}

export async function createSupportTicketStepRuns({ tenant_id, ticket_id, run_id = null, plan_id = null, actor_id = null, actor_type = "system", reason = "Step runs created from support ticket workflow run.", evidence_json = {} } = {}, options = {}) {
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
    const run = run_id
      ? await queryOne(connection, "SELECT * FROM workflow_runs WHERE tenant_id = ? AND run_id = ? LIMIT 1", [tenant_id, run_id])
      : await queryOne(connection, `SELECT wr.* FROM ticket_workflow_links twl JOIN workflow_runs wr ON wr.run_id = twl.run_id AND wr.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.run_id IS NOT NULL ORDER BY twl.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    if (!run) {
      const err = new Error("Workflow run not found for ticket.");
      err.status = 404;
      err.code = "support_ticket_workflow_run_not_found";
      throw err;
    }
    const plan = plan_id
      ? await queryOne(connection, "SELECT * FROM execution_plans WHERE tenant_id = ? AND plan_id = ? LIMIT 1", [tenant_id, plan_id])
      : run.plan_id ? await queryOne(connection, "SELECT * FROM execution_plans WHERE tenant_id = ? AND plan_id = ? LIMIT 1", [tenant_id, run.plan_id]) : await resolveTicketExecutionPlan(connection, { tenant_id, ticket_id });
    if (!plan) {
      const err = new Error("Execution plan not found for workflow run.");
      err.status = 404;
      err.code = "support_ticket_execution_plan_not_found";
      throw err;
    }
    const steps = normalizePlanSteps(plan.steps_json);
    if (!steps.length) {
      const err = new Error("Execution plan has no steps to create.");
      err.status = 400;
      err.code = "support_ticket_plan_steps_missing";
      throw err;
    }
    const existing = await queryRows(connection, "SELECT step_key FROM step_runs WHERE tenant_id = ? AND run_id = ?", [tenant_id, run.run_id]);
    const existingKeys = new Set(existing.map((row) => row.step_key));
    const created = [];
    for (const step of steps) {
      if (existingKeys.has(step.key)) continue;
      const stepRunId = randomUUID();
      await connection.query(
        `INSERT INTO step_runs
           (step_run_id, run_id, user_id, actor_id, actor_type, request_id, correlation_id, execution_context_json, tenant_id, step_key, step_type, status, input_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [stepRunId, run.run_id, ticket.user_id || run.user_id || null, actor_id || null, actor_type || null, ticket_id, `ticket:${ticket_id}`, jsonOrNull({ ticket_id, plan_id: plan.plan_id, run_id: run.run_id, step, source: "support_ticket_step_runs", evidence_json, secrets_included: false }), tenant_id, step.key, step.type, jsonOrNull({ action: step.action, step_index: step.index, step: step.raw, secrets_included: false })]
      );
      created.push({ step_run_id: stepRunId, step_key: step.key, step_type: step.type, status: "pending" });
    }
    const firstStep = created[0]?.step_key || steps[0]?.key || null;
    const initialState = initialWorkflowStateForPlan(plan, "running");
    await connection.query("UPDATE workflow_runs SET status = ?, current_step = COALESCE(current_step, ?), started_at = CASE WHEN ? = 1 THEN COALESCE(started_at, NOW()) ELSE NULL END, updated_at = NOW() WHERE tenant_id = ? AND run_id = ?", [initialState.run_status, firstStep, initialState.started_at_allowed ? 1 : 0, tenant_id, run.run_id]);
    await connection.query("UPDATE execution_plans SET plan_status = ?, updated_at = NOW() WHERE tenant_id = ? AND plan_id = ?", [initialState.plan_status, tenant_id, plan.plan_id]);
    await connection.query("UPDATE tickets SET status = ?, lifecycle_state = ?, customer_status = ?, updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [initialState.ticket_status, initialState.lifecycle_state, initialState.customer_status, tenant_id, ticket_id]);
    await insertLifecycleEvent(connection, {
      ticket_id,
      tenant_id,
      event_type: "step_runs_created",
      from_state: ticket.lifecycle_state || null,
      to_state: initialState.lifecycle_state,
      actor_id,
      actor_type,
      visibility: "internal_support",
      summary: reason,
      payload_json: { run_id: run.run_id, plan_id: plan.plan_id, created_count: created.length, step_keys: created.map((step) => step.step_key), runtime_state: initialState, evidence_json, secrets_included: false },
    });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_step_runs_created", after_json: { run_id: run.run_id, plan_id: plan.plan_id, created_count: created.length, runtime_state: initialState, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, run_id: run.run_id, plan_id: plan.plan_id, created_count: created.length, steps: created, runtime_state: initialState, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function updateSupportTicketStepRun({ tenant_id, ticket_id, step_run_id = null, run_id = null, step_key = null, status, output_json = null, error_message = null, actor_id = null, actor_type = "system", reason = "Step run status updated." } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const validStatus = ["pending", "running", "completed", "failed", "skipped", "awaiting"].includes(status) ? status : null;
  if (!validStatus) {
    const err = new Error("Valid step status is required.");
    err.status = 400;
    err.code = "support_ticket_step_status_invalid";
    throw err;
  }
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const params = [tenant_id];
    const filters = ["tenant_id = ?"];
    if (step_run_id) { filters.push("step_run_id = ?"); params.push(step_run_id); }
    else {
      if (run_id) { filters.push("run_id = ?"); params.push(run_id); }
      if (step_key) { filters.push("step_key = ?"); params.push(step_key); }
    }
    const stepRun = await queryOne(connection, `SELECT * FROM step_runs WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT 1`, params);
    if (!stepRun) {
      const err = new Error("Step run not found.");
      err.status = 404;
      err.code = "support_ticket_step_run_not_found";
      throw err;
    }
    await connection.query(
      `UPDATE step_runs
          SET status = ?, output_json = COALESCE(?, output_json), error_message = ?,
              started_at = CASE WHEN ? = 'running' THEN COALESCE(started_at, NOW()) ELSE started_at END,
              completed_at = CASE WHEN ? IN ('completed','failed','skipped') THEN NOW() ELSE completed_at END
        WHERE tenant_id = ? AND step_run_id = ?`,
      [validStatus, jsonOrNull(output_json), error_message || null, validStatus, validStatus, tenant_id, stepRun.step_run_id]
    );
    const run = await queryOne(connection, "SELECT * FROM workflow_runs WHERE tenant_id = ? AND run_id = ? LIMIT 1", [tenant_id, stepRun.run_id]);
    const stepRows = await queryRows(connection, "SELECT * FROM step_runs WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC", [tenant_id, stepRun.run_id]);
    const mergedRows = stepRows.map((row) => row.step_run_id === stepRun.step_run_id ? { ...row, status: validStatus } : row);
    const next = workflowStateFromSteps({ run, stepRows: mergedRows });
    await connection.query(
      `UPDATE workflow_runs
          SET status = ?, current_step = ?, completed_at = CASE WHEN ? IN ('completed','failed','cancelled') THEN NOW() ELSE completed_at END, updated_at = NOW()
        WHERE tenant_id = ? AND run_id = ?`,
      [next.run_status, next.current_step || null, next.run_status, tenant_id, stepRun.run_id]
    );
    if (run?.plan_id && next.plan_status) {
      await connection.query("UPDATE execution_plans SET plan_status = ?, updated_at = NOW() WHERE tenant_id = ? AND plan_id = ?", [next.plan_status, tenant_id, run.plan_id]);
    }
    await connection.query(
      `UPDATE tickets SET status = COALESCE(?, status), lifecycle_state = COALESCE(?, lifecycle_state), customer_status = COALESCE(?, customer_status), updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?`,
      [next.ticket_status, next.lifecycle_state, next.customer_status, tenant_id, ticket_id]
    );
    await insertLifecycleEvent(connection, {
      ticket_id,
      tenant_id,
      event_type: "step_run_updated",
      from_state: ticket.lifecycle_state || null,
      to_state: next.lifecycle_state || ticket.lifecycle_state || null,
      actor_id,
      actor_type,
      visibility: "internal_support",
      summary: reason,
      payload_json: { step_run_id: stepRun.step_run_id, step_key: stepRun.step_key, step_status: validStatus, run_id: stepRun.run_id, runtime_state: next, output_json, error_message, secrets_included: false },
    });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_step_run_updated", after_json: { step_run_id: stepRun.step_run_id, step_key: stepRun.step_key, status: validStatus, run_id: stepRun.run_id, runtime_state: next, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, step_run_id: stepRun.step_run_id, step_key: stepRun.step_key, status: validStatus, run_id: stepRun.run_id, runtime_state: next, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

function requesterUserIdForDiagnostic(ticket = {}, run = {}) {
  const metadata = parseJsonObject(ticket.metadata_json, {});
  return ticket.user_id || run.user_id || metadata?.metadata?.user_id || metadata?.user_id || metadata?.requester_user_id || "";
}

async function buildDiagnosticStepOutput(connection, { tenant_id, ticket, run, plan, stepRun }) {
  const stepKey = stepRun.step_key;
  const requesterUserId = requesterUserIdForDiagnostic(ticket, run);
  if (stepKey === "read_workspace_membership") {
    const rows = await queryRows(
      connection,
      `SELECT m.user_id, m.tenant_id, m.role, m.status, m.granted_at, m.updated_at, t.display_name AS tenant_display_name, t.status AS tenant_status
         FROM memberships m
         JOIN tenants t ON t.tenant_id = m.tenant_id
        WHERE m.tenant_id = ? AND m.user_id = ?
        ORDER BY m.updated_at DESC
        LIMIT 10`,
      [tenant_id, requesterUserId]
    );
    return {
      diagnostic_key: stepKey,
      status: rows.some((row) => row.status === "active") ? "passed" : "needs_review",
      membership_count: rows.length,
      active_membership_count: rows.filter((row) => row.status === "active").length,
      memberships: rows,
      recommendation: rows.some((row) => row.status === "active") ? "Requester has active workspace membership." : "Review requester workspace membership before changing brand authority.",
      secrets_included: false,
    };
  }

  if (stepKey === "read_brand_grants") {
    const rows = await queryRows(
      connection,
      `SELECT grant_id, tenant_id, grantee_user_id, grantee_email, membership_role, membership_status, resource_type, resource_ref, permission, grant_status, source, granted_at, expires_at
         FROM v_workspace_resource_grant_effective
        WHERE tenant_id = ? AND grantee_user_id = ? AND resource_type = 'brand'
        ORDER BY granted_at DESC
        LIMIT 50`,
      [tenant_id, requesterUserId]
    );
    return {
      diagnostic_key: stepKey,
      status: rows.some((row) => row.grant_status === "active") ? "passed" : "needs_mapping_review",
      brand_grant_count: rows.length,
      active_brand_grant_count: rows.filter((row) => row.grant_status === "active").length,
      grants: rows,
      recommendation: rows.length ? "Review active brand grant coverage against expected brand list." : "No effective brand grants found for requester; map brand authority before presenting brand list.",
      secrets_included: false,
    };
  }

  if (stepKey === "read_workspace_assets") {
    const rows = await queryRows(
      connection,
      `SELECT asset_id, tenant_id, asset_type, asset_ref, display_name, brand_ref, site_ref, workflow_ref, visibility, lifecycle_status, created_at, updated_at
         FROM workspace_assets
        WHERE tenant_id = ? AND brand_ref IS NOT NULL AND brand_ref <> ''
        ORDER BY updated_at DESC
        LIMIT 50`,
      [tenant_id]
    );
    return {
      diagnostic_key: stepKey,
      status: rows.length ? "references_found" : "no_brand_references_found",
      brand_reference_count: rows.length,
      brand_refs: [...new Set(rows.map((row) => row.brand_ref).filter(Boolean))],
      assets: rows,
      recommendation: rows.length ? "Brand references exist in workspace assets; compare them with effective grants before exposing brand names." : "No brand references found in workspace assets.",
      secrets_included: false,
    };
  }

  if (stepKey === "recommend_mapping_fix") {
    const priorSteps = await queryRows(
      connection,
      `SELECT step_key, status, output_json
         FROM step_runs
        WHERE tenant_id = ? AND run_id = ?
        ORDER BY created_at ASC`,
      [tenant_id, run.run_id]
    );
    const prior = priorSteps.map((row) => ({ step_key: row.step_key, status: row.status, output: parseJsonObject(row.output_json, {}) }));
    const grants = prior.find((row) => row.step_key === "read_brand_grants")?.output || {};
    const assets = prior.find((row) => row.step_key === "read_workspace_assets")?.output || {};
    const activeGrantCount = Number(grants.active_brand_grant_count || 0);
    const assetBrandRefs = Array.isArray(assets.brand_refs) ? assets.brand_refs : [];
    const needsMapping = activeGrantCount === 0 || assetBrandRefs.length > activeGrantCount;
    return {
      diagnostic_key: stepKey,
      status: needsMapping ? "mapping_review_required" : "mapping_appears_consistent",
      active_brand_grant_count: activeGrantCount,
      asset_brand_refs: assetBrandRefs,
      recommendation: needsMapping
        ? "Create or repair workspace brand grants for the requester before answering brand-list questions. Do not use diagnostic platform counts as authority."
        : "Brand grant evidence appears sufficient for a customer-safe brand list response.",
      customer_safe_message: needsMapping
        ? "لا أستطيع تأكيد قائمة البراندات من عرض الحساب المتاح لي الآن. تم فتح مراجعة ربط صلاحيات البراندات بحسابك."
        : "تم تأكيد وجود صلاحيات براندات قابلة للمراجعة من مصدر الصلاحيات.",
      prior_step_count: prior.length,
      secrets_included: false,
    };
  }

  return {
    diagnostic_key: stepKey,
    status: "skipped_unknown_step",
    recommendation: `No governed diagnostic executor is registered for step ${stepKey}.`,
    ticket_id: ticket.ticket_id,
    run_id: run.run_id,
    plan_id: plan?.plan_id || null,
    secrets_included: false,
  };
}

export async function executeSupportTicketDiagnosticStep({ tenant_id, ticket_id, step_run_id = null, run_id = null, step_key = null, actor_id = null, actor_type = "system", reason = "Diagnostic step executed for support ticket." } = {}, options = {}) {
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
    const params = [tenant_id];
    const filters = ["tenant_id = ?"];
    if (step_run_id) { filters.push("step_run_id = ?"); params.push(step_run_id); }
    else {
      if (run_id) { filters.push("run_id = ?"); params.push(run_id); }
      if (step_key) { filters.push("step_key = ?"); params.push(step_key); }
    }
    const stepRun = await queryOne(connection, `SELECT * FROM step_runs WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT 1`, params);
    if (!stepRun) {
      const err = new Error("Step run not found.");
      err.status = 404;
      err.code = "support_ticket_step_run_not_found";
      throw err;
    }
    const run = await queryOne(connection, "SELECT * FROM workflow_runs WHERE tenant_id = ? AND run_id = ? LIMIT 1", [tenant_id, stepRun.run_id]);
    if (!run) {
      const err = new Error("Workflow run not found.");
      err.status = 404;
      err.code = "support_ticket_workflow_run_not_found";
      throw err;
    }
    const plan = run.plan_id ? await queryOne(connection, "SELECT * FROM execution_plans WHERE tenant_id = ? AND plan_id = ? LIMIT 1", [tenant_id, run.plan_id]) : await resolveTicketExecutionPlan(connection, { tenant_id, ticket_id });

    await connection.query(
      "UPDATE step_runs SET status = 'running', started_at = COALESCE(started_at, NOW()) WHERE tenant_id = ? AND step_run_id = ?",
      [tenant_id, stepRun.step_run_id]
    );
    const output = await buildDiagnosticStepOutput(connection, { tenant_id, ticket, run, plan, stepRun });
    const result = await updateSupportTicketStepRun({
      tenant_id,
      ticket_id,
      step_run_id: stepRun.step_run_id,
      status: output.status === "skipped_unknown_step" ? "skipped" : "completed",
      output_json: output,
      actor_id,
      actor_type,
      reason,
    }, { connection });
    await insertLifecycleEvent(connection, {
      ticket_id,
      tenant_id,
      event_type: "diagnostic_step_executed",
      from_state: ticket.lifecycle_state || null,
      to_state: result.ticket?.lifecycle_state || null,
      actor_id,
      actor_type,
      visibility: "internal_support",
      summary: `${reason} (${stepRun.step_key})`,
      payload_json: { step_run_id: stepRun.step_run_id, step_key: stepRun.step_key, diagnostic_status: output.status, output, secrets_included: false },
    });
    if (ownsConnection) await connection.commit();
    return { ok: true, step_run_id: stepRun.step_run_id, step_key: stepRun.step_key, diagnostic_status: output.status, output, runtime_state: result.runtime_state, ticket: result.ticket, secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function runSupportTicketDiagnosticChain({ tenant_id, ticket_id, run_id = null, plan_id = null, max_steps = 10, create_remediation_hold = true, actor_id = null, actor_type = "system", reason = "Diagnostic chain executed for support ticket." } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const maxSteps = Math.min(Math.max(Number(max_steps) || 10, 1), 25);
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const run = run_id
      ? await queryOne(connection, "SELECT * FROM workflow_runs WHERE tenant_id = ? AND run_id = ? LIMIT 1", [tenant_id, run_id])
      : await queryOne(connection, `SELECT wr.* FROM ticket_workflow_links twl JOIN workflow_runs wr ON wr.run_id = twl.run_id AND wr.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.run_id IS NOT NULL ORDER BY twl.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    if (!run) {
      const err = new Error("Workflow run not found for ticket.");
      err.status = 404;
      err.code = "support_ticket_workflow_run_not_found";
      throw err;
    }
    const plan = plan_id
      ? await queryOne(connection, "SELECT * FROM execution_plans WHERE tenant_id = ? AND plan_id = ? LIMIT 1", [tenant_id, plan_id])
      : run.plan_id ? await queryOne(connection, "SELECT * FROM execution_plans WHERE tenant_id = ? AND plan_id = ? LIMIT 1", [tenant_id, run.plan_id]) : await resolveTicketExecutionPlan(connection, { tenant_id, ticket_id });

    let steps = await queryRows(connection, "SELECT * FROM step_runs WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC", [tenant_id, run.run_id]);
    if (!steps.length) {
      await createSupportTicketStepRuns({ tenant_id, ticket_id, run_id: run.run_id, plan_id: plan?.plan_id || null, actor_id, actor_type, reason: "Diagnostic chain created missing step runs.", evidence_json: { chain_reason: reason, secrets_included: false } }, { connection });
      steps = await queryRows(connection, "SELECT * FROM step_runs WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC", [tenant_id, run.run_id]);
    }

    const executed = [];
    for (const step of steps) {
      if (executed.length >= maxSteps) break;
      if (!["pending", "running", "awaiting"].includes(step.status)) continue;
      const result = await executeSupportTicketDiagnosticStep({
        tenant_id,
        ticket_id,
        step_run_id: step.step_run_id,
        actor_id,
        actor_type,
        reason: `${reason} (${step.step_key})`,
      }, { connection });
      executed.push({ step_run_id: step.step_run_id, step_key: step.step_key, diagnostic_status: result.diagnostic_status, output: result.output, secrets_included: false });
      if (result.diagnostic_status === "skipped_unknown_step") break;
    }

    const finalSteps = await queryRows(connection, "SELECT step_run_id, step_key, status, output_json FROM step_runs WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC", [tenant_id, run.run_id]);
    const recommendationStep = finalSteps.find((step) => step.step_key === "recommend_mapping_fix");
    const recommendation = parseJsonObject(recommendationStep?.output_json, {});
    let remediation = null;
    if (create_remediation_hold && recommendation?.status === "mapping_review_required") {
      const openExisting = await queryOne(
        connection,
        `SELECT ah.hold_id, ah.status
           FROM ticket_workflow_links twl
           JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id
          WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'approval_gate' AND ah.status = 'open'
          ORDER BY ah.created_at DESC LIMIT 1`,
        [tenant_id, ticket_id]
      );
      if (openExisting) {
        remediation = { created: false, hold_id: openExisting.hold_id, status: openExisting.status, reason: "existing_open_remediation_hold", secrets_included: false };
      } else {
        const hold = await createSupportTicketApprovalHold({
          tenant_id,
          ticket_id,
          hold_type: "review",
          required_role: "workspace_owner_admin",
          reason: "Brand authority mapping review required by diagnostic chain.",
          actor_id,
          actor_type,
          evidence_json: { recommendation, run_id: run.run_id, plan_id: plan?.plan_id || null, source: "support_ticket_diagnostic_chain", secrets_included: false },
        }, { connection });
        remediation = { created: true, hold_id: hold.hold_id, run_id: hold.run_id, reason: "mapping_review_required", secrets_included: false };
      }
    }

    const refreshed = await fetchTicketById(connection, tenant_id, ticket_id);
    await insertLifecycleEvent(connection, {
      ticket_id,
      tenant_id,
      event_type: "diagnostic_chain_completed",
      from_state: ticket.lifecycle_state || null,
      to_state: refreshed?.lifecycle_state || null,
      actor_id,
      actor_type,
      visibility: "internal_support",
      summary: reason,
      payload_json: { run_id: run.run_id, plan_id: plan?.plan_id || null, executed_count: executed.length, recommendation, remediation, secrets_included: false },
    });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_diagnostic_chain_completed", after_json: { run_id: run.run_id, executed_count: executed.length, recommendation_status: recommendation?.status || null, remediation, secrets_included: false } });
    const finalTicket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, ticket_id, tenant_id, run_id: run.run_id, plan_id: plan?.plan_id || null, executed_count: executed.length, executed, recommendation, remediation, ticket: compactTicket(finalTicket), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

function normalizeBrandGrantTargets({ brand_ref = null, brand_refs = null } = {}) {
  const raw = Array.isArray(brand_refs) ? brand_refs : brand_ref ? [brand_ref] : [];
  return [...new Set(raw.map((ref) => normalizeString(ref).trim()).filter(Boolean))].slice(0, 25);
}

function mergeBrandRefCandidate(map, candidate = {}) {
  const brandRef = normalizeString(candidate.brand_ref || candidate.resource_ref || candidate.linked_brand_key || candidate.target_key).trim();
  if (!brandRef) return;
  const existing = map.get(brandRef) || { brand_ref: brandRef, confidence: 0, sources: [], evidence: [], secrets_included: false };
  existing.confidence = Math.max(Number(candidate.confidence || 0), Number(existing.confidence || 0));
  existing.sources = [...new Set([...existing.sources, candidate.source].filter(Boolean))];
  existing.evidence.push(sanitizeTicketMetadata({ source: candidate.source, confidence: candidate.confidence, reason: candidate.reason || null, evidence: candidate.evidence || {}, secrets_included: false }));
  map.set(brandRef, existing);
}

export async function resolveSupportTicketBrandRefs({ tenant_id, ticket_id, user_id = null, brand_ref = null, brand_refs = null, min_confidence = 70, limit = 25 } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const max = Math.min(Math.max(Number(limit) || 25, 1), 50);
  const threshold = Math.min(Math.max(Number(min_confidence) || 70, 0), 100);
  try {
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) { const err = new Error("Ticket not found."); err.status = 404; err.code = "support_ticket_not_found"; throw err; }
    const ticketMetadata = parseJsonObject(ticket.metadata_json, {});
    const granteeUserId = user_id || ticket.user_id || ticketMetadata?.metadata?.user_id || ticketMetadata?.user_id || null;
    const candidates = new Map();
    for (const ref of normalizeBrandGrantTargets({ brand_ref, brand_refs })) mergeBrandRefCandidate(candidates, { brand_ref: ref, source: "explicit_request", confidence: 90, reason: "brand_ref was supplied explicitly by the caller" });
    if (granteeUserId) {
      const grantRows = await queryRows(connection, `SELECT grant_id, resource_ref, permission, grant_status, source, granted_at FROM v_workspace_resource_grant_effective WHERE tenant_id = ? AND grantee_user_id = ? AND resource_type = 'brand' ORDER BY granted_at DESC LIMIT ?`, [tenant_id, granteeUserId, max]);
      for (const row of grantRows) mergeBrandRefCandidate(candidates, { brand_ref: row.resource_ref, source: "effective_brand_grant", confidence: row.grant_status === "active" ? 100 : 85, reason: "brand_ref appears in effective workspace grant view", evidence: row });
    }
    const assetRows = await queryRows(connection, `SELECT brand_ref, COUNT(*) AS asset_count, MAX(updated_at) AS latest_asset_at FROM workspace_assets WHERE tenant_id = ? AND brand_ref IS NOT NULL AND brand_ref <> '' AND lifecycle_status <> 'deleted' GROUP BY brand_ref ORDER BY asset_count DESC, latest_asset_at DESC LIMIT ?`, [tenant_id, max]);
    for (const row of assetRows) mergeBrandRefCandidate(candidates, { brand_ref: row.brand_ref, source: "workspace_assets", confidence: 75, reason: "brand_ref appears on active workspace assets", evidence: row });
    const workspaceRows = await queryRows(connection, `SELECT workspace_id, workspace_key, display_name, linked_brand_key, bootstrap_status, updated_at FROM workspace_registry WHERE tenant_id = ? AND workspace_type = 'brand' AND (linked_brand_key IS NOT NULL OR workspace_key IS NOT NULL) ORDER BY updated_at DESC LIMIT ?`, [tenant_id, max]);
    for (const row of workspaceRows) mergeBrandRefCandidate(candidates, { brand_ref: row.linked_brand_key || row.workspace_key, source: "workspace_registry", confidence: row.bootstrap_status === "ready" ? 85 : 70, reason: "brand_ref appears in workspace brand registry", evidence: row });
    const brandRows = await queryRows(connection, `SELECT target_key, brand_name, normalized_brand_name, status, resolver_status, updated_at FROM brands WHERE target_key IS NOT NULL AND target_key <> '' ORDER BY updated_at DESC LIMIT ?`, [max]);
    for (const row of brandRows) mergeBrandRefCandidate(candidates, { brand_ref: row.target_key, source: "legacy_brand_registry", confidence: 55, reason: "brand_ref appears in legacy global brands registry; verify tenant membership before use", evidence: { target_key: row.target_key, brand_name: row.brand_name, status: row.status, resolver_status: row.resolver_status } });
    const sorted = [...candidates.values()].map((candidate) => ({ ...candidate, trusted_for_remediation: candidate.confidence >= threshold })).sort((a, b) => b.confidence - a.confidence || a.brand_ref.localeCompare(b.brand_ref));
    const trusted = sorted.filter((candidate) => candidate.trusted_for_remediation);
    return { ok: true, ticket_id, tenant_id, grantee_user_id: granteeUserId, min_confidence: threshold, count: sorted.length, trusted_count: trusted.length, selected_brand_ref: trusted.length === 1 ? trusted[0].brand_ref : null, candidates: sorted, recommendation: trusted.length === 0 ? "No trusted brand_ref candidate was found. Require explicit approved brand_ref before applying remediation." : trusted.length === 1 ? "One trusted brand_ref candidate is available for remediation." : "Multiple trusted brand_ref candidates exist; require explicit selection before applying remediation.", secrets_included: false };
  } finally { if (ownsConnection) connection.release(); }
}

export async function applySupportTicketBrandMappingRemediation({ tenant_id, ticket_id, approval_hold_id = null, brand_ref = null, brand_refs = null, permission = "manage", dry_run = false, actor_id = null, actor_type = "system", reason = "Approved brand mapping remediation applied." } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const validPermission = ["owner", "admin", "manage", "operate", "edit", "comment", "view"].includes(permission) ? permission : "manage";
  try {
    if (ownsConnection && !dry_run) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const hold = approval_hold_id
      ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, approval_hold_id])
      : await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.approval_hold_id IS NOT NULL ORDER BY ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    if (!hold) {
      const err = new Error("Approval hold not found for ticket remediation.");
      err.status = 404;
      err.code = "support_ticket_approval_hold_not_found";
      throw err;
    }
    if (!dry_run && hold.status !== "approved") {
      const err = new Error("Approval hold must be approved before applying brand mapping remediation.");
      err.status = 409;
      err.code = "support_ticket_remediation_requires_approved_hold";
      throw err;
    }
    const targets = normalizeBrandGrantTargets({ brand_ref, brand_refs });
    if (!targets.length) {
      const assetRefs = await queryRows(connection, "SELECT DISTINCT brand_ref FROM workspace_assets WHERE tenant_id = ? AND brand_ref IS NOT NULL AND brand_ref <> '' ORDER BY brand_ref LIMIT 25", [tenant_id]);
      for (const row of assetRefs) targets.push(row.brand_ref);
    }
    if (!targets.length) {
      const err = new Error("At least one brand_ref is required because no workspace asset brand_ref could be inferred.");
      err.status = 400;
      err.code = "support_ticket_brand_ref_required";
      throw err;
    }
    const ticketMetadata = parseJsonObject(ticket.metadata_json, {});
    const granteeUserId = ticket.user_id || hold.user_id || ticketMetadata?.metadata?.user_id || ticketMetadata?.user_id || null;
    if (!granteeUserId) {
      const err = new Error("Ticket user_id is required to apply brand mapping remediation.");
      err.status = 400;
      err.code = "support_ticket_grantee_user_required";
      throw err;
    }
    const membership = await queryOne(connection, "SELECT user_id, tenant_id, role, status FROM memberships WHERE tenant_id = ? AND user_id = ? AND status = 'active' LIMIT 1", [tenant_id, granteeUserId]);
    if (!membership) {
      const err = new Error("Active membership is required before applying brand grant remediation.");
      err.status = 409;
      err.code = "support_ticket_active_membership_required";
      throw err;
    }
    const grantResults = [];
    for (const target of targets) {
      const existing = await queryOne(
        connection,
        "SELECT grant_id, status, permission FROM workspace_resource_grants WHERE tenant_id = ? AND grantee_user_id = ? AND resource_type = 'brand' AND resource_ref = ? AND permission = ? AND status = 'active' LIMIT 1",
        [tenant_id, granteeUserId, target, validPermission]
      );
      if (existing) {
        grantResults.push({ brand_ref: target, grant_id: existing.grant_id, action: "existing", permission: existing.permission, secrets_included: false });
        continue;
      }
      const grantId = randomUUID();
      grantResults.push({ brand_ref: target, grant_id: grantId, action: dry_run ? "would_create" : "created", permission: validPermission, secrets_included: false });
      if (!dry_run) {
        await connection.query(
          `INSERT INTO workspace_resource_grants
             (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
           VALUES (?, ?, ?, 'brand', ?, ?, 'active', 'admin_repair', ?, ?)`,
          [grantId, tenant_id, granteeUserId, target, validPermission, actor_id || hold.decision_by || null, jsonOrNull({ ticket_id, approval_hold_id: hold.hold_id, reason, source: "support_ticket_brand_mapping_remediation", secrets_included: false })]
        );
      }
    }
    const verification = await queryRows(
      connection,
      `SELECT grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, grant_status, source, granted_by, granted_at
         FROM v_workspace_resource_grant_effective
        WHERE tenant_id = ? AND grantee_user_id = ? AND resource_type = 'brand'
        ORDER BY granted_at DESC
        LIMIT 50`,
      [tenant_id, granteeUserId]
    );
    if (!dry_run) {
      await connection.query(
        `UPDATE tickets
            SET status = 'in_review', lifecycle_state = 'verification_pending', customer_status = 'under_review', updated_at = NOW()
          WHERE tenant_id = ? AND ticket_id = ?`,
        [tenant_id, ticket_id]
      );
      await insertLifecycleEvent(connection, {
        ticket_id,
        tenant_id,
        event_type: "brand_mapping_remediation_applied",
        from_state: ticket.lifecycle_state || null,
        to_state: "verification_pending",
        actor_id,
        actor_type,
        visibility: "internal_support",
        summary: reason,
        payload_json: { approval_hold_id: hold.hold_id, grantee_user_id: granteeUserId, grants: grantResults, verification_count: verification.length, secrets_included: false },
      });
      await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_brand_mapping_remediation_applied", after_json: { approval_hold_id: hold.hold_id, grantee_user_id: granteeUserId, grants: grantResults, verification_count: verification.length, secrets_included: false } });
    }
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection && !dry_run) await connection.commit();
    return { ok: true, mode: dry_run ? "dry_run" : "apply", ticket_id, tenant_id, approval_hold_id: hold.hold_id, grantee_user_id: granteeUserId, grant_count: grantResults.length, grants: grantResults, verification_count: verification.length, verification, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection && !dry_run) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

async function resolveTicketApprovalHold(connection, { tenant_id, ticket_id, approval_hold_id = null } = {}) {
  if (approval_hold_id) {
    return await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, approval_hold_id]);
  }
  return await queryOne(
    connection,
    `SELECT ah.*
       FROM ticket_workflow_links twl
       JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id
      WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.approval_hold_id IS NOT NULL
      ORDER BY ah.created_at DESC
      LIMIT 1`,
    [tenant_id, ticket_id]
  );
}

export async function decideSupportTicketApprovalHold({ tenant_id, ticket_id, approval_hold_id = null, decision, decision_note = null, actor_id = null, actor_type = "system", reason = "Approval hold decision recorded." } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const allowedDecision = ["approved", "rejected", "escalated", "expired"].includes(decision) ? decision : null;
  if (!allowedDecision) {
    const err = new Error("A valid approval decision is required.");
    err.status = 400;
    err.code = "support_ticket_approval_decision_invalid";
    throw err;
  }
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) {
      const err = new Error("Ticket not found.");
      err.status = 404;
      err.code = "support_ticket_not_found";
      throw err;
    }
    const hold = await resolveTicketApprovalHold(connection, { tenant_id, ticket_id, approval_hold_id });
    if (!hold) {
      const err = new Error("Approval hold not found for ticket.");
      err.status = 404;
      err.code = "support_ticket_approval_hold_not_found";
      throw err;
    }
    const alreadySame = hold.status === allowedDecision;
    if (!alreadySame && hold.status !== "open") {
      const err = new Error("Only open approval holds can be decided.");
      err.status = 409;
      err.code = "support_ticket_approval_hold_not_open";
      throw err;
    }
    if (!alreadySame) {
      await connection.query(
        `UPDATE approval_holds
            SET status = ?, decision_by = ?, decision_note = ?, decided_at = NOW()
          WHERE tenant_id = ? AND hold_id = ?`,
        [allowedDecision, actor_id || null, decision_note || reason, tenant_id, hold.hold_id]
      );
    }
    const next = allowedDecision === "approved"
      ? { status: "in_review", lifecycle_state: "approved_for_remediation", customer_status: "in_progress" }
      : allowedDecision === "rejected"
        ? { status: "in_review", lifecycle_state: "blocked", customer_status: "under_review" }
        : allowedDecision === "escalated"
          ? { status: "awaiting_approval", lifecycle_state: "awaiting_supervisor_approval", customer_status: "waiting_for_approval" }
          : { status: "in_review", lifecycle_state: "approval_expired", customer_status: "under_review" };
    if (!alreadySame) {
      await connection.query(
        `UPDATE tickets
            SET status = ?, lifecycle_state = ?, customer_status = ?, updated_at = NOW()
          WHERE tenant_id = ? AND ticket_id = ?`,
        [next.status, next.lifecycle_state, next.customer_status, tenant_id, ticket_id]
      );
      await insertLifecycleEvent(connection, {
        ticket_id,
        tenant_id,
        event_type: "approval_hold_decided",
        from_state: ticket.lifecycle_state || null,
        to_state: next.lifecycle_state,
        actor_id,
        actor_type,
        visibility: "internal_support",
        summary: reason,
        payload_json: { approval_hold_id: hold.hold_id, decision: allowedDecision, decision_note, secrets_included: false },
      });
      await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_approval_hold_decided", after_json: { approval_hold_id: hold.hold_id, decision: allowedDecision, next, secrets_included: false } });
    }
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, changed: !alreadySame, decision: allowedDecision, approval_hold_id: hold.hold_id, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function completeSupportTicketBrandMappingRemediation({ tenant_id, ticket_id, approval_hold_id = null, brand_ref = null, brand_refs = null, permission = "manage", approve_first = false, close_if_verified = true, actor_id = null, actor_type = "system", reason = "Approved brand mapping remediation completed." } = {}, options = {}) {
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
    const hold = await resolveTicketApprovalHold(connection, { tenant_id, ticket_id, approval_hold_id });
    if (!hold) {
      const err = new Error("Approval hold not found for ticket remediation.");
      err.status = 404;
      err.code = "support_ticket_approval_hold_not_found";
      throw err;
    }
    let approval = null;
    if (approve_first) {
      approval = await decideSupportTicketApprovalHold({ tenant_id, ticket_id, approval_hold_id: hold.hold_id, decision: "approved", decision_note: "Approved as part of brand mapping remediation completion.", actor_id, actor_type, reason: "Approval hold approved for brand mapping remediation." }, { connection });
    } else if (hold.status !== "approved") {
      const err = new Error("Approval hold must already be approved, or approve_first must be true.");
      err.status = 409;
      err.code = "support_ticket_completion_requires_approved_hold";
      throw err;
    }
    const remediation = await applySupportTicketBrandMappingRemediation({ tenant_id, ticket_id, approval_hold_id: hold.hold_id, brand_ref, brand_refs, permission, dry_run: false, actor_id, actor_type, reason }, { connection });
    const run = await queryOne(connection, `SELECT wr.* FROM ticket_workflow_links twl JOIN workflow_runs wr ON wr.run_id = twl.run_id AND wr.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.run_id IS NOT NULL ORDER BY twl.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    let verification = null;
    let recommendation = null;
    if (run) {
      const grantStep = await queryOne(connection, "SELECT step_run_id FROM step_runs WHERE tenant_id = ? AND run_id = ? AND step_key = 'read_brand_grants' LIMIT 1", [tenant_id, run.run_id]);
      if (grantStep) {
        verification = await executeSupportTicketDiagnosticStep({ tenant_id, ticket_id, step_run_id: grantStep.step_run_id, actor_id, actor_type, reason: "Verify brand grants after remediation." }, { connection });
      }
      const recommendationStep = await queryOne(connection, "SELECT step_run_id FROM step_runs WHERE tenant_id = ? AND run_id = ? AND step_key = 'recommend_mapping_fix' LIMIT 1", [tenant_id, run.run_id]);
      if (recommendationStep) {
        recommendation = await executeSupportTicketDiagnosticStep({ tenant_id, ticket_id, step_run_id: recommendationStep.step_run_id, actor_id, actor_type, reason: "Recompute mapping recommendation after remediation." }, { connection });
      }
    }
    const verified = remediation.verification_count > 0 && (!recommendation?.output?.status || recommendation.output.status === "mapping_appears_consistent");
    if (close_if_verified && verified) {
      await connection.query(
        `UPDATE tickets
            SET status = 'resolved', lifecycle_state = 'verified', customer_status = 'resolved', updated_at = NOW()
          WHERE tenant_id = ? AND ticket_id = ?`,
        [tenant_id, ticket_id]
      );
      if (run) {
        await connection.query("UPDATE workflow_runs SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW() WHERE tenant_id = ? AND run_id = ?", [tenant_id, run.run_id]);
        if (run.plan_id) await connection.query("UPDATE execution_plans SET plan_status = 'completed', updated_at = NOW() WHERE tenant_id = ? AND plan_id = ?", [tenant_id, run.plan_id]);
      }
    }
    await insertLifecycleEvent(connection, {
      ticket_id,
      tenant_id,
      event_type: "brand_mapping_remediation_completed",
      from_state: ticket.lifecycle_state || null,
      to_state: verified && close_if_verified ? "verified" : "verification_pending",
      actor_id,
      actor_type,
      visibility: "internal_support",
      summary: reason,
      payload_json: { approval_hold_id: hold.hold_id, approval, remediation: { grant_count: remediation.grant_count, verification_count: remediation.verification_count }, verification_status: verification?.diagnostic_status || null, recommendation_status: recommendation?.output?.status || null, verified, close_if_verified, secrets_included: false },
    });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_brand_mapping_remediation_completed", after_json: { approval_hold_id: hold.hold_id, verified, close_if_verified, grant_count: remediation.grant_count, verification_count: remediation.verification_count, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, approval_hold_id: hold.hold_id, approval, remediation, verification, recommendation, verified, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) {
    if (ownsConnection) await connection.rollback();
    throw error;
  } finally {
    if (ownsConnection) connection.release();
  }
}

export async function requestSupportTicketBrandRefSelection({ tenant_id, ticket_id, min_confidence = 70, limit = 25, required_role = "workspace_owner_admin", assigned_to = null, actor_id = null, actor_type = "system", reason = "Manual brand_ref selection required before remediation." } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) { const err = new Error("Ticket not found."); err.status = 404; err.code = "support_ticket_not_found"; throw err; }
    const resolution = await resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence, limit }, { connection });
    if (resolution.selected_brand_ref) { const err = new Error("A trusted brand_ref is already selected; manual selection hold is not required."); err.status = 409; err.code = "support_ticket_brand_ref_selection_not_required"; err.resolution = resolution; throw err; }
    const existing = await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'brand_ref_selection' AND ah.status = 'open' ORDER BY ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    if (existing) { if (ownsConnection) await connection.commit(); return { ok: true, created: false, hold_id: existing.hold_id, resolution, ticket: compactTicket(ticket), secrets_included: false }; }
    const holdId = randomUUID();
    const runId = randomUUID();
    await connection.query(`INSERT INTO approval_holds (hold_id, run_id, tenant_id, hold_type, requested_by, user_id, actor_id, actor_type, request_id, correlation_id, execution_context_json, assigned_to, required_role, status) VALUES (?, ?, ?, 'review', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`, [holdId, runId, tenant_id, actor_id || null, ticket.user_id || resolution.grantee_user_id || null, actor_id || null, actor_type || null, ticket_id, `ticket:${ticket_id}:brand_ref_selection`, jsonOrNull({ ticket_id, reason, selection_required: true, resolution, customer_safe: false, secrets_included: false }), assigned_to || null, required_role]);
    await connection.query(`INSERT INTO ticket_workflow_links (link_id, ticket_id, tenant_id, approval_hold_id, relationship, status, evidence_json) VALUES (?, ?, ?, ?, 'brand_ref_selection', 'linked', ?)`, [randomUUID(), ticket_id, tenant_id, holdId, jsonOrNull({ resolution, reason, secrets_included: false })]);
    await connection.query("UPDATE tickets SET status = 'awaiting_approval', lifecycle_state = 'awaiting_brand_ref_selection', customer_status = 'waiting_for_approval', updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [tenant_id, ticket_id]);
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: "brand_ref_selection_requested", from_state: ticket.lifecycle_state || null, to_state: "awaiting_brand_ref_selection", actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: { hold_id: holdId, run_id: runId, resolution, secrets_included: false } });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_brand_ref_selection_requested", after_json: { hold_id: holdId, trusted_count: resolution.trusted_count, candidate_count: resolution.count, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, created: true, hold_id: holdId, run_id: runId, resolution, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; } finally { if (ownsConnection) connection.release(); }
}

export async function approveSupportTicketBrandRefSelection({ tenant_id, ticket_id, approval_hold_id = null, selected_brand_ref, allow_new_ref = false, actor_id = null, actor_type = "system", decision_note = null, reason = "Manual brand_ref selection approved." } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  const selected = normalizeString(selected_brand_ref).trim();
  if (!selected) { const err = new Error("selected_brand_ref is required."); err.status = 400; err.code = "support_ticket_selected_brand_ref_required"; throw err; }
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) { const err = new Error("Ticket not found."); err.status = 404; err.code = "support_ticket_not_found"; throw err; }
    const hold = approval_hold_id ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, approval_hold_id]) : await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'brand_ref_selection' ORDER BY ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    if (!hold) { const err = new Error("Brand ref selection approval hold not found."); err.status = 404; err.code = "support_ticket_brand_ref_selection_hold_not_found"; throw err; }
    if (hold.status !== "open" && hold.status !== "approved") { const err = new Error("Only open or already-approved brand_ref selection holds can be approved."); err.status = 409; err.code = "support_ticket_brand_ref_selection_hold_not_open"; throw err; }
    const resolution = await resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence: 0, limit: 50 }, { connection });
    const candidate = resolution.candidates.find((item) => item.brand_ref === selected);
    if (!candidate && !allow_new_ref) { const err = new Error("selected_brand_ref must appear in resolver candidates unless allow_new_ref is true."); err.status = 400; err.code = "support_ticket_selected_brand_ref_not_in_candidates"; err.resolution = resolution; throw err; }
    const selectionEvidence = { selected_brand_ref: selected, candidate: candidate || null, allow_new_ref: Boolean(allow_new_ref), resolution, source: "manual_brand_ref_selection", secrets_included: false };
    await connection.query(`UPDATE approval_holds SET status = 'approved', decision_by = ?, decision_note = ?, decided_at = NOW(), execution_context_json = JSON_SET(COALESCE(execution_context_json, JSON_OBJECT()), '$.selected_brand_ref', ?, '$.brand_ref_selection', JSON_OBJECT('selected_brand_ref', ?, 'allow_new_ref', ?, 'source', 'manual_brand_ref_selection', 'secrets_included', false)) WHERE tenant_id = ? AND hold_id = ?`, [actor_id || null, decision_note || reason, selected, selected, Boolean(allow_new_ref), tenant_id, hold.hold_id]);
    await connection.query("UPDATE tickets SET status = 'in_review', lifecycle_state = 'approved_for_remediation', customer_status = 'in_progress', updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [tenant_id, ticket_id]);
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: "brand_ref_selection_approved", from_state: ticket.lifecycle_state || null, to_state: "approved_for_remediation", actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: selectionEvidence });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_brand_ref_selection_approved", after_json: { approval_hold_id: hold.hold_id, selected_brand_ref: selected, allow_new_ref: Boolean(allow_new_ref), secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, approval_hold_id: hold.hold_id, selected_brand_ref: selected, candidate: candidate || null, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; } finally { if (ownsConnection) connection.release(); }
}

async function findApprovedNewBrandRefApproval(connection, { tenant_id, ticket_id, selected_brand_ref }) {
  const selected = normalizeString(selected_brand_ref).trim();
  if (!selected) return null;
  return await queryOne(
    connection,
    `SELECT ah.hold_id, ah.status, ah.decision_by, ah.decided_at,
            JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref')) AS selected_brand_ref
       FROM ticket_workflow_links twl
       JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id
      WHERE twl.tenant_id = ?
        AND twl.ticket_id = ?
        AND twl.relationship = 'new_brand_ref_approval'
        AND ah.status = 'approved'
        AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref')) = ?
      ORDER BY ah.decided_at DESC, ah.created_at DESC
      LIMIT 1`,
    [tenant_id, ticket_id, selected]
  );
}

export async function requestSupportTicketNewBrandRefApproval({ tenant_id, ticket_id, selected_brand_ref, allow_new_ref = true, required_role = "platform_admin", assigned_to = null, actor_id = null, actor_type = "system", reason = "New brand_ref approval required before remediation apply." } = {}, options = {}) {
  const selected = normalizeString(selected_brand_ref).trim();
  if (!selected) { const err = new Error("selected_brand_ref is required."); err.status = 400; err.code = "support_ticket_selected_brand_ref_required"; throw err; }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) { const err = new Error("Ticket not found."); err.status = 404; err.code = "support_ticket_not_found"; throw err; }
    const resolution = await resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence: 0, limit: 50 }, { connection });
    const candidate = resolution.candidates.find((item) => item.brand_ref === selected) || null;
    const existing = await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'new_brand_ref_approval' AND ah.status = 'open' AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref')) = ? ORDER BY ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id, selected]);
    if (existing) { if (ownsConnection) await connection.commit(); return { ok: true, created: false, hold_id: existing.hold_id, selected_brand_ref: selected, candidate, resolution, ticket: compactTicket(ticket), secrets_included: false }; }
    const holdId = randomUUID();
    const runId = randomUUID();
    const evidence = { ticket_id, selected_brand_ref: selected, allow_new_ref: Boolean(allow_new_ref), candidate, resolution, source: "new_brand_ref_approval", reason, secrets_included: false };
    await connection.query(`INSERT INTO approval_holds (hold_id, run_id, tenant_id, hold_type, requested_by, user_id, actor_id, actor_type, request_id, correlation_id, execution_context_json, assigned_to, required_role, status) VALUES (?, ?, ?, 'review', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`, [holdId, runId, tenant_id, actor_id || null, ticket.user_id || resolution.grantee_user_id || null, actor_id || null, actor_type || null, ticket_id, `ticket:${ticket_id}:new_brand_ref_approval:${selected}`, jsonOrNull(evidence), assigned_to || null, required_role]);
    await connection.query(`INSERT INTO ticket_workflow_links (link_id, ticket_id, tenant_id, approval_hold_id, relationship, status, evidence_json) VALUES (?, ?, ?, ?, 'new_brand_ref_approval', 'linked', ?)`, [randomUUID(), ticket_id, tenant_id, holdId, jsonOrNull(evidence)]);
    await connection.query("UPDATE tickets SET status = 'awaiting_approval', lifecycle_state = 'awaiting_new_brand_ref_approval', customer_status = 'waiting_for_approval', updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [tenant_id, ticket_id]);
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: "new_brand_ref_approval_requested", from_state: ticket.lifecycle_state || null, to_state: "awaiting_new_brand_ref_approval", actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: { hold_id: holdId, run_id: runId, ...evidence } });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_new_brand_ref_approval_requested", after_json: { hold_id: holdId, selected_brand_ref: selected, allow_new_ref: Boolean(allow_new_ref), candidate_source_count: Array.isArray(candidate?.sources) ? candidate.sources.length : 0, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, created: true, hold_id: holdId, run_id: runId, selected_brand_ref: selected, candidate, resolution, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export async function approveSupportTicketNewBrandRef({ tenant_id, ticket_id, approval_hold_id = null, selected_brand_ref, allow_new_ref = true, actor_id = null, actor_type = "system", decision_note = null, reason = "New brand_ref approved for remediation apply." } = {}, options = {}) {
  const selected = normalizeString(selected_brand_ref).trim();
  if (!selected) { const err = new Error("selected_brand_ref is required."); err.status = 400; err.code = "support_ticket_selected_brand_ref_required"; throw err; }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection) await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) { const err = new Error("Ticket not found."); err.status = 404; err.code = "support_ticket_not_found"; throw err; }
    const hold = approval_hold_id ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, approval_hold_id]) : await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'new_brand_ref_approval' AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref')) = ? ORDER BY ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id, selected]);
    if (!hold) { const err = new Error("New brand_ref approval hold not found."); err.status = 404; err.code = "support_ticket_new_brand_ref_approval_hold_not_found"; throw err; }
    if (hold.status !== "open" && hold.status !== "approved") { const err = new Error("Only open or already-approved new brand_ref approval holds can be approved."); err.status = 409; err.code = "support_ticket_new_brand_ref_approval_hold_not_open"; throw err; }
    const resolution = await resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence: 0, limit: 50 }, { connection });
    const candidate = resolution.candidates.find((item) => item.brand_ref === selected) || null;
    const evidence = { selected_brand_ref: selected, allow_new_ref: Boolean(allow_new_ref), candidate, resolution, source: "new_brand_ref_approval", secrets_included: false };
    await connection.query(`UPDATE approval_holds SET status = 'approved', decision_by = ?, decision_note = ?, decided_at = NOW(), execution_context_json = JSON_SET(COALESCE(execution_context_json, JSON_OBJECT()), '$.selected_brand_ref', ?, '$.allow_new_ref', ?, '$.new_brand_ref_approval', JSON_OBJECT('selected_brand_ref', ?, 'allow_new_ref', ?, 'source', 'new_brand_ref_approval', 'secrets_included', false)) WHERE tenant_id = ? AND hold_id = ?`, [actor_id || null, decision_note || reason, selected, Boolean(allow_new_ref), selected, Boolean(allow_new_ref), tenant_id, hold.hold_id]);
    await connection.query("UPDATE tickets SET status = 'in_review', lifecycle_state = 'approved_for_new_brand_ref_remediation', customer_status = 'in_progress', updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [tenant_id, ticket_id]);
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: "new_brand_ref_approved", from_state: ticket.lifecycle_state || null, to_state: "approved_for_new_brand_ref_remediation", actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: evidence });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_new_brand_ref_approved", after_json: { approval_hold_id: hold.hold_id, selected_brand_ref: selected, allow_new_ref: Boolean(allow_new_ref), secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, approval_hold_id: hold.hold_id, selected_brand_ref: selected, allow_new_ref: Boolean(allow_new_ref), candidate, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) { if (ownsConnection) await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export async function completeSupportTicketBrandRefSelectionRemediation({ tenant_id, ticket_id, brand_ref_selection_hold_id = null, remediation_approval_hold_id = null, selected_brand_ref, allow_new_ref = false, mode = "dry_run", approve_first = false, close_if_verified = true, actor_id = null, actor_type = "system", reason = "Brand ref selection and remediation completion orchestrated." } = {}, options = {}) {
  const selected = normalizeString(selected_brand_ref).trim();
  const runMode = mode === "apply" ? "apply" : "dry_run";
  if (!selected) { const err = new Error("selected_brand_ref is required."); err.status = 400; err.code = "support_ticket_selected_brand_ref_required"; throw err; }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "apply") await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) { const err = new Error("Ticket not found."); err.status = 404; err.code = "support_ticket_not_found"; throw err; }
    const selectionHold = brand_ref_selection_hold_id
      ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, brand_ref_selection_hold_id])
      : await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'brand_ref_selection' ORDER BY ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    if (!selectionHold) { const err = new Error("Brand ref selection approval hold not found."); err.status = 404; err.code = "support_ticket_brand_ref_selection_hold_not_found"; throw err; }
    const resolution = await resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence: 0, limit: 50 }, { connection });
    const candidate = resolution.candidates.find((item) => item.brand_ref === selected) || null;
    if (!candidate && !allow_new_ref) { const err = new Error("selected_brand_ref must appear in resolver candidates unless allow_new_ref is true."); err.status = 400; err.code = "support_ticket_selected_brand_ref_not_in_candidates"; err.resolution = resolution; throw err; }
    const remediationHold = remediation_approval_hold_id
      ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, remediation_approval_hold_id])
      : await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'approval_gate' ORDER BY ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    if (!remediationHold) { const err = new Error("Remediation approval hold not found."); err.status = 404; err.code = "support_ticket_remediation_approval_hold_not_found"; throw err; }
    const candidateSources = Array.isArray(candidate?.sources) ? candidate.sources : [];
    const legacyOnlyCandidate = Boolean(candidate) && candidateSources.length > 0 && candidateSources.every((source) => source === "legacy_brand_registry");
    const lowConfidenceCandidate = Number(candidate?.confidence || 0) < 70;
    const applyPolicyBlocked = runMode === "apply" && legacyOnlyCandidate && lowConfidenceCandidate && !allow_new_ref;
    const newBrandRefApprovalRequired = runMode === "apply" && Boolean(allow_new_ref) && (!candidate || (legacyOnlyCandidate && lowConfidenceCandidate));
    const newBrandRefApproval = newBrandRefApprovalRequired ? await findApprovedNewBrandRefApproval(connection, { tenant_id, ticket_id, selected_brand_ref: selected }) : null;
    const newBrandRefApprovalBlocked = newBrandRefApprovalRequired && !newBrandRefApproval;
    const plan = {
      selected_brand_ref: selected,
      candidate,
      brand_ref_selection_hold_id: selectionHold.hold_id,
      selection_hold_status: selectionHold.status,
      remediation_approval_hold_id: remediationHold.hold_id,
      remediation_hold_status: remediationHold.status,
      would_approve_selection: selectionHold.status !== "approved",
      would_complete_remediation: true,
      would_apply_grant: runMode === "apply" && !applyPolicyBlocked && !newBrandRefApprovalBlocked,
      apply_policy_blocked: applyPolicyBlocked || newBrandRefApprovalBlocked,
      apply_policy_reason: applyPolicyBlocked ? "legacy_brand_registry_only_requires_allow_new_ref" : newBrandRefApprovalBlocked ? "new_brand_ref_approval_required" : null,
      new_brand_ref_approval_required: newBrandRefApprovalRequired,
      new_brand_ref_approval_hold_id: newBrandRefApproval?.hold_id || null,
      remediation_requires_approval: remediationHold.status !== "approved" && !approve_first,
      close_if_verified: Boolean(close_if_verified),
      secrets_included: false,
    };
    if (applyPolicyBlocked) {
      const err = new Error("Legacy-only brand_ref candidates require allow_new_ref=true before apply mode can proceed.");
      err.status = 409;
      err.code = "support_ticket_legacy_brand_ref_apply_requires_allow_new_ref";
      err.plan = plan;
      throw err;
    }
    if (newBrandRefApprovalBlocked) {
      const err = new Error("allow_new_ref=true requires an approved new_brand_ref_approval hold for the selected brand_ref.");
      err.status = 409;
      err.code = "support_ticket_new_brand_ref_approval_required";
      err.plan = plan;
      throw err;
    }
    if (runMode !== "apply") {
      return { ok: true, mode: "dry_run", ticket_id, tenant_id, plan, resolution, ticket: compactTicket(ticket), secrets_included: false };
    }
    const selection = await approveSupportTicketBrandRefSelection({ tenant_id, ticket_id, approval_hold_id: selectionHold.hold_id, selected_brand_ref: selected, allow_new_ref, actor_id, actor_type, decision_note: "Approved as part of brand_ref selection remediation orchestration.", reason: "Brand ref selection approved before remediation completion." }, { connection });
    const completion = await completeSupportTicketBrandMappingRemediation({ tenant_id, ticket_id, approval_hold_id: remediationHold.hold_id, brand_ref: selected, permission: "manage", approve_first, close_if_verified, actor_id, actor_type, reason }, { connection });
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: "brand_ref_selection_remediation_orchestrated", from_state: ticket.lifecycle_state || null, to_state: completion.ticket?.lifecycle_state || null, actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: { plan, selection: { approval_hold_id: selection.approval_hold_id, selected_brand_ref: selection.selected_brand_ref }, completion: { verified: completion.verified, remediation_verification_count: completion.remediation?.verification_count || 0 }, secrets_included: false } });
    await insertAuditLog(connection, { ticket_id, tenant_id, actor_id, actor_type, action: "support_ticket_brand_ref_selection_remediation_orchestrated", after_json: { selected_brand_ref: selected, selection_hold_id: selectionHold.hold_id, remediation_hold_id: remediationHold.hold_id, verified: completion.verified, secrets_included: false } });
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "apply", ticket_id, tenant_id, plan, selection, completion, secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "apply") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export async function applySupportTicketBrandMappingVerified({ tenant_id, ticket_id, approval_hold_id = null, brand_ref = null, brand_refs = null, permission = "manage", mode = "dry_run", rollback_on_failed_verification = true, close_if_verified = true, actor_id = null, actor_type = "system", reason = "Verified brand mapping remediation apply." } = {}, options = {}) {
  const runMode = mode === "apply" ? "apply" : "dry_run";
  const targets = normalizeBrandGrantTargets({ brand_ref, brand_refs });
  if (!targets.length) { const err = new Error("At least one brand_ref is required for verified apply."); err.status = 400; err.code = "support_ticket_verified_apply_brand_ref_required"; throw err; }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "apply") await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) { const err = new Error("Ticket not found."); err.status = 404; err.code = "support_ticket_not_found"; throw err; }
    const ticketMetadata = parseJsonObject(ticket.metadata_json, {});
    const granteeUserId = ticket.user_id || ticketMetadata?.metadata?.user_id || ticketMetadata?.user_id || null;
    const before_grants = granteeUserId ? await queryRows(connection, `SELECT grant_id, grantee_user_id, resource_ref, permission, status, source, granted_at FROM workspace_resource_grants WHERE tenant_id = ? AND grantee_user_id = ? AND resource_type = 'brand' AND resource_ref IN (?) ORDER BY granted_at DESC`, [tenant_id, granteeUserId, targets]) : [];
    const before_effective = granteeUserId ? await queryRows(connection, `SELECT grant_id, grantee_user_id, resource_ref, permission, grant_status, source, granted_at FROM v_workspace_resource_grant_effective WHERE tenant_id = ? AND grantee_user_id = ? AND resource_type = 'brand' AND resource_ref IN (?) ORDER BY granted_at DESC`, [tenant_id, granteeUserId, targets]) : [];
    const plan = { ticket_id, tenant_id, grantee_user_id: granteeUserId, brand_refs: targets, mode: runMode, before_grant_count: before_grants.length, before_effective_count: before_effective.length, rollback_on_failed_verification: Boolean(rollback_on_failed_verification), secrets_included: false };
    if (runMode !== "apply") return { ok: true, mode: "dry_run", plan, before_grants, before_effective, secrets_included: false };
    const applyResult = await applySupportTicketBrandMappingRemediation({ tenant_id, ticket_id, approval_hold_id, brand_refs: targets, permission, dry_run: false, actor_id, actor_type, reason }, { connection });
    const after_grants = await queryRows(connection, `SELECT grant_id, grantee_user_id, resource_ref, permission, status, source, granted_at FROM workspace_resource_grants WHERE tenant_id = ? AND grantee_user_id = ? AND resource_type = 'brand' AND resource_ref IN (?) ORDER BY granted_at DESC`, [tenant_id, applyResult.grantee_user_id, targets]);
    const after_effective = await queryRows(connection, `SELECT grant_id, grantee_user_id, resource_ref, permission, grant_status, source, granted_at FROM v_workspace_resource_grant_effective WHERE tenant_id = ? AND grantee_user_id = ? AND resource_type = 'brand' AND resource_ref IN (?) ORDER BY granted_at DESC`, [tenant_id, applyResult.grantee_user_id, targets]);
    const effectiveRefs = new Set(after_effective.filter((row) => row.grant_status === "active" || row.status === "active" || !row.grant_status).map((row) => row.resource_ref));
    const missing_refs = targets.filter((ref) => !effectiveRefs.has(ref));
    const verified = missing_refs.length === 0;
    if (!verified && rollback_on_failed_verification) {
      const err = new Error("Verified apply readback failed; rolling back brand grant remediation.");
      err.status = 409;
      err.code = "support_ticket_verified_apply_readback_failed";
      err.verification = { missing_refs, after_effective_count: after_effective.length, secrets_included: false };
      throw err;
    }
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: verified ? "brand_mapping_verified_apply_completed" : "brand_mapping_verified_apply_unverified", from_state: ticket.lifecycle_state || null, to_state: verified ? "verified" : "verification_failed", actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: { plan, apply: { grant_count: applyResult.grant_count, verification_count: applyResult.verification_count }, readback: { after_grant_count: after_grants.length, after_effective_count: after_effective.length, missing_refs }, verified, secrets_included: false } });
    if (verified && close_if_verified) await connection.query("UPDATE tickets SET status = 'resolved', lifecycle_state = 'verified', customer_status = 'resolved', updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [tenant_id, ticket_id]);
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "apply", verified, plan, apply: applyResult, readback: { after_grants, after_effective, missing_refs }, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "apply") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export async function finalizeSupportTicketBrandMappingRemediation({ tenant_id, ticket_id, selected_brand_ref, brand_ref_selection_hold_id = null, new_brand_ref_approval_hold_id = null, remediation_approval_hold_id = null, workflow_run_id = null, plan_id = null, permission = "manage", mode = "dry_run", close_if_verified = true, max_steps = 10, actor_id = null, actor_type = "system", reason = "Finalize brand mapping remediation." } = {}, options = {}) {
  const selected = normalizeString(selected_brand_ref).trim();
  const runMode = mode === "apply" ? "apply" : "dry_run";
  if (!selected) { const err = new Error("selected_brand_ref is required."); err.status = 400; err.code = "support_ticket_selected_brand_ref_required"; throw err; }
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    if (ownsConnection && runMode === "apply") await connection.beginTransaction();
    const ticket = await fetchTicketById(connection, tenant_id, ticket_id);
    if (!ticket) { const err = new Error("Ticket not found."); err.status = 404; err.code = "support_ticket_not_found"; throw err; }
    const selectionHold = brand_ref_selection_hold_id
      ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, brand_ref_selection_hold_id])
      : await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'brand_ref_selection' AND JSON_UNQUOTE(JSON_EXTRACT(ah.execution_context_json, '$.selected_brand_ref')) = ? ORDER BY ah.decided_at DESC, ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id, selected]);
    const remediationHold = remediation_approval_hold_id
      ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, remediation_approval_hold_id])
      : await queryOne(connection, `SELECT ah.* FROM ticket_workflow_links twl JOIN approval_holds ah ON ah.hold_id = twl.approval_hold_id AND ah.tenant_id = twl.tenant_id WHERE twl.tenant_id = ? AND twl.ticket_id = ? AND twl.relationship = 'approval_gate' ORDER BY ah.decided_at DESC, ah.created_at DESC LIMIT 1`, [tenant_id, ticket_id]);
    const resolution = await resolveSupportTicketBrandRefs({ tenant_id, ticket_id, min_confidence: 0, limit: 50 }, { connection });
    const candidate = resolution.candidates.find((item) => item.brand_ref === selected) || null;
    const candidateSources = Array.isArray(candidate?.sources) ? candidate.sources : [];
    const legacyOnlyCandidate = Boolean(candidate) && candidateSources.length > 0 && candidateSources.every((source) => source === "legacy_brand_registry");
    const lowConfidenceCandidate = Number(candidate?.confidence || 0) < 70;
    const newBrandRefApprovalRequired = !candidate || (legacyOnlyCandidate && lowConfidenceCandidate);
    const newBrandRefApproval = new_brand_ref_approval_hold_id
      ? await queryOne(connection, "SELECT * FROM approval_holds WHERE tenant_id = ? AND hold_id = ? LIMIT 1", [tenant_id, new_brand_ref_approval_hold_id])
      : newBrandRefApprovalRequired ? await findApprovedNewBrandRefApproval(connection, { tenant_id, ticket_id, selected_brand_ref: selected }) : null;
    const latestLink = (!workflow_run_id || !plan_id) ? await queryOne(connection, `SELECT plan_id, run_id FROM ticket_workflow_links WHERE tenant_id = ? AND ticket_id = ? AND (plan_id IS NOT NULL OR run_id IS NOT NULL) ORDER BY created_at DESC LIMIT 1`, [tenant_id, ticket_id]) : null;
    const finalPlanId = plan_id || latestLink?.plan_id || null;
    const finalRunId = workflow_run_id || latestLink?.run_id || null;
    const approvalChecks = {
      brand_ref_selection: { hold_id: selectionHold?.hold_id || null, status: selectionHold?.status || null, approved: selectionHold?.status === "approved" },
      remediation: { hold_id: remediationHold?.hold_id || null, status: remediationHold?.status || null, approved: remediationHold?.status === "approved" },
      new_brand_ref: { required: newBrandRefApprovalRequired, hold_id: newBrandRefApproval?.hold_id || null, status: newBrandRefApproval?.status || null, approved: !newBrandRefApprovalRequired || newBrandRefApproval?.status === "approved" },
    };
    const dryRun = await applySupportTicketBrandMappingVerified({ tenant_id, ticket_id, approval_hold_id: remediationHold?.hold_id || remediation_approval_hold_id || null, brand_ref: selected, permission, mode: "dry_run", rollback_on_failed_verification: true, close_if_verified: false, actor_id, actor_type, reason: `${reason} dry-run` }, { connection });
    const readyForApply = approvalChecks.brand_ref_selection.approved && approvalChecks.remediation.approved && approvalChecks.new_brand_ref.approved && dryRun.ok === true;
    const plan = { ticket_id, tenant_id, selected_brand_ref: selected, candidate, legacy_only_candidate: legacyOnlyCandidate, low_confidence_candidate: lowConfidenceCandidate, approval_checks: approvalChecks, workflow_run_id: finalRunId, plan_id: finalPlanId, ready_for_apply: readyForApply, close_if_verified: Boolean(close_if_verified), secrets_included: false };
    if (runMode !== "apply") return { ok: true, mode: "dry_run", plan, verified_apply_dry_run: dryRun, resolution, secrets_included: false };
    if (!readyForApply) { const err = new Error("Finalize brand mapping remediation requires approved selection, remediation, and new brand_ref approvals plus clean dry-run."); err.status = 409; err.code = "support_ticket_finalize_remediation_not_ready"; err.plan = plan; throw err; }
    const verifiedApply = await applySupportTicketBrandMappingVerified({ tenant_id, ticket_id, approval_hold_id: remediationHold.hold_id, brand_ref: selected, permission, mode: "apply", rollback_on_failed_verification: true, close_if_verified: false, actor_id, actor_type, reason }, { connection });
    let diagnostic = null;
    if (finalRunId && finalPlanId) diagnostic = await runSupportTicketDiagnosticChain({ tenant_id, ticket_id, run_id: finalRunId, plan_id: finalPlanId, max_steps, create_remediation_hold: false, actor_id, actor_type, reason: `${reason} diagnostic verification` }, { connection });
    const diagnosticText = JSON.stringify(diagnostic || {});
    const diagnosticBlocked = Boolean(diagnostic) && /mapping_review_required|needs_mapping_review|no_brand_references_found/.test(diagnosticText);
    const closeAllowed = Boolean(verifiedApply.verified) && Boolean(diagnostic) && !diagnosticBlocked && close_if_verified;
    if (closeAllowed) await connection.query("UPDATE tickets SET status = 'resolved', lifecycle_state = 'verified', customer_status = 'resolved', updated_at = NOW() WHERE tenant_id = ? AND ticket_id = ?", [tenant_id, ticket_id]);
    await insertLifecycleEvent(connection, { ticket_id, tenant_id, event_type: closeAllowed ? "brand_mapping_remediation_finalized" : "brand_mapping_remediation_finalization_incomplete", from_state: ticket.lifecycle_state || null, to_state: closeAllowed ? "verified" : "verification_pending", actor_id, actor_type, visibility: "internal_support", summary: reason, payload_json: { plan, verified_apply: { verified: verifiedApply.verified, missing_refs: verifiedApply.readback?.missing_refs || [] }, diagnostic_present: Boolean(diagnostic), diagnostic_blocked: diagnosticBlocked, close_allowed: closeAllowed, secrets_included: false } });
    const updated = await fetchTicketById(connection, tenant_id, ticket_id);
    if (ownsConnection) await connection.commit();
    return { ok: true, mode: "apply", verified: Boolean(verifiedApply.verified), diagnostic_blocked: diagnosticBlocked, closed: closeAllowed, plan, verified_apply: verifiedApply, diagnostic, ticket: compactTicket(updated), secrets_included: false };
  } catch (error) { if (ownsConnection && runMode === "apply") await connection.rollback(); throw error; }
  finally { if (ownsConnection) connection.release(); }
}

export function _testingTicketClassification() {
  return { ISSUE_CLASSIFICATION, SLA_MINUTES_BY_SEVERITY, OPEN_TICKET_STATUSES: [...OPEN_TICKET_STATUSES], computeTicketSlaStatus, executionPlanTemplateForTicket, ticketStateFromRuntime, initialWorkflowStateForPlan, normalizePlanSteps, workflowStateFromSteps, buildDiagnosticStepOutput, normalizeBrandGrantTargets, mergeBrandRefCandidate };
}
