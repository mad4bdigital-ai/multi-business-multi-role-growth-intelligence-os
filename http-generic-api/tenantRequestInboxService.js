import { getPool } from "./db.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const TENANT_ADMIN_EVENT_ROLES = new Set(["owner", "admin", "platform_owner"]);
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|raw_prompt|system_prompt)/i;

function text(value = "") {
  return String(value ?? "").trim();
}

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT);
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function redactTenantRequestValue(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactTenantRequestValue(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" ? value.slice(0, 4000) : value;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 100)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactTenantRequestValue(child, depth + 1);
  }
  return output;
}

export function encodeTenantRequestCursor({ latestActivityAt, ticketId } = {}) {
  if (!latestActivityAt || !ticketId) return null;
  return Buffer.from(JSON.stringify({ latest_activity_at: latestActivityAt, ticket_id: ticketId }), "utf8").toString("base64url");
}

export function decodeTenantRequestCursor(cursor) {
  const raw = text(cursor);
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const latestActivityAt = text(decoded?.latest_activity_at);
    const ticketId = text(decoded?.ticket_id);
    if (!latestActivityAt || !ticketId || !Number.isFinite(new Date(latestActivityAt).getTime())) throw new Error("invalid");
    return { latestActivityAt, ticketId };
  } catch {
    const error = new Error("cursor is invalid or malformed.");
    error.status = 400;
    error.code = "tenant_request_cursor_invalid";
    throw error;
  }
}

export function canViewTenantAdminTicketEvents(scope = {}) {
  if (scope?.isAdmin === true) return true;
  return TENANT_ADMIN_EVENT_ROLES.has(text(scope?.role).toLowerCase());
}

async function hasResolutionTicketIdColumn(pool) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS present
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'tenant_resolution_cases'
        AND column_name = 'ticket_id'`
  );
  return Number(rows?.[0]?.present || 0) === 1;
}

async function authorizeTenantRequestScope({ auth = {}, tenantId, pool }) {
  const requestedTenantId = text(tenantId);
  if (auth?.is_admin === true) return { isAdmin: true, tenantId: requestedTenantId || null, role: "platform_admin" };
  if (!auth?.user_id || !requestedTenantId) {
    const error = new Error("An authenticated tenant membership is required.");
    error.status = 403;
    error.code = "tenant_request_membership_required";
    throw error;
  }
  const [rows] = await pool.query(
    `SELECT m.role
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.tenant_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
      LIMIT 1`,
    [auth.user_id, requestedTenantId]
  );
  if (!rows?.[0]) {
    const error = new Error("The requested tenant is outside the caller's active memberships.");
    error.status = 403;
    error.code = "tenant_request_scope_violation";
    throw error;
  }
  const [membership] = rows;
  return { isAdmin: false, tenantId: requestedTenantId, role: membership.role || null };
}

function ticketEventVisibilitySql(scope = {}, alias = "") {
  const column = alias ? `${alias}.visibility` : "visibility";
  if (scope?.isAdmin === true) return "";
  return canViewTenantAdminTicketEvents(scope)
    ? `AND ${column} IN ('customer','tenant_admin')`
    : `AND ${column} = 'customer'`;
}

function latestActivitySql(alias = "t", caseAlias = "c", ticketEventVisibility = "") {
  const ticketFallback = `COALESCE(${alias}.last_seen_at, ${alias}.updated_at, ${alias}.created_at)`;
  return `GREATEST(
    ${ticketFallback},
    COALESCE(${caseAlias}.updated_at, ${ticketFallback}),
    COALESCE((
      SELECT MAX(tle.created_at)
        FROM ticket_lifecycle_events tle
       WHERE tle.tenant_id = ${alias}.tenant_id
         AND tle.ticket_id = ${alias}.ticket_id
         ${ticketEventVisibility}
    ), ${ticketFallback}),
    COALESCE((
      SELECT MAX(trce.created_at)
        FROM tenant_resolution_case_events trce
       WHERE trce.case_id = ${caseAlias}.case_id
    ), ${ticketFallback}),
    COALESCE((
      SELECT MAX(trr.created_at)
        FROM tenant_resolution_readbacks trr
       WHERE trr.case_id = ${caseAlias}.case_id
    ), ${ticketFallback})
  )`;
}

function caseJoinSql(hasTicketId) {
  const relation = hasTicketId
    ? `(c2.ticket_id = t.ticket_id OR (c2.ticket_id IS NULL AND c2.resource_ref = CONCAT('ticket://', t.ticket_id)))`
    : `c2.resource_ref = CONCAT('ticket://', t.ticket_id)`;
  return `LEFT JOIN tenant_resolution_cases c
    ON c.id = (
      SELECT c2.id
        FROM tenant_resolution_cases c2
       WHERE c2.tenant_id = t.tenant_id
         AND ${relation}
       ORDER BY c2.updated_at DESC, c2.id DESC
       LIMIT 1
    )`;
}

function projectTicket(row = {}) {
  return {
    ticketId: row.ticket_id,
    tenantId: row.tenant_id,
    title: row.title || null,
    ticketType: row.ticket_type || null,
    category: row.category || null,
    status: row.ticket_status || row.status || null,
    priority: row.priority || null,
    severity: row.severity || null,
    occurrenceCount: Number(row.occurrence_count || 0),
    queueKey: row.queue_key || null,
    assignedTo: row.assigned_to || null,
    customerStatus: row.customer_status || null,
    slaStatus: row.sla_status || null,
    firstResponseDueAt: row.first_response_due_at || null,
    triageDueAt: row.triage_due_at || null,
    resolutionDueAt: row.resolution_due_at || null,
    createdAt: row.ticket_created_at || row.created_at || null,
    updatedAt: row.ticket_updated_at || row.updated_at || null,
    lastSeenAt: row.last_seen_at || null,
    customerMessage: row.customer_message || null,
    metadata: redactTenantRequestValue(parseJson(row.metadata_json, null)),
  };
}

function projectResolutionCase(row = {}) {
  if (!row.case_id) return null;
  return {
    resolutionCaseId: row.case_id,
    status: row.case_status || null,
    severity: row.case_severity || null,
    rootFamily: row.root_family || null,
    playbookKey: row.playbook_key || null,
    currentStepKey: row.current_step_key || null,
    readbackStatus: row.readback_status || null,
    ownerUserId: row.owner_user_id || null,
    resourceRef: row.resource_ref || null,
    createdAt: row.case_created_at || null,
    updatedAt: row.case_updated_at || null,
  };
}

function projectInboxRow(row = {}) {
  return {
    ticket: projectTicket(row),
    resolutionCase: projectResolutionCase(row),
    latestActivityAt: row.latest_activity_at || row.last_seen_at || row.ticket_updated_at || null,
    secretsIncluded: false,
  };
}

export async function listTenantRequestInbox(filters = {}, options = {}) {
  const pool = options.pool || getPool();
  const scope = await authorizeTenantRequestScope({ auth: options.auth || {}, tenantId: filters.tenant_id, pool });
  const hasTicketId = await hasResolutionTicketIdColumn(pool);
  const conditions = ["1=1"];
  const params = [];
  if (scope.tenantId) { conditions.push("t.tenant_id = ?"); params.push(scope.tenantId); }
  if (filters.status) { conditions.push("t.status = ?"); params.push(text(filters.status)); }
  if (filters.case_status) { conditions.push("c.status = ?"); params.push(text(filters.case_status)); }
  if (filters.priority) { conditions.push("t.priority = ?"); params.push(text(filters.priority)); }
  const search = text(filters.search);
  if (search) {
    const like = `%${search.slice(0, 191)}%`;
    conditions.push("(t.ticket_id = ? OR c.case_id = ? OR t.tenant_id = ? OR c.resource_ref LIKE ? OR t.title LIKE ?)");
    params.push(search, search, search, like, like);
  }
  const cursor = decodeTenantRequestCursor(filters.cursor);
  const activity = latestActivitySql("t", "c", ticketEventVisibilitySql(scope, "tle"));
  if (cursor) {
    conditions.push(`(${activity} < ? OR (${activity} = ? AND t.ticket_id < ?))`);
    params.push(cursor.latestActivityAt, cursor.latestActivityAt, cursor.ticketId);
  }
  const limit = boundedLimit(filters.limit);
  params.push(limit + 1);
  const [rows] = await pool.query(
    `SELECT t.ticket_id, t.tenant_id, t.title, t.ticket_type, t.category,
            t.status AS ticket_status, t.priority, t.severity, t.occurrence_count,
            t.queue_key, t.assigned_to, t.customer_status, t.sla_status,
            t.first_response_due_at, t.triage_due_at, t.resolution_due_at,
            t.customer_message, t.metadata_json, t.last_seen_at,
            t.created_at AS ticket_created_at, t.updated_at AS ticket_updated_at,
            c.case_id, c.status AS case_status, c.severity AS case_severity,
            c.root_family, c.playbook_key, c.current_step_key, c.readback_status,
            c.owner_user_id, c.resource_ref, c.created_at AS case_created_at,
            c.updated_at AS case_updated_at,
            ${activity} AS latest_activity_at
       FROM tickets t
       ${caseJoinSql(hasTicketId)}
      WHERE ${conditions.join(" AND ")}
      ORDER BY latest_activity_at DESC, t.ticket_id DESC
      LIMIT ?`,
    params
  );
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const last = selected[selected.length - 1] || null;
  return {
    items: selected.map(projectInboxRow),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeTenantRequestCursor({ latestActivityAt: last.latest_activity_at, ticketId: last.ticket_id }) : null,
    },
    filters: {
      tenantId: scope.tenantId,
      status: filters.status || null,
      caseStatus: filters.case_status || null,
      priority: filters.priority || null,
      search: search || null,
    },
    schema: { explicitTicketCaseLinkAvailable: hasTicketId },
    secretsIncluded: false,
  };
}

function tenantVisibleTicketEvent(row = {}) {
  return {
    source: "ticket",
    eventId: row.event_id,
    eventType: row.event_type,
    fromStatus: row.from_state || null,
    toStatus: row.to_state || null,
    summary: row.summary || null,
    visibility: row.visibility || null,
    createdAt: row.created_at || null,
    payload: redactTenantRequestValue(parseJson(row.payload_json, null)),
    secretsIncluded: false,
  };
}

function caseEvent(row = {}, isAdmin = false) {
  return {
    source: "resolution_case",
    eventId: row.event_id,
    eventType: row.event_type,
    fromStatus: row.from_status || null,
    toStatus: row.to_status || null,
    createdAt: row.created_at || null,
    ...(isAdmin ? {
      actorType: row.actor_type || null,
      actorId: row.actor_id || null,
      evidenceRef: row.evidence_ref || null,
      event: redactTenantRequestValue(parseJson(row.event_json, null)),
    } : {}),
    secretsIncluded: false,
  };
}

function readbackRow(row = {}, isAdmin = false) {
  return {
    source: "resolution_readback",
    readbackId: row.readback_id,
    decision: row.decision,
    createdAt: row.created_at || null,
    ...(isAdmin ? {
      expectedState: redactTenantRequestValue(parseJson(row.expected_state_json, null)),
      observedState: redactTenantRequestValue(parseJson(row.observed_state_json, null)),
      blockingReasons: redactTenantRequestValue(parseJson(row.blocking_reasons_json, [])),
      sourceAlertsRemaining: redactTenantRequestValue(parseJson(row.source_alerts_remaining_json, [])),
    } : {}),
    secretsIncluded: false,
  };
}

export async function getTenantRequestInboxItem({ ticket_id, tenant_id } = {}, options = {}) {
  const pool = options.pool || getPool();
  const scope = await authorizeTenantRequestScope({ auth: options.auth || {}, tenantId: tenant_id, pool });
  const hasTicketId = await hasResolutionTicketIdColumn(pool);
  const ticketId = text(ticket_id);
  if (!ticketId) {
    const error = new Error("ticket_id is required.");
    error.status = 400;
    error.code = "tenant_request_ticket_id_required";
    throw error;
  }
  const conditions = ["t.ticket_id = ?"];
  const params = [ticketId];
  if (scope.tenantId) { conditions.push("t.tenant_id = ?"); params.push(scope.tenantId); }
  const activity = latestActivitySql("t", "c", ticketEventVisibilitySql(scope, "tle"));
  const [rows] = await pool.query(
    `SELECT t.ticket_id, t.tenant_id, t.title, t.ticket_type, t.category,
            t.status AS ticket_status, t.priority, t.severity, t.occurrence_count,
            t.queue_key, t.assigned_to, t.customer_status, t.sla_status,
            t.first_response_due_at, t.triage_due_at, t.resolution_due_at,
            t.customer_message, t.metadata_json, t.last_seen_at,
            t.created_at AS ticket_created_at, t.updated_at AS ticket_updated_at,
            c.case_id, c.status AS case_status, c.severity AS case_severity,
            c.root_family, c.playbook_key, c.current_step_key, c.readback_status,
            c.owner_user_id, c.resource_ref, c.created_at AS case_created_at,
            c.updated_at AS case_updated_at,
            ${activity} AS latest_activity_at
       FROM tickets t
       ${caseJoinSql(hasTicketId)}
      WHERE ${conditions.join(" AND ")}
      LIMIT 1`,
    params
  );
  const row = rows?.[0];
  if (!row) {
    const error = new Error("Tenant request was not found in the caller's authorized scope.");
    error.status = 404;
    error.code = "tenant_request_not_found";
    throw error;
  }
  const canViewTenantAdmin = canViewTenantAdminTicketEvents(scope);
  const visibilitySql = ticketEventVisibilitySql(scope);
  const [ticketEvents] = await pool.query(
    `SELECT event_id, event_type, from_state, to_state, summary, visibility, payload_json, created_at
       FROM (
         SELECT id, event_id, event_type, from_state, to_state, summary, visibility, payload_json, created_at
           FROM ticket_lifecycle_events
          WHERE tenant_id = ? AND ticket_id = ? ${visibilitySql}
          ORDER BY created_at DESC, id DESC
          LIMIT 500
       ) bounded_ticket_events
      ORDER BY created_at ASC, id ASC`,
    [row.tenant_id, row.ticket_id]
  );
  let caseEvents = [];
  let readbacks = [];
  if (row.case_id) {
    [caseEvents] = await pool.query(
      `SELECT event_id, event_type, actor_type, actor_id, from_status, to_status,
              evidence_ref, event_json, created_at
         FROM (
           SELECT id, event_id, event_type, actor_type, actor_id, from_status, to_status,
                  evidence_ref, event_json, created_at
             FROM tenant_resolution_case_events
            WHERE case_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 500
         ) bounded_case_events
        ORDER BY created_at ASC, id ASC`,
      [row.case_id]
    );
    [readbacks] = await pool.query(
      `SELECT readback_id, decision, expected_state_json, observed_state_json,
              blocking_reasons_json, source_alerts_remaining_json, created_at
         FROM (
           SELECT id, readback_id, decision, expected_state_json, observed_state_json,
                  blocking_reasons_json, source_alerts_remaining_json, created_at
             FROM tenant_resolution_readbacks
            WHERE case_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 200
         ) bounded_readbacks
        ORDER BY created_at ASC, id ASC`,
      [row.case_id]
    );
  }
  const timeline = [
    ...ticketEvents
      .filter((event) => scope.isAdmin
        || event.visibility === "customer"
        || (canViewTenantAdmin && event.visibility === "tenant_admin"))
      .map(tenantVisibleTicketEvent),
    ...caseEvents.map((event) => caseEvent(event, scope.isAdmin)),
    ...readbacks.map((entry) => readbackRow(entry, scope.isAdmin)),
  ].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  return {
    ...projectInboxRow(row),
    timeline,
    authorization: {
      mode: scope.isAdmin ? "platform_admin" : "tenant_membership",
      tenantId: row.tenant_id,
      role: scope.role || null,
      tenantAdminEventsVisible: canViewTenantAdmin,
    },
    schema: { explicitTicketCaseLinkAvailable: hasTicketId },
    secretsIncluded: false,
  };
}

export const _testingTenantRequestInboxService = {
  boundedLimit,
  caseJoinSql,
  projectInboxRow,
  tenantVisibleTicketEvent,
  caseEvent,
  readbackRow,
};
