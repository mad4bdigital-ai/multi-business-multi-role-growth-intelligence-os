import { randomUUID } from "node:crypto";

const ALLOWED_STATUSES = new Set([
  "detected",
  "diagnosing",
  "needs_connection",
  "needs_approval",
  "ready_to_apply",
  "applying",
  "verifying",
  "resolved",
  "deferred_by_policy",
  "escalated",
  "blocked_missing_authority",
  "cancelled",
]);

const TENANT_SAFE_TRANSITIONS = Object.freeze({
  detected: new Set(["diagnosing", "escalated", "cancelled"]),
  diagnosing: new Set(["needs_connection", "needs_approval", "ready_to_apply", "blocked_missing_authority", "escalated", "cancelled"]),
  needs_connection: new Set(["diagnosing", "escalated", "cancelled"]),
  needs_approval: new Set(["diagnosing", "ready_to_apply", "deferred_by_policy", "escalated", "cancelled"]),
  ready_to_apply: new Set(["deferred_by_policy", "escalated", "cancelled"]),
  deferred_by_policy: new Set(["diagnosing", "escalated", "cancelled"]),
  escalated: new Set(["diagnosing", "cancelled"]),
  blocked_missing_authority: new Set(["diagnosing", "escalated", "cancelled"]),
  applying: new Set(),
  verifying: new Set(),
  resolved: new Set(),
  cancelled: new Set(),
});

const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie|payload_json|raw_prompt|system_prompt)/i;

async function defaultPool() {
  const { getPool } = await import("./db.js");
  return getPool();
}

function httpError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function safeString(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 40)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  if (typeof value === "string") return value.slice(0, 2000);
  return value;
}

function resolveSubject(sessionContext = {}, explicitSubject = {}) {
  const subject = sessionContext?.subject || {};
  const principal = sessionContext?.platform_access?.principal || {};
  return {
    tenant_id: explicitSubject.tenant_id || subject.tenant_id || principal.tenant_id || null,
    user_id: explicitSubject.user_id || subject.user_id || principal.user_id || null,
    is_admin: explicitSubject.is_admin === true || subject.is_admin === true || principal.is_admin === true,
  };
}

function requireTenantSubject(sessionContext, explicitSubject) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject || {});
  if (!subject.tenant_id) {
    throw httpError(403, "TENANT_RESOLUTION_TENANT_SCOPE_REQUIRED", "Tenant scope is required for resolution case access.");
  }
  return subject;
}

function normalizeWorkspaceScope(value) {
  return safeString(value, 64) || null;
}

function caseProjection(row = {}) {
  return {
    case_id: row.case_id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id || null,
    resource_ref: row.resource_ref || null,
    root_family: row.root_family,
    playbook_key: row.playbook_key,
    status: row.status,
    severity: row.severity,
    root_fingerprint_sha256: row.root_fingerprint_sha256,
    active_case_key: row.active_case_key || null,
    source_alert_keys: parseJsonValue(row.source_alert_keys_json, []),
    source_refs: parseJsonValue(row.source_refs_json, []),
    impact_summary: row.impact_summary || null,
    current_step_key: row.current_step_key || null,
    owner_user_id: row.owner_user_id || null,
    last_diagnostic: sanitizeValue(parseJsonValue(row.last_diagnostic_json, null)),
    last_preflight: sanitizeValue(parseJsonValue(row.last_preflight_json, null)),
    readback_status: row.readback_status || "not_run",
    last_readback_at: row.last_readback_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    closed_at: row.closed_at || null,
    secrets_included: false,
  };
}

function eventProjection(row = {}) {
  return {
    event_id: row.event_id,
    case_id: row.case_id,
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_id: row.actor_id || null,
    from_status: row.from_status || null,
    to_status: row.to_status || null,
    approval_hold_id: row.approval_hold_id || null,
    capability_envelope_id: row.capability_envelope_id || null,
    evidence_ref: row.evidence_ref || null,
    event: sanitizeValue(parseJsonValue(row.event_json, {})),
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

function normalizeListFilters({ status = null, rootFamily = null, severity = null, workspaceId = null } = {}) {
  const normalizedStatus = safeString(status, 64) || null;
  if (normalizedStatus && !ALLOWED_STATUSES.has(normalizedStatus)) {
    throw httpError(400, "TENANT_RESOLUTION_STATUS_INVALID", "Unsupported resolution case status.", {
      allowed_statuses: [...ALLOWED_STATUSES],
    });
  }
  return {
    status: normalizedStatus,
    rootFamily: safeString(rootFamily, 128) || null,
    severity: safeString(severity, 32) || null,
    workspaceId: normalizeWorkspaceScope(workspaceId),
  };
}

function buildCaseScopeWhere(subject, filters = {}, { includeCaseId = false } = {}) {
  const clauses = ["tenant_id = ?"];
  const params = [subject.tenant_id];
  if (includeCaseId) {
    clauses.push("case_id = ?");
    params.push(filters.caseId);
  }
  if (filters.workspaceId) {
    clauses.push("workspace_id = ?");
    params.push(filters.workspaceId);
  }
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.rootFamily) {
    clauses.push("root_family = ?");
    params.push(filters.rootFamily);
  }
  if (filters.severity) {
    clauses.push("severity = ?");
    params.push(filters.severity);
  }
  return { sql: clauses.join(" AND "), params };
}

async function withConnection(pool, fn, { transaction = false } = {}) {
  const conn = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const shouldRelease = conn !== pool && typeof conn.release === "function";
  try {
    if (transaction && typeof conn.beginTransaction === "function") await conn.beginTransaction();
    const result = await fn(conn);
    if (transaction && typeof conn.commit === "function") await conn.commit();
    return result;
  } catch (error) {
    if (transaction && typeof conn.rollback === "function") await conn.rollback();
    throw error;
  } finally {
    if (shouldRelease) conn.release();
  }
}

export async function listTenantResolutionCases({
  sessionContext = null,
  explicitSubject = {},
  cursor = 0,
  limit = 25,
  workspaceId = null,
  status = null,
  rootFamily = null,
  severity = null,
  pool = null,
} = {}) {
  const subject = requireTenantSubject(sessionContext, explicitSubject);
  const normalizedCursor = boundedInt(cursor, 0, 0, 1000000);
  const normalizedLimit = boundedInt(limit, 25, 1, 100);
  const filters = normalizeListFilters({ workspaceId, status, rootFamily, severity });
  const scope = buildCaseScopeWhere(subject, filters);
  const effectivePool = pool || await defaultPool();

  return withConnection(effectivePool, async (conn) => {
    const [countRows] = await conn.query(
      `SELECT COUNT(*) AS total_count FROM tenant_resolution_cases WHERE ${scope.sql}`,
      scope.params
    );
    const totalCount = Number(countRows[0]?.total_count || 0);
    const [rows] = await conn.query(
      `SELECT *
         FROM tenant_resolution_cases
        WHERE ${scope.sql}
        ORDER BY updated_at DESC, case_id DESC
        LIMIT ? OFFSET ?`,
      [...scope.params, normalizedLimit, normalizedCursor]
    );
    const items = rows.map(caseProjection);
    const nextCursor = normalizedCursor + items.length;
    return {
      ok: true,
      activation_layer: "tenant_resolution_case_lifecycle",
      items,
      page: {
        cursor: normalizedCursor,
        limit: normalizedLimit,
        returned_count: items.length,
        total_count: totalCount,
        has_more: nextCursor < totalCount,
        next_cursor: nextCursor < totalCount ? nextCursor : null,
      },
      filters: {
        workspace_id: filters.workspaceId,
        status: filters.status,
        root_family: filters.rootFamily,
        severity: filters.severity,
      },
      policy: {
        tenant_scoped: true,
        workspace_scope_enforced_when_provided: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        repair_apply_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

export async function getTenantResolutionCase({
  sessionContext = null,
  explicitSubject = {},
  caseId,
  workspaceId = null,
  eventLimit = 50,
  pool = null,
} = {}) {
  const subject = requireTenantSubject(sessionContext, explicitSubject);
  const normalizedCaseId = safeString(caseId, 64);
  if (!normalizedCaseId) {
    throw httpError(400, "TENANT_RESOLUTION_CASE_ID_REQUIRED", "caseId is required.");
  }
  const filters = {
    caseId: normalizedCaseId,
    workspaceId: normalizeWorkspaceScope(workspaceId),
  };
  const scope = buildCaseScopeWhere(subject, filters, { includeCaseId: true });
  const effectivePool = pool || await defaultPool();

  return withConnection(effectivePool, async (conn) => {
    const [rows] = await conn.query(
      `SELECT * FROM tenant_resolution_cases WHERE ${scope.sql} LIMIT 1`,
      scope.params
    );
    const row = rows[0] || null;
    if (!row) {
      throw httpError(404, "TENANT_RESOLUTION_CASE_NOT_FOUND", "Resolution case was not found within the caller scope.");
    }
    const boundedEventLimit = boundedInt(eventLimit, 50, 1, 100);
    const [eventRows] = await conn.query(
      `SELECT *
         FROM tenant_resolution_case_events
        WHERE case_id = ?
        ORDER BY created_at DESC, event_id DESC
        LIMIT ?`,
      [normalizedCaseId, boundedEventLimit]
    );
    return {
      ok: true,
      activation_layer: "tenant_resolution_case_lifecycle",
      case: caseProjection(row),
      events: eventRows.map(eventProjection),
      policy: {
        tenant_scoped: true,
        workspace_scope_enforced_when_provided: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        repair_apply_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

function assertTenantSafeTransition(fromStatus, toStatus) {
  if (!ALLOWED_STATUSES.has(toStatus)) {
    throw httpError(400, "TENANT_RESOLUTION_STATUS_INVALID", "Unsupported target resolution case status.", {
      target_status: toStatus,
      allowed_statuses: [...ALLOWED_STATUSES],
    });
  }
  if (fromStatus === toStatus) return { idempotent: true };
  const allowed = TENANT_SAFE_TRANSITIONS[fromStatus] || new Set();
  if (!allowed.has(toStatus)) {
    throw httpError(409, "TENANT_RESOLUTION_INVALID_TRANSITION", "The requested resolution case transition is not allowed.", {
      from_status: fromStatus,
      to_status: toStatus,
      allowed_next_statuses: [...allowed],
      applying_verifying_and_resolved_require_future_apply_or_readback_flows: true,
    });
  }
  return { idempotent: false };
}

export async function transitionTenantResolutionCase({
  sessionContext = null,
  explicitSubject = {},
  caseId,
  workspaceId = null,
  input = {},
  pool = null,
  uuid = randomUUID,
} = {}) {
  const subject = requireTenantSubject(sessionContext, explicitSubject);
  const normalizedCaseId = safeString(caseId, 64);
  if (!normalizedCaseId) {
    throw httpError(400, "TENANT_RESOLUTION_CASE_ID_REQUIRED", "caseId is required.");
  }
  const toStatus = safeString(input.to_status || input.status, 64);
  if (!toStatus) {
    throw httpError(400, "TENANT_RESOLUTION_TARGET_STATUS_REQUIRED", "to_status is required.");
  }
  const normalizedWorkspaceId = normalizeWorkspaceScope(workspaceId || input.workspace_id);
  const effectivePool = pool || await defaultPool();

  return withConnection(effectivePool, async (conn) => {
    const scope = buildCaseScopeWhere(subject, {
      caseId: normalizedCaseId,
      workspaceId: normalizedWorkspaceId,
    }, { includeCaseId: true });
    const [rows] = await conn.query(
      `SELECT * FROM tenant_resolution_cases WHERE ${scope.sql} LIMIT 1 FOR UPDATE`,
      scope.params
    );
    const current = rows[0] || null;
    if (!current) {
      throw httpError(404, "TENANT_RESOLUTION_CASE_NOT_FOUND", "Resolution case was not found within the caller scope.");
    }

    const transition = assertTenantSafeTransition(current.status, toStatus);
    if (transition.idempotent) {
      return {
        ok: true,
        activation_layer: "tenant_resolution_case_lifecycle",
        changed: false,
        case: caseProjection(current),
        idempotency: { same_status_returned: true },
        policy: {
          lifecycle_only: true,
          provider_call_allowed: false,
          external_write_allowed: false,
          repair_apply_allowed: false,
          resolved_transition_allowed: false,
          secrets_included: false,
        },
        secrets_included: false,
      };
    }

    const eventId = uuid();
    const currentStepKey = safeString(input.current_step_key || `status_${toStatus}`, 191);
    const note = safeString(input.note, 2000) || null;
    const evidenceRef = safeString(input.evidence_ref, 512) || null;
    const idempotencyKey = safeString(input.idempotency_key, 191) || null;
    const actorType = safeString(input.actor_type || "tenant_user", 64);
    const actorId = safeString(input.actor_id || subject.user_id, 191) || null;

    const [updateResult] = await conn.query(
      `UPDATE tenant_resolution_cases
          SET status = ?,
              current_step_key = ?,
              owner_user_id = COALESCE(owner_user_id, ?),
              active_case_key = CASE WHEN ? = 'cancelled' THEN NULL ELSE active_case_key END,
              closed_at = CASE WHEN ? = 'cancelled' THEN CURRENT_TIMESTAMP ELSE closed_at END,
              updated_at = CURRENT_TIMESTAMP
        WHERE case_id = ?
          AND tenant_id = ?
          AND status = ?`,
      [
        toStatus,
        currentStepKey,
        subject.user_id || null,
        toStatus,
        toStatus,
        normalizedCaseId,
        subject.tenant_id,
        current.status,
      ]
    );
    if (Number(updateResult?.affectedRows || 0) !== 1) {
      throw httpError(409, "TENANT_RESOLUTION_CASE_CONFLICT", "Resolution case changed concurrently. Read the case and retry.", {
        case_id: normalizedCaseId,
        expected_status: current.status,
      });
    }

    await conn.query(
      `INSERT INTO tenant_resolution_case_events (
         event_id, case_id, event_type, actor_type, actor_id, from_status, to_status,
         evidence_ref, event_json, secrets_included
       ) VALUES (?, ?, 'status_changed', ?, ?, ?, ?, ?, ?, 0)`,
      [
        eventId,
        normalizedCaseId,
        actorType,
        actorId,
        current.status,
        toStatus,
        evidenceRef,
        JSON.stringify(sanitizeValue({
          note,
          idempotency_key: idempotencyKey,
          current_step_key: currentStepKey,
          provider_call_allowed: false,
          external_write_allowed: false,
          repair_apply_allowed: false,
        })),
      ]
    );

    const [updatedRows] = await conn.query(
      `SELECT * FROM tenant_resolution_cases WHERE case_id = ? AND tenant_id = ? LIMIT 1`,
      [normalizedCaseId, subject.tenant_id]
    );
    return {
      ok: true,
      activation_layer: "tenant_resolution_case_lifecycle",
      changed: true,
      case: caseProjection(updatedRows[0]),
      event: {
        event_id: eventId,
        event_type: "status_changed",
        from_status: current.status,
        to_status: toStatus,
        secrets_included: false,
      },
      policy: {
        lifecycle_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        repair_apply_allowed: false,
        resolved_transition_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  }, { transaction: true });
}

export const _testingTenantResolutionCaseLifecycleService = {
  ALLOWED_STATUSES,
  TENANT_SAFE_TRANSITIONS,
  normalizeListFilters,
  assertTenantSafeTransition,
  caseProjection,
  eventProjection,
  sanitizeValue,
};
