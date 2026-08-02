import { createHash } from "node:crypto";
import { getPool } from "./db.js";

const OPEN_TICKET_STATUSES = new Set(["open", "in_review", "awaiting_approval"]);
const TEST_ENVIRONMENTS = new Set(["test", "testing", "ci", "qa", "staging", "development", "dev"]);
const REQUIRED_INTEGRITY_COLUMNS = Object.freeze([
  "is_test",
  "environment",
  "visibility_class",
  "target_capability",
  "related_ticket_id",
  "parent_ticket_id",
  "supersedes_ticket_id",
  "first_response_at",
  "triaged_at",
]);

const CUSTOMER_SAFE_TICKET_BASE_SELECT = `
  t.ticket_id,
  t.tenant_id,
  t.title,
  t.category,
  t.ticket_type,
  t.priority,
  t.severity,
  t.status,
  t.lifecycle_state,
  t.customer_status,
  t.queue_key,
  t.assignment_status,
  t.assigned_to,
  t.service_mode,
  t.dedupe_key,
  t.occurrence_count,
  t.customer_message,
  t.created_at,
  t.updated_at,
  t.last_seen_at,
  t.first_response_due_at,
  t.triage_due_at,
  t.resolution_due_at,
  t.sla_status,
  t.metadata_json
`;

const CUSTOMER_SAFE_INTEGRITY_SELECT = `
  ${CUSTOMER_SAFE_TICKET_BASE_SELECT},
  t.is_test,
  t.environment,
  t.visibility_class,
  t.target_capability,
  t.related_ticket_id,
  t.parent_ticket_id,
  t.supersedes_ticket_id
`;
const CUSTOMER_SAFE_TICKET_SELECT = CUSTOMER_SAFE_INTEGRITY_SELECT;
const CUSTOMER_SAFE_LEGACY_SELECT = `
  ${CUSTOMER_SAFE_TICKET_BASE_SELECT},
  0 AS is_test,
  'production' AS environment,
  'customer_visible' AS visibility_class,
  NULL AS target_capability,
  NULL AS related_ticket_id,
  NULL AS parent_ticket_id,
  NULL AS supersedes_ticket_id
`;

const LATEST_EVENT_ACTIVITY_SQL = `(
  SELECT MAX(activity_event.created_at)
    FROM ticket_lifecycle_events activity_event
   WHERE activity_event.tenant_id = t.tenant_id
     AND activity_event.ticket_id = t.ticket_id
)`;
const ACTIVITY_SQL = `GREATEST(
  COALESCE(t.last_seen_at, '1970-01-01 00:00:00'),
  COALESCE(t.updated_at, '1970-01-01 00:00:00'),
  COALESCE(t.created_at, '1970-01-01 00:00:00'),
  COALESCE(${LATEST_EVENT_ACTIVITY_SQL}, '1970-01-01 00:00:00')
)`;
const FIRST_RESPONSE_EVENT_SQL = `(
  SELECT MIN(e.created_at)
    FROM ticket_lifecycle_events e
   WHERE e.tenant_id = t.tenant_id
     AND e.ticket_id = t.ticket_id
     AND e.visibility = 'customer'
     AND e.event_type NOT IN ('ticket_created', 'dedupe_matched', 'queue_assigned')
     AND LOWER(COALESCE(e.actor_type, 'system')) NOT IN ('tenant_user', 'customer', 'user')
)`;
const TRIAGE_EVENT_SQL = `(
  SELECT MIN(e.created_at)
    FROM ticket_lifecycle_events e
   WHERE e.tenant_id = t.tenant_id
     AND e.ticket_id = t.ticket_id
     AND LOWER(COALESCE(e.actor_type, 'system')) NOT IN ('tenant_user', 'customer', 'user')
     AND (
       e.event_type IN ('triaged', 'ticket_triaged', 'assignee_changed', 'diagnostic_started')
       OR (
         e.event_type = 'state_transition'
         AND LOWER(COALESCE(e.to_state, '')) NOT IN ('', 'triage_pending', 'received')
       )
     )
)`;
const FIRST_RESPONSE_EVIDENCE_SQL = `COALESCE(t.first_response_at, ${FIRST_RESPONSE_EVENT_SQL})`;
const TRIAGE_EVIDENCE_SQL = `COALESCE(t.triaged_at, ${TRIAGE_EVENT_SQL})`;
const LEGACY_TEST_EVIDENCE_SQL = `(
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.metadata_json, '$.is_test')), '') IN ('true','1')
  OR (
    JSON_EXTRACT(t.metadata_json, '$.is_test') IS NULL
    AND (
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.metadata_json, '$.admin_simulation')), 'false') IN ('true','1')
      OR LOWER(COALESCE(
        JSON_UNQUOTE(JSON_EXTRACT(t.metadata_json, '$.environment')),
        JSON_UNQUOTE(JSON_EXTRACT(t.metadata_json, '$.runtime_environment')),
        'production'
      )) IN ('test','testing','ci','qa','staging','development','dev')
    )
  )
)`;

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}
function normalizeLower(value, fallback = "") {
  return normalizeString(value, fallback).toLowerCase();
}
function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
function stableCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value ?? null);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(value[key])}`).join(",")}}`;
}
function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") ?? null;
}
function parseExplicitBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = normalizeLower(value);
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}
function toValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function customerSafeTicket(row = {}) {
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
    latest_activity_at: row.latest_activity_at || null,
    first_response_due_at: row.first_response_due_at || null,
    triage_due_at: row.triage_due_at || null,
    resolution_due_at: row.resolution_due_at || null,
    first_response_at: row.first_response_at || null,
    triaged_at: row.triaged_at || null,
    sla_status: row.sla_status || null,
    metadata_json: parseJsonObject(row.metadata_json, null),
    is_test: Boolean(row.is_test),
    environment: row.environment || "production",
    visibility_class: row.visibility_class || "customer_visible",
    target_capability: row.target_capability || null,
    related_ticket_id: row.related_ticket_id || null,
    parent_ticket_id: row.parent_ticket_id || null,
    supersedes_ticket_id: row.supersedes_ticket_id || null,
    secrets_included: false,
  };
}

export function deriveSupportTicketIntegrity(envelope = {}, options = {}) {
  const metadata = parseJsonObject(envelope.metadata_json || envelope.metadata, {});
  const storedRow = options.stored_row === true;
  const v2StoredContract = normalizeLower(metadata.ticket_integrity_contract) === "support-ticket-integrity-v2";
  const legacyStoredRow = storedRow && !v2StoredContract;
  const storedEnvironment = normalizeLower(envelope.environment);
  const storedVisibility = normalizeLower(envelope.visibility_class);
  const environment = normalizeLower(
    legacyStoredRow
      ? firstDefined(
          metadata.environment,
          metadata.runtime_environment,
          storedEnvironment && storedEnvironment !== "production" ? storedEnvironment : null,
        )
      : firstDefined(envelope.environment, metadata.environment, metadata.runtime_environment),
    "production",
  );
  const explicitIsTest = legacyStoredRow
    ? firstDefined(metadata.is_test)
    : firstDefined(envelope.is_test, metadata.is_test);
  const explicitIsTestBoolean = parseExplicitBoolean(explicitIsTest);
  const trustedSimulation = parseExplicitBoolean(metadata.admin_simulation) === true
    || normalizeLower(envelope.actor_type) === "admin_simulation";
  const isTest = explicitIsTestBoolean !== null
    ? explicitIsTestBoolean
    : trustedSimulation || TEST_ENVIRONMENTS.has(environment);
  const requestedVisibility = normalizeLower(
    legacyStoredRow
      ? firstDefined(
          metadata.visibility_class,
          storedVisibility && storedVisibility !== "customer_visible" ? storedVisibility : null,
        )
      : firstDefined(envelope.visibility_class, metadata.visibility_class),
    isTest ? "internal_test" : "customer_visible",
  );
  return {
    is_test: isTest,
    environment,
    visibility_class: isTest ? "internal_test" : requestedVisibility,
    target_capability: normalizeString(firstDefined(
      envelope.target_capability,
      metadata.target_capability,
      metadata.capability_key,
      metadata.requested_capability,
    )) || null,
    parent_ticket_id: normalizeString(firstDefined(
      envelope.intended_parent_ticket_id,
      envelope.parent_ticket_id,
      metadata.intended_parent_ticket_id,
      metadata.parent_ticket_id,
    )) || null,
    related_ticket_id: normalizeString(firstDefined(
      envelope.related_ticket_id,
      metadata.related_ticket_id,
    )) || null,
    supersedes_ticket_id: normalizeString(firstDefined(
      envelope.supersedes_ticket_id,
      metadata.supersedes_ticket_id,
    )) || null,
    secrets_included: false,
  };
}

export function computeSupportTicketDedupeKeyV2(envelope = {}) {
  const metadata = parseJsonObject(envelope.metadata_json || envelope.metadata, {});
  const integrity = deriveSupportTicketIntegrity(envelope);
  const canonical = {
    tenant_id: normalizeString(envelope.tenant_id, "tenantless"),
    user_id: normalizeString(envelope.user_id, "any_user"),
    ticket_type: normalizeLower(firstDefined(envelope.ticket_type, envelope.issue_type, envelope.source_event), "general_support"),
    target_capability: integrity.target_capability || "none",
    resource_type: normalizeLower(firstDefined(envelope.resource?.type, envelope.resource_type), "none"),
    resource_ref: normalizeString(firstDefined(envelope.resource?.ref, envelope.resource_ref), "none"),
    intended_parent_ticket_id: integrity.parent_ticket_id || "none",
    relationship: normalizeLower(firstDefined(envelope.resource?.relationship, metadata.resource_relationship), "subject"),
    is_test: integrity.is_test,
    environment: integrity.environment,
    visibility_class: integrity.visibility_class,
  };
  const digest = createHash("sha256").update(stableCanonicalJson(canonical)).digest("hex");
  return `ticket:v2:${digest}`;
}

export function computeSupportTicketSlaStatusV2(row = {}, nowInput = new Date()) {
  const now = toValidDate(nowInput) || new Date();
  const status = normalizeLower(row.status, "open");
  if (!OPEN_TICKET_STATUSES.has(status)) {
    return {
      status: normalizeLower(row.sla_status, "on_track"),
      reason: "ticket_not_open",
      breached_milestones: [],
      warning_milestones: [],
      secrets_included: false,
    };
  }
  const milestones = [
    { key: "first_response", due: toValidDate(row.first_response_due_at), completed: toValidDate(row.first_response_at) },
    { key: "triage", due: toValidDate(row.triage_due_at), completed: toValidDate(row.triaged_at) },
    { key: "resolution", due: toValidDate(row.resolution_due_at), completed: null },
  ].filter((milestone) => milestone.due && !milestone.completed);
  const breached = milestones.filter((milestone) => milestone.due.getTime() < now.getTime());
  if (breached.length) {
    return {
      status: "breached",
      reason: `${breached[0].key}_past_due`,
      breached_milestones: breached.map((milestone) => milestone.key),
      warning_milestones: [],
      secrets_included: false,
    };
  }
  const warningThreshold = now.getTime() + 60 * 60 * 1000;
  const warning = milestones.filter((milestone) => milestone.due.getTime() <= warningThreshold);
  if (warning.length) {
    return {
      status: "warning",
      reason: `${warning[0].key}_within_60m`,
      breached_milestones: [],
      warning_milestones: warning.map((milestone) => milestone.key),
      secrets_included: false,
    };
  }
  return {
    status: "on_track",
    reason: milestones.length ? "pending_milestones_on_track" : "all_due_milestones_completed",
    breached_milestones: [],
    warning_milestones: [],
    secrets_included: false,
  };
}

export function resolveSupportTicketLifecyclePatch(row = {}) {
  const status = normalizeLower(row.status);
  const lifecycleState = normalizeLower(row.lifecycle_state);
  const customerStatus = normalizeLower(row.customer_status);
  const internallyResolved = ["resolved", "resolved_runtime_validated", "verified"].includes(lifecycleState)
    && ["resolved", "resolved_runtime_validated"].includes(customerStatus);
  if (OPEN_TICKET_STATUSES.has(status) && internallyResolved) {
    return {
      should_update: true,
      status: "resolved",
      lifecycle_state: lifecycleState,
      customer_status: customerStatus,
      reason: "internally_resolved_ticket_still_open",
      secrets_included: false,
    };
  }
  return {
    should_update: false,
    status: row.status || null,
    lifecycle_state: row.lifecycle_state || null,
    customer_status: row.customer_status || null,
    reason: "lifecycle_consistent",
    secrets_included: false,
  };
}

async function readIntegritySchema(connection) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'tickets'
        AND COLUMN_NAME IN (?)`,
    [REQUIRED_INTEGRITY_COLUMNS],
  );
  const available = new Set(rows.map((row) => row.COLUMN_NAME || row.column_name));
  const missing = REQUIRED_INTEGRITY_COLUMNS.filter((column) => !available.has(column));
  return {
    ready: missing.length === 0,
    available_columns: [...available].sort(),
    missing_columns: missing,
    secrets_included: false,
  };
}

export async function listSupportTicketsWithIntegrity({
  tenant_id,
  user_id,
  status = null,
  include_test = false,
  limit = 100,
} = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = await pool.getConnection();
  try {
    const schema = await readIntegritySchema(connection);
    const params = [tenant_id, user_id];
    const filters = ["t.tenant_id = ?", "(t.user_id = ? OR t.user_id IS NULL)"];
    if (status) {
      filters.push("t.status = ?");
      params.push(status);
    }
    if (!include_test) {
      if (schema.ready) {
        filters.push("COALESCE(t.is_test, 0) = 0");
        filters.push(`NOT (
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.metadata_json, '$.ticket_integrity_contract')), '') <> 'support-ticket-integrity-v2'
          AND ${LEGACY_TEST_EVIDENCE_SQL}
        )`);
      } else {
        filters.push(`NOT ${LEGACY_TEST_EVIDENCE_SQL}`);
      }
    }
    const projection = schema.ready ? CUSTOMER_SAFE_TICKET_SELECT : CUSTOMER_SAFE_LEGACY_SELECT;
    const firstResponseEvidence = schema.ready ? FIRST_RESPONSE_EVIDENCE_SQL : FIRST_RESPONSE_EVENT_SQL;
    const triageEvidence = schema.ready ? TRIAGE_EVIDENCE_SQL : TRIAGE_EVENT_SQL;
    const max = Math.min(Math.max(Number(limit) || 100, 1), 200);
    params.push(max);
    const [rows] = await connection.query(
      `SELECT ${projection},
              ${firstResponseEvidence} AS first_response_at,
              ${triageEvidence} AS triaged_at,
              ${ACTIVITY_SQL} AS latest_activity_at
         FROM tickets t
        WHERE ${filters.join(" AND ")}
        ORDER BY latest_activity_at DESC, t.ticket_id DESC
        LIMIT ?`,
      params,
    );
    return {
      ok: true,
      tickets: rows.map(customerSafeTicket),
      count: rows.length,
      include_test: Boolean(include_test),
      schema_ready: schema.ready,
      schema_missing_columns: schema.missing_columns,
      secrets_included: false,
    };
  } finally {
    connection.release();
  }
}

export async function reconcileSupportTicketIntegrity({
  tenant_id = null,
  limit = 100,
  cursor_activity_at = null,
  cursor_ticket_id = null,
  apply = false,
} = {}, options = {}) {
  if (apply) {
    const error = new Error("Apply mode must use the effective-lifecycle reconciliation service.");
    error.status = 409;
    error.code = "support_ticket_integrity_apply_service_required";
    throw error;
  }
  const pool = options.pool || getPool();
  const connection = await pool.getConnection();
  const max = Math.min(Math.max(Number(limit) || 100, 1), 250);
  try {
    const schema = await readIntegritySchema(connection);
    if (Boolean(cursor_activity_at) !== Boolean(cursor_ticket_id)) {
      const error = new Error("cursor_activity_at and cursor_ticket_id must be supplied together.");
      error.status = 400;
      error.code = "support_ticket_integrity_cursor_incomplete";
      throw error;
    }
    const params = [];
    const filters = ["t.status IN ('open','in_review','awaiting_approval')"];
    if (tenant_id) {
      filters.push("t.tenant_id = ?");
      params.push(tenant_id);
    }
    if (cursor_activity_at && cursor_ticket_id) {
      filters.push(`(
        ${ACTIVITY_SQL} < ?
        OR (${ACTIVITY_SQL} = ? AND t.ticket_id < ?)
      )`);
      params.push(cursor_activity_at, cursor_activity_at, cursor_ticket_id);
    }
    const storedMilestoneProjection = schema.ready
      ? `t.first_response_at AS stored_first_response_at,
         t.triaged_at AS stored_triaged_at,
         ${FIRST_RESPONSE_EVIDENCE_SQL} AS first_response_at,
         ${TRIAGE_EVIDENCE_SQL} AS triaged_at`
      : `NULL AS stored_first_response_at,
         NULL AS stored_triaged_at,
         ${FIRST_RESPONSE_EVENT_SQL} AS first_response_at,
         ${TRIAGE_EVENT_SQL} AS triaged_at`;
    params.push(max + 1);
    const [queriedRows] = await connection.query(
      `SELECT t.*,
              ${storedMilestoneProjection},
              ${ACTIVITY_SQL} AS reconciliation_activity_at
         FROM tickets t
        WHERE ${filters.join(" AND ")}
        ORDER BY reconciliation_activity_at DESC, t.ticket_id DESC
        LIMIT ?`,
      params,
    );
    const hasMore = queriedRows.length > max;
    const rows = queriedRows.slice(0, max);
    const lastRow = rows.at(-1) || null;
    const now = new Date();
    const findings = rows.map((row) => {
      const integrity = deriveSupportTicketIntegrity({
        ...row,
        metadata_json: parseJsonObject(row.metadata_json, {}),
      }, { stored_row: true });
      const sla = computeSupportTicketSlaStatusV2(row, now);
      const lifecycle = resolveSupportTicketLifecyclePatch(row);
      const backfillLastSeen = !row.last_seen_at;
      const urgentUnassigned = normalizeLower(row.priority) === "urgent" && !row.assigned_to;
      const milestoneEvidenceMissing = (
        (!row.stored_first_response_at && row.first_response_at)
        || (!row.stored_triaged_at && row.triaged_at)
      );
      const needsIntegrityUpdate = schema.ready && (
        Boolean(row.is_test) !== integrity.is_test
        || normalizeLower(row.environment, "production") !== integrity.environment
        || normalizeLower(row.visibility_class, integrity.is_test ? "internal_test" : "customer_visible") !== integrity.visibility_class
        || (!row.parent_ticket_id && integrity.parent_ticket_id)
        || (!row.related_ticket_id && integrity.related_ticket_id)
        || (!row.supersedes_ticket_id && integrity.supersedes_ticket_id)
        || (!row.target_capability && integrity.target_capability)
        || milestoneEvidenceMissing
      );
      return {
        ticket_id: row.ticket_id,
        tenant_id: row.tenant_id,
        title: row.title,
        sla: {
          current_status: normalizeLower(row.sla_status, "on_track"),
          computed_status: sla.status,
          reason: sla.reason,
          should_update: normalizeLower(row.sla_status, "on_track") !== sla.status,
          breached_milestones: sla.breached_milestones,
          warning_milestones: sla.warning_milestones,
        },
        lifecycle,
        integrity,
        milestone_evidence: {
          first_response_at: row.first_response_at || null,
          triaged_at: row.triaged_at || null,
          first_response_backfill_required: Boolean(!row.stored_first_response_at && row.first_response_at),
          triage_backfill_required: Boolean(!row.stored_triaged_at && row.triaged_at),
          secrets_included: false,
        },
        backfill_last_seen_at: backfillLastSeen,
        urgent_unassigned: urgentUnassigned,
        should_update: lifecycle.should_update
          || normalizeLower(row.sla_status, "on_track") !== sla.status
          || backfillLastSeen
          || needsIntegrityUpdate,
        reconciliation_activity_at: row.reconciliation_activity_at,
        secrets_included: false,
      };
    });
    return {
      ok: true,
      mode: "dry_run",
      count: findings.length,
      update_count: findings.filter((finding) => finding.should_update).length,
      urgent_unassigned_count: findings.filter((finding) => finding.urgent_unassigned).length,
      test_ticket_count: findings.filter((finding) => finding.integrity.is_test).length,
      has_more: hasMore,
      next_cursor: hasMore && lastRow
        ? { activity_at: lastRow.reconciliation_activity_at, ticket_id: lastRow.ticket_id }
        : null,
      schema,
      findings,
      secrets_included: false,
    };
  } finally {
    connection.release();
  }
}

export function _testingSupportTicketLifecycleIntegrity() {
  return {
    REQUIRED_INTEGRITY_COLUMNS,
    TEST_ENVIRONMENTS,
    CUSTOMER_SAFE_TICKET_BASE_SELECT,
    CUSTOMER_SAFE_TICKET_SELECT,
    CUSTOMER_SAFE_INTEGRITY_SELECT,
    CUSTOMER_SAFE_LEGACY_SELECT,
    ACTIVITY_SQL,
    LATEST_EVENT_ACTIVITY_SQL,
    FIRST_RESPONSE_EVENT_SQL,
    TRIAGE_EVENT_SQL,
    FIRST_RESPONSE_EVIDENCE_SQL,
    TRIAGE_EVIDENCE_SQL,
    LEGACY_TEST_EVIDENCE_SQL,
    stableCanonicalJson,
  };
}
