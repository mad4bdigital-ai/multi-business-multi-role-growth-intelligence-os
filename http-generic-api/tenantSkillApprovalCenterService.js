import { createHash, randomUUID } from "node:crypto";
import { applyTenantAgentSkillGrantRequestDecision } from "./agentSkillGrantRequestService.js";

const OWNER_ROLES = new Set(["owner", "tenant_owner", "workspace_owner", "admin"]);
const DECISIONS = new Set(["approve", "reject", "defer"]);
const STATUS_FILTERS = new Set(["pending", "approved", "rejected", "deferred", "expired"]);
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

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function parseJsonValue(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 60)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  if (typeof value === "string") return value.slice(0, 2000);
  return value;
}

function isoValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolveSubject(sessionContext = {}, explicitSubject = {}) {
  const subject = sessionContext?.subject || {};
  const principal = sessionContext?.platform_access?.principal || {};
  return {
    tenant_id: explicitSubject.tenant_id || subject.tenant_id || principal.tenant_id || null,
    user_id: explicitSubject.user_id || subject.user_id || principal.user_id || null,
    tenant_role: safeString(explicitSubject.tenant_role || subject.tenant_role || principal.tenant_role, 64).toLowerCase() || null,
    is_admin: explicitSubject.is_admin === true || subject.is_admin === true || principal.is_admin === true,
  };
}

function requireTenantSubject(sessionContext, explicitSubject) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject || {});
  if (!subject.tenant_id || !subject.user_id) {
    throw httpError(403, "TENANT_SKILL_APPROVAL_SCOPE_REQUIRED", "Tenant and user scope are required for the skill approval center.");
  }
  return subject;
}

function requireOwnerRole(subject) {
  if (!OWNER_ROLES.has(subject.tenant_role || "")) {
    throw httpError(403, "TENANT_SKILL_APPROVAL_OWNER_REQUIRED", "Workspace owner or tenant administrator approval is required.", {
      allowed_roles: [...OWNER_ROLES],
      tenant_role: subject.tenant_role,
    });
  }
}

function grantScope(row = {}) {
  return row.tenant_id ? "tenant" : "global";
}

function approvalKeyFor(row = {}, tenantId) {
  const canonical = [
    tenantId,
    grantScope(row),
    row.brand_key || "global",
    row.agent_id,
    row.skill_id,
  ].join("|");
  return `skill-approval.${sha256(canonical)}`;
}

function effectiveGrantStatus(row = {}, now = new Date()) {
  if (row.grant_status !== "active") return row.grant_status || "unknown";
  const expiresAt = row.grant_expires_at ? new Date(row.grant_expires_at) : null;
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= now) return "expired";
  return "active";
}

function effectiveHoldStatus(hold = null, now = new Date()) {
  if (!hold) return "pending";
  const expiresAt = hold.expires_at ? new Date(hold.expires_at) : null;
  if (hold.status === "open" && expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= now) return "expired";
  const context = parseJsonValue(hold.execution_context_json, {});
  if (hold.status === "open" && context.decision_state === "deferred") return "deferred";
  if (hold.status === "open") return "pending";
  if (["approved", "rejected", "expired"].includes(hold.status)) return hold.status;
  return hold.status || "pending";
}

function groupGrantRows(rows = [], tenantId, now = new Date()) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.agent_id || !row.skill_id) continue;
    const approvalKey = approvalKeyFor(row, tenantId);
    const current = groups.get(approvalKey) || {
      approval_key: approvalKey,
      tenant_id: tenantId,
      grant_scope: grantScope(row),
      tenant_decision_allowed: Boolean(row.tenant_id),
      brand_key: row.brand_key || null,
      agent_id: row.agent_id,
      agent_name: row.agent_name || null,
      agent_display_name: row.agent_display_name || null,
      skill_id: row.skill_id,
      skill_key: row.skill_key,
      skill_display_name: row.skill_display_name || null,
      skill_type: row.skill_type || null,
      skill_scope: row.skill_scope || null,
      requires_approval: Number(row.requires_approval || 0) === 1,
      request_ids: [],
      approval_hold_ids: [],
      request_status: null,
      approval_policy_key: null,
      active_grant_ids: [],
      revoked_grant_ids: [],
      expired_grant_ids: [],
      all_grant_ids: [],
      first_granted_at: null,
      last_granted_at: null,
    };
    const grantStatus = effectiveGrantStatus(row, now);
    if (row.grant_id) {
      current.all_grant_ids.push(row.grant_id);
      if (grantStatus === "active") current.active_grant_ids.push(row.grant_id);
      else if (grantStatus === "revoked") current.revoked_grant_ids.push(row.grant_id);
      else if (grantStatus === "expired") current.expired_grant_ids.push(row.grant_id);
    }
    if (row.grant_request_id && !current.request_ids.includes(row.grant_request_id)) {
      current.request_ids.push(row.grant_request_id);
    }
    if (row.approval_hold_id && !current.approval_hold_ids.includes(row.approval_hold_id)) {
      current.approval_hold_ids.push(row.approval_hold_id);
    }
    if (row.request_status) current.request_status = row.request_status;
    if (row.approval_policy_key) current.approval_policy_key = row.approval_policy_key;
    const grantedAt = isoValue(row.granted_at);
    if (grantedAt && (!current.first_granted_at || grantedAt < current.first_granted_at)) current.first_granted_at = grantedAt;
    if (grantedAt && (!current.last_granted_at || grantedAt > current.last_granted_at)) current.last_granted_at = grantedAt;
    groups.set(approvalKey, current);
  }
  return [...groups.values()];
}

function latestHoldsByApprovalKey(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const context = parseJsonValue(row.execution_context_json, {});
    const hold = { ...row, context };
    const approvalKey = safeString(context.approval_key, 128);
    const requestId = safeString(context.request_id || row.request_id, 64);
    if (approvalKey && !map.has(approvalKey)) map.set(approvalKey, hold);
    if (requestId && !map.has(`request:${requestId}`)) map.set(`request:${requestId}`, hold);
  }
  return map;
}

function holdForGroup(group, holds) {
  for (const requestId of group.request_ids || []) {
    const hold = holds.get(`request:${requestId}`);
    if (hold) return hold;
  }
  return holds.get(group.approval_key) || null;
}

function effectiveApprovalStatus(group, hold, now = new Date()) {
  if (["pending", "approved", "rejected", "deferred", "expired"].includes(group.request_status)) {
    return group.request_status;
  }
  return effectiveHoldStatus(hold, now);
}

function holdProjection(hold = null, now = new Date()) {
  if (!hold) return null;
  const context = hold.context || parseJsonValue(hold.execution_context_json, {});
  return {
    hold_id: hold.hold_id,
    workspace_id: hold.workspace_id || null,
    hold_type: hold.hold_type,
    required_role: hold.required_role || null,
    status: hold.status,
    effective_status: effectiveHoldStatus(hold, now),
    decision_by: hold.decision_by || null,
    decision_note: hold.decision_note || null,
    decision_state: context.decision_state || null,
    deferred_until: context.deferred_until || null,
    expires_at: isoValue(hold.expires_at),
    decided_at: isoValue(hold.decided_at),
    created_at: isoValue(hold.created_at),
    secrets_included: false,
  };
}

function readbackFor(group, hold, now = new Date()) {
  const effectiveStatus = effectiveApprovalStatus(group, hold, now);
  const activeGrantCount = group.active_grant_ids.length;
  let status = "not_run";
  let passed = false;
  if (effectiveStatus === "approved") {
    passed = activeGrantCount > 0;
    status = passed ? "passed" : "failed";
  } else if (effectiveStatus === "rejected") {
    passed = activeGrantCount === 0;
    status = passed ? "passed" : "failed";
  } else if (effectiveStatus === "deferred") {
    status = "blocked";
  } else if (effectiveStatus === "expired") {
    status = "failed";
  }
  return {
    status,
    passed,
    effective_decision: effectiveStatus,
    active_grant_count: activeGrantCount,
    revoked_grant_count: group.revoked_grant_ids.length,
    expired_grant_count: group.expired_grant_ids.length,
    checked_at: now.toISOString(),
    authority: "agent_skill_grant_requests_plus_effective_grant_readback",
    secrets_included: false,
  };
}

function approvalItem(group, hold, now = new Date()) {
  const holdView = holdProjection(hold, now);
  return {
    ...group,
    status: effectiveApprovalStatus(group, hold, now),
    hold: holdView,
    readback: readbackFor(group, hold, now),
    policy: {
      tenant_owner_decision_required: true,
      global_grant_tenant_decision_allowed: false,
      provider_call_allowed: false,
      external_write_allowed: false,
      execution_dispatched: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function normalizeListFilters({ status = null, workspaceId = null, q = null } = {}) {
  const normalizedStatus = safeString(status, 32).toLowerCase() || null;
  if (normalizedStatus && !STATUS_FILTERS.has(normalizedStatus)) {
    throw httpError(400, "TENANT_SKILL_APPROVAL_STATUS_INVALID", "Unsupported approval status filter.", {
      allowed_statuses: [...STATUS_FILTERS],
    });
  }
  return {
    status: normalizedStatus,
    workspace_id: safeString(workspaceId, 64) || null,
    q: safeString(q, 300).toLowerCase() || null,
  };
}

async function loadGrantRows(connection, tenantId) {
  const [rows] = await connection.query(
    `SELECT g.grant_id, g.grant_request_id, g.tenant_id, g.brand_key, g.agent_id,
            a.name AS agent_name, a.display_name AS agent_display_name,
            g.skill_id, s.skill_key, s.display_name AS skill_display_name,
            s.skill_type, s.scope AS skill_scope, s.requires_approval,
            g.status AS grant_status, g.expires_at AS grant_expires_at, g.granted_at,
            r.request_status, r.approval_policy_key, r.approval_hold_id,
            r.requested_at, r.decided_at AS request_decided_at
       FROM agent_skill_grants g
       JOIN agent_skills s ON s.skill_id = g.skill_id AND s.status = 'active'
       LEFT JOIN agent_skill_grant_requests r ON r.request_id = g.grant_request_id
       LEFT JOIN agents a ON a.agent_id = g.agent_id
      WHERE s.requires_approval = 1
        AND (g.tenant_id = ? OR g.tenant_id IS NULL)
      ORDER BY COALESCE(r.requested_at, g.granted_at) DESC, g.grant_id DESC
      LIMIT 2000`,
    [tenantId]
  );
  return rows;
}

async function loadApprovalHolds(connection, tenantId, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT hold_id, run_id, tenant_id, workspace_id, hold_type, requested_by,
            user_id, actor_id, actor_type, brand_key, request_id, correlation_id,
            execution_context_json, required_role, status, decision_by,
            decision_note, expires_at, decided_at, created_at
       FROM approval_holds
      WHERE tenant_id = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(execution_context_json, '$.approval_type'))
            IN ('tenant_skill_grant', 'agent_skill_grant_request')
      ORDER BY created_at DESC, hold_id DESC
      LIMIT 2000${forUpdate ? " FOR UPDATE" : ""}`,
    [tenantId]
  );
  return rows;
}

async function withConnection(pool, callback, { transaction = false } = {}) {
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const shouldRelease = connection !== pool && typeof connection.release === "function";
  try {
    if (transaction && typeof connection.beginTransaction === "function") await connection.beginTransaction();
    const result = await callback(connection);
    if (transaction && typeof connection.commit === "function") await connection.commit();
    return result;
  } catch (error) {
    if (transaction && typeof connection.rollback === "function") await connection.rollback();
    throw error;
  } finally {
    if (shouldRelease) connection.release();
  }
}

export async function listTenantSkillApprovals({
  sessionContext = null,
  explicitSubject = {},
  cursor = 0,
  limit = 25,
  status = null,
  workspaceId = null,
  q = null,
  pool = null,
  now = () => new Date(),
} = {}) {
  const subject = requireTenantSubject(sessionContext, explicitSubject);
  const normalizedCursor = boundedInt(cursor, 0, 0, 1000000);
  const normalizedLimit = boundedInt(limit, 25, 1, 100);
  const filters = normalizeListFilters({ status, workspaceId, q });
  const effectivePool = pool || await defaultPool();
  const nowValue = now();

  return withConnection(effectivePool, async (connection) => {
    const grantRows = await loadGrantRows(connection, subject.tenant_id);
    const holdRows = await loadApprovalHolds(connection, subject.tenant_id);
    const holds = latestHoldsByApprovalKey(holdRows);
    let items = groupGrantRows(grantRows, subject.tenant_id, nowValue)
      .map((group) => approvalItem(group, holdForGroup(group, holds), nowValue));

    if (filters.workspace_id) {
      items = items.filter((item) => !item.hold?.workspace_id || item.hold.workspace_id === filters.workspace_id);
    }
    if (filters.status) items = items.filter((item) => item.status === filters.status);
    if (filters.q) {
      items = items.filter((item) => [
        item.agent_id,
        item.agent_name,
        item.agent_display_name,
        item.skill_key,
        item.skill_display_name,
        item.brand_key,
      ].some((value) => String(value || "").toLowerCase().includes(filters.q)));
    }
    items.sort((left, right) => {
      const statusWeight = { pending: 5, deferred: 4, expired: 3, rejected: 2, approved: 1 };
      return (statusWeight[right.status] || 0) - (statusWeight[left.status] || 0)
        || String(right.last_granted_at || "").localeCompare(String(left.last_granted_at || ""));
    });

    const totalCount = items.length;
    const pageItems = items.slice(normalizedCursor, normalizedCursor + normalizedLimit);
    const nextCursor = normalizedCursor + pageItems.length;
    return {
      ok: true,
      activation_layer: "tenant_skill_approval_center",
      items: pageItems,
      page: {
        cursor: normalizedCursor,
        limit: normalizedLimit,
        returned_count: pageItems.length,
        total_count: totalCount,
        has_more: nextCursor < totalCount,
        next_cursor: nextCursor < totalCount ? nextCursor : null,
      },
      filters,
      policy: {
        tenant_scoped: true,
        owner_only_decisions: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        execution_dispatched: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

function normalizeDecisionInput(input = {}, now = new Date()) {
  const decision = safeString(input.decision, 32).toLowerCase();
  if (!DECISIONS.has(decision)) {
    throw httpError(400, "TENANT_SKILL_APPROVAL_DECISION_INVALID", "Unsupported skill approval decision.", {
      allowed_decisions: [...DECISIONS],
    });
  }
  const ttlHours = boundedInt(input.ttl_hours, 168, 1, 24 * 90);
  let deferUntil = null;
  if (decision === "defer") {
    deferUntil = input.defer_until ? new Date(input.defer_until) : new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
    if (Number.isNaN(deferUntil.getTime()) || deferUntil <= now) {
      throw httpError(400, "TENANT_SKILL_APPROVAL_DEFER_UNTIL_INVALID", "defer_until must be a future timestamp.");
    }
  }
  return {
    decision,
    decision_note: safeString(input.decision_note, 512) || null,
    workspace_id: safeString(input.workspace_id, 64) || null,
    defer_until: deferUntil,
    grant_ttl_hours: input.grant_ttl_hours === null || input.grant_ttl_hours === undefined
      ? null
      : boundedInt(input.grant_ttl_hours, 720, 1, 24 * 365),
    idempotency_key: safeString(input.idempotency_key, 191) || null,
  };
}

function matchingGroupOrThrow(grantRows, tenantId, approvalKey, nowValue) {
  const group = groupGrantRows(grantRows, tenantId, nowValue)
    .find((item) => item.approval_key === approvalKey);
  if (!group) {
    throw httpError(404, "TENANT_SKILL_APPROVAL_NOT_FOUND", "Skill approval item was not found within the caller tenant.");
  }
  if (!group.tenant_decision_allowed) {
    throw httpError(403, "TENANT_SKILL_APPROVAL_PLATFORM_SCOPE_REQUIRED", "Global skill grants require platform approval and cannot be changed by a tenant owner.", {
      approval_key: approvalKey,
      grant_scope: group.grant_scope,
    });
  }
  return group;
}

async function createApprovalHold(connection, { subject, group, normalized, uuid, nowValue }) {
  if (!group.request_ids?.length) {
    throw httpError(409, "TENANT_SKILL_GRANT_REQUEST_REQUIRED", "The approval item is not linked to a canonical grant request.", {
      approval_key: group.approval_key,
    });
  }
  const holdId = uuid();
  const primaryRequestId = group.request_ids[0];
  const context = sanitizeValue({
    approval_type: "agent_skill_grant_request",
    approval_key: group.approval_key,
    request_id: primaryRequestId,
    request_ids: group.request_ids,
    decision_state: "open",
    tenant_id: subject.tenant_id,
    workspace_id: normalized.workspace_id,
    brand_key: group.brand_key,
    agent_id: group.agent_id,
    skill_id: group.skill_id,
    skill_key: group.skill_key,
    grant_scope: group.grant_scope,
    grant_ids: group.all_grant_ids,
    idempotency_key: normalized.idempotency_key,
    provider_call_allowed: false,
    external_write_allowed: false,
    execution_dispatched: false,
    secrets_included: false,
  });
  const expiresAt = normalized.decision === "defer"
    ? normalized.defer_until
    : new Date(nowValue.getTime() + 7 * 24 * 60 * 60 * 1000);
  await connection.query(
    `INSERT INTO approval_holds (
       hold_id, run_id, tenant_id, workspace_id, user_id, actor_id, actor_type,
       brand_key, request_id, correlation_id, execution_context_json, hold_type,
       requested_by, assigned_to, required_role, status, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'tenant_user', ?, ?, ?, ?, 'supervisor_approval', ?, ?, 'tenant_owner', 'open', ?)`,
    [
      holdId,
      holdId,
      subject.tenant_id,
      normalized.workspace_id,
      subject.user_id,
      subject.user_id,
      group.brand_key,
      primaryRequestId,
      group.approval_key,
      JSON.stringify(context),
      subject.user_id,
      subject.user_id,
      expiresAt,
    ]
  );
  const placeholders = group.request_ids.map(() => "?").join(",");
  await connection.query(
    `UPDATE agent_skill_grant_requests
        SET approval_hold_id = ?
      WHERE request_id IN (${placeholders})
        AND tenant_id = ?`,
    [holdId, ...group.request_ids, subject.tenant_id]
  );
  return {
    hold_id: holdId,
    run_id: holdId,
    tenant_id: subject.tenant_id,
    workspace_id: normalized.workspace_id,
    request_id: primaryRequestId,
    hold_type: "supervisor_approval",
    required_role: "tenant_owner",
    status: "open",
    decision_by: null,
    decision_note: null,
    expires_at: expiresAt,
    decided_at: null,
    created_at: nowValue,
    execution_context_json: JSON.stringify(context),
    context,
  };
}

export async function decideTenantSkillApproval({
  sessionContext = null,
  explicitSubject = {},
  approvalKey,
  input = {},
  pool = null,
  uuid = randomUUID,
  now = () => new Date(),
} = {}) {
  const subject = requireTenantSubject(sessionContext, explicitSubject);
  requireOwnerRole(subject);
  const normalizedApprovalKey = safeString(approvalKey, 128);
  if (!normalizedApprovalKey) {
    throw httpError(400, "TENANT_SKILL_APPROVAL_KEY_REQUIRED", "approvalKey is required.");
  }
  const nowValue = now();
  const normalized = normalizeDecisionInput(input, nowValue);
  const effectivePool = pool || await defaultPool();

  return withConnection(effectivePool, async (connection) => {
    const grantRows = await loadGrantRows(connection, subject.tenant_id);
    const group = matchingGroupOrThrow(grantRows, subject.tenant_id, normalizedApprovalKey, nowValue);
    const holdRows = await loadApprovalHolds(connection, subject.tenant_id, { forUpdate: true });
    const holds = latestHoldsByApprovalKey(holdRows);
    const latestHold = holdForGroup(group, holds);
    const latestStatus = effectiveApprovalStatus(group, latestHold, nowValue);
    const sameDecision = (normalized.decision === "approve" && latestStatus === "approved")
      || (normalized.decision === "reject" && latestStatus === "rejected")
      || (normalized.decision === "defer" && latestStatus === "deferred");
    const currentItem = approvalItem(group, latestHold, nowValue);
    const expectedIdempotentReadback = normalized.decision === "defer" ? "blocked" : "passed";

    if (sameDecision && currentItem.readback.status === expectedIdempotentReadback) {
      return {
        ok: true,
        activation_layer: "tenant_skill_approval_center",
        changed: false,
        approval: currentItem,
        idempotency: { existing_decision_returned: true },
        policy: {
          owner_only: true,
          provider_call_allowed: false,
          external_write_allowed: false,
          execution_dispatched: false,
          secrets_included: false,
        },
        secrets_included: false,
      };
    }
    if (["approved", "rejected", "expired"].includes(latestStatus)) {
      throw httpError(409, "TENANT_SKILL_APPROVAL_ALREADY_DECIDED", "The grant request already has a terminal decision.", {
        approval_key: normalizedApprovalKey,
        request_status: latestStatus,
      });
    }
    if (!group.request_ids?.length) {
      throw httpError(409, "TENANT_SKILL_GRANT_REQUEST_REQUIRED", "The approval item is not linked to a canonical grant request.", {
        approval_key: normalizedApprovalKey,
      });
    }

    let hold = latestHold;
    if (!hold) {
      hold = await createApprovalHold(connection, { subject, group, normalized, uuid, nowValue });
    }
    const grantMutation = await applyTenantAgentSkillGrantRequestDecision({
      connection,
      requestIds: group.request_ids,
      subject,
      decision: normalized.decision,
      decisionNote: normalized.decision_note,
      grantTtlHours: normalized.grant_ttl_hours,
      deferUntil: normalized.defer_until,
    });

    const refreshedGrantRows = await loadGrantRows(connection, subject.tenant_id);
    const refreshedGroup = matchingGroupOrThrow(
      refreshedGrantRows,
      subject.tenant_id,
      normalizedApprovalKey,
      nowValue
    );
    const refreshedHoldRows = await loadApprovalHolds(connection, subject.tenant_id);
    const refreshedHold = holdForGroup(refreshedGroup, latestHoldsByApprovalKey(refreshedHoldRows));
    const item = approvalItem(refreshedGroup, refreshedHold || hold, nowValue);
    const expectedReadback = normalized.decision === "defer" ? "blocked" : "passed";
    if (item.readback.status !== expectedReadback) {
      throw httpError(409, "TENANT_SKILL_APPROVAL_READBACK_FAILED", "Skill approval decision could not be verified against the grant registry.", {
        approval_key: normalizedApprovalKey,
        decision: normalized.decision,
        readback: item.readback,
      });
    }

    return {
      ok: true,
      activation_layer: "tenant_skill_approval_center",
      changed: true,
      decision: normalized.decision,
      grant_mutation: grantMutation,
      approval: item,
      policy: {
        owner_only: true,
        internal_registry_write_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        execution_dispatched: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  }, { transaction: true });
}

export const _testingTenantSkillApprovalCenterService = {
  OWNER_ROLES,
  DECISIONS,
  STATUS_FILTERS,
  approvalKeyFor,
  effectiveGrantStatus,
  effectiveHoldStatus,
  groupGrantRows,
  latestHoldsByApprovalKey,
  readbackFor,
  approvalItem,
  normalizeDecisionInput,
  sanitizeValue,
};
