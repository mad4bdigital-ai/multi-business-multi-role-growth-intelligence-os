import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const DECISIONS = new Set(["approve", "reject", "defer"]);

function httpError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function safeText(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeScopeValue(value, max) {
  return safeText(value, max) || null;
}

function actorId(actor = {}) {
  return safeText(actor.user_id || actor.actor_id || actor.requested_by || "platform_admin", 128);
}

export function platformSkillGrantDecisionConfirm(requestId, decision) {
  const request = safeText(requestId, 36).replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
  const normalizedDecision = safeText(decision, 16).replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
  return `DECIDE_AGENT_SKILL_GRANT_REQUEST_${request}_${normalizedDecision}`;
}

export function normalizeSkillGrantDecision(input = {}, now = new Date()) {
  const decision = safeText(input.decision, 16).toLowerCase();
  if (!DECISIONS.has(decision)) {
    throw httpError(400, "AGENT_SKILL_GRANT_DECISION_INVALID", "Unsupported agent skill grant decision.", {
      allowed_decisions: [...DECISIONS],
    });
  }
  const ttlHours = input.grant_ttl_hours === null || input.grant_ttl_hours === undefined
    ? null
    : boundedInt(input.grant_ttl_hours, 720, 1, 24 * 365);
  let deferUntil = null;
  if (decision === "defer") {
    deferUntil = input.defer_until
      ? new Date(input.defer_until)
      : new Date(now.getTime() + boundedInt(input.defer_hours, 168, 1, 24 * 90) * 60 * 60 * 1000);
    if (Number.isNaN(deferUntil.getTime()) || deferUntil <= now) {
      throw httpError(400, "AGENT_SKILL_GRANT_DEFER_UNTIL_INVALID", "defer_until must be a future timestamp.");
    }
  }
  return {
    decision,
    decision_note: safeText(input.decision_note, 512) || null,
    grant_ttl_hours: ttlHours,
    defer_until: deferUntil,
  };
}

async function withTransaction(pool, callback) {
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const release = connection !== pool && typeof connection.release === "function";
  try {
    if (typeof connection.beginTransaction === "function") await connection.beginTransaction();
    const result = await callback(connection);
    if (typeof connection.commit === "function") await connection.commit();
    return result;
  } catch (error) {
    if (typeof connection.rollback === "function") await connection.rollback();
    throw error;
  } finally {
    if (release) connection.release();
  }
}

async function resolveSkill(connection, { skillId, skillKey }) {
  const [rows] = await connection.query(
    `SELECT skill_id, skill_key, display_name, scope, requires_approval, status
       FROM agent_skills
      WHERE (skill_id = ? OR skill_key = ?)
        AND status = 'active'
      LIMIT 1
      FOR UPDATE`,
    [skillId || "__missing__", skillKey || "__missing__"]
  );
  if (!rows[0]) throw httpError(404, "AGENT_SKILL_NOT_FOUND", "Agent skill was not found or is inactive.");
  return rows[0];
}

async function resolveAgent(connection, agentId) {
  const [rows] = await connection.query(
    "SELECT agent_id, name, is_system, status FROM agents WHERE agent_id = ? LIMIT 1 FOR UPDATE",
    [agentId]
  );
  if (!rows[0]) throw httpError(404, "AGENT_NOT_FOUND", "Agent was not found.");
  if (rows[0].status !== "active") throw httpError(409, "AGENT_NOT_ACTIVE", "Agent must be active before a skill can be granted.");
  return rows[0];
}

async function findScopeGrant(connection, { agentId, skillId, tenantId, brandKey }) {
  const [rows] = await connection.query(
    `SELECT grant_id, status, grant_request_id
       FROM agent_skill_grants
      WHERE agent_id = ?
        AND skill_id = ?
        AND COALESCE(tenant_id, '') = COALESCE(?, '')
        AND COALESCE(brand_key, '') = COALESCE(?, '')
      ORDER BY granted_at DESC, id DESC
      LIMIT 1
      FOR UPDATE`,
    [agentId, skillId, tenantId, brandKey]
  );
  return rows[0] || null;
}

async function findOpenRequest(connection, { agentId, skillId, tenantId, brandKey }) {
  const [rows] = await connection.query(
    `SELECT *
       FROM agent_skill_grant_requests
      WHERE agent_id = ?
        AND skill_id = ?
        AND COALESCE(tenant_id, '') = COALESCE(?, '')
        AND COALESCE(brand_key, '') = COALESCE(?, '')
        AND request_status IN ('pending','deferred')
      ORDER BY requested_at DESC
      LIMIT 1
      FOR UPDATE`,
    [agentId, skillId, tenantId, brandKey]
  );
  return rows[0] || null;
}

async function createApprovalHold(connection, {
  holdId,
  requestId,
  tenantId,
  brandKey,
  agentId,
  skill,
  requestedBy,
  policyKey,
  now,
}) {
  const holdTenantId = tenantId || PLATFORM_TENANT_ID;
  const requiredRole = tenantId ? "tenant_owner" : "platform_admin";
  const context = {
    approval_type: "agent_skill_grant_request",
    request_id: requestId,
    tenant_id: tenantId,
    brand_key: brandKey,
    agent_id: agentId,
    skill_id: skill.skill_id,
    skill_key: skill.skill_key,
    approval_policy_key: policyKey,
    provider_call_allowed: false,
    external_write_allowed: false,
    execution_dispatched: false,
    secrets_included: false,
  };
  await connection.query(
    `INSERT INTO approval_holds (
       hold_id, run_id, tenant_id, actor_id, actor_type, brand_key,
       request_id, correlation_id, execution_context_json, hold_type,
       requested_by, required_role, status, expires_at
     ) VALUES (?, ?, ?, ?, 'platform_service', ?, ?, ?, ?, 'supervisor_approval', ?, ?, 'open', DATE_ADD(?, INTERVAL 7 DAY))`,
    [
      holdId,
      holdId,
      holdTenantId,
      requestedBy,
      brandKey,
      requestId,
      requestId,
      JSON.stringify(context),
      requestedBy,
      requiredRole,
      now,
    ]
  );
}

async function upsertGrant(connection, {
  grantId,
  requestId,
  agentId,
  skillId,
  tenantId,
  brandKey,
  requestedBy,
  expiresAt,
  active,
}) {
  const existing = await findScopeGrant(connection, { agentId, skillId, tenantId, brandKey });
  if (existing) {
    await connection.query(
      `UPDATE agent_skill_grants
          SET status = ?,
              grant_request_id = ?,
              granted_by = ?,
              granted_at = NOW(),
              expires_at = ?
        WHERE grant_id = ?`,
      [active ? "active" : "revoked", requestId, requestedBy, active ? expiresAt : null, existing.grant_id]
    );
    return existing.grant_id;
  }
  await connection.query(
    `INSERT INTO agent_skill_grants (
       grant_id, agent_id, skill_id, tenant_id, brand_key,
       granted_by, expires_at, status, grant_request_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      grantId,
      agentId,
      skillId,
      tenantId,
      brandKey,
      requestedBy,
      active ? expiresAt : null,
      active ? "active" : "revoked",
      requestId,
    ]
  );
  return grantId;
}

async function loadRequestReadback(connection, requestId) {
  const [rows] = await connection.query(
    `SELECT r.request_id, r.agent_id, r.skill_id, r.tenant_id, r.brand_key,
            r.request_status, r.approval_policy_key, r.approval_hold_id,
            r.requested_by, r.requested_at, r.decision_by, r.decision_note,
            r.decided_at, r.provenance_type, r.provenance_ref, r.expires_at,
            g.grant_id, g.status AS grant_status,
            CASE WHEN e.grant_id IS NULL THEN 0 ELSE 1 END AS runtime_effective
       FROM agent_skill_grant_requests r
       LEFT JOIN agent_skill_grants g ON g.grant_request_id = r.request_id
       LEFT JOIN v_effective_agent_skill_grants e ON e.grant_id = g.grant_id
      WHERE r.request_id = ?
      LIMIT 1`,
    [requestId]
  );
  return rows[0] || null;
}

export async function requestAgentSkillGrant({
  agentId,
  input = {},
  actor = {},
  pool = getPool(),
  uuid = randomUUID,
  now = () => new Date(),
} = {}) {
  const normalizedAgentId = safeText(agentId, 36);
  if (!normalizedAgentId) throw httpError(400, "AGENT_ID_REQUIRED", "agentId is required.");
  const skillId = normalizeScopeValue(input.skill_id, 36);
  const skillKey = normalizeScopeValue(input.skill_key, 128);
  if (!skillId && !skillKey) throw httpError(400, "AGENT_SKILL_IDENTITY_REQUIRED", "skill_id or skill_key is required.");
  const tenantId = normalizeScopeValue(input.tenant_id, 36);
  const brandKey = normalizeScopeValue(input.brand_key, 128);
  const requestedBy = actorId({ ...actor, requested_by: input.requested_by || input.granted_by });
  const idempotencyKey = normalizeScopeValue(input.idempotency_key, 191);
  const expiresAt = input.expires_at || null;
  const nowValue = now();

  return withTransaction(pool, async (connection) => {
    await resolveAgent(connection, normalizedAgentId);
    const skill = await resolveSkill(connection, { skillId, skillKey });
    if (skill.scope === "brand" && !brandKey) {
      throw httpError(400, "AGENT_SKILL_BRAND_SCOPE_REQUIRED", "brand_key is required for brand-scoped skills.", {
        skill_key: skill.skill_key,
      });
    }
    const existingRequest = await findOpenRequest(connection, {
      agentId: normalizedAgentId,
      skillId: skill.skill_id,
      tenantId,
      brandKey,
    });
    if (existingRequest) {
      return {
        ok: true,
        changed: false,
        approval_required: true,
        request: await loadRequestReadback(connection, existingRequest.request_id),
        http_status: 202,
        secrets_included: false,
      };
    }

    const requiresApproval = Number(skill.requires_approval || 0) === 1;
    const requestId = uuid();
    const grantId = uuid();
    const holdId = requiresApproval ? uuid() : null;
    const policyKey = requiresApproval
      ? tenantId ? "tenant_owner_skill_grant_v1" : "platform_admin_skill_grant_v1"
      : "skill_grant_not_required_v1";
    const requestStatus = requiresApproval ? "pending" : "not_required";
    const provenanceType = requiresApproval ? "runtime_request" : "not_required";

    await connection.query(
      `INSERT INTO agent_skill_grant_requests (
         request_id, agent_id, skill_id, tenant_id, brand_key, request_status,
         approval_policy_key, approval_hold_id, requested_by, requested_at,
         decision_by, decision_note, decided_at, provenance_type, provenance_ref,
         idempotency_key, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestId,
        normalizedAgentId,
        skill.skill_id,
        tenantId,
        brandKey,
        requestStatus,
        policyKey,
        holdId,
        requestedBy,
        nowValue,
        requiresApproval ? null : requestedBy,
        requiresApproval ? null : "Approval not required by the active skill policy.",
        requiresApproval ? null : nowValue,
        provenanceType,
        requiresApproval ? "runtime://agent-skill-grant-request" : "policy://skill-grant-not-required-v1",
        idempotencyKey,
        expiresAt,
      ]
    );

    if (requiresApproval) {
      await createApprovalHold(connection, {
        holdId,
        requestId,
        tenantId,
        brandKey,
        agentId: normalizedAgentId,
        skill,
        requestedBy,
        policyKey,
        now: nowValue,
      });
    }

    await upsertGrant(connection, {
      grantId,
      requestId,
      agentId: normalizedAgentId,
      skillId: skill.skill_id,
      tenantId,
      brandKey,
      requestedBy,
      expiresAt,
      active: !requiresApproval,
    });

    const readback = await loadRequestReadback(connection, requestId);
    if (!readback || (requiresApproval && Number(readback.runtime_effective) !== 0)
      || (!requiresApproval && Number(readback.runtime_effective) !== 1)) {
      throw httpError(409, "AGENT_SKILL_GRANT_REQUEST_READBACK_FAILED", "Agent skill grant request could not be verified.", {
        request_id: requestId,
        approval_required: requiresApproval,
      });
    }

    return {
      ok: true,
      changed: true,
      approval_required: requiresApproval,
      request: readback,
      http_status: requiresApproval ? 202 : 201,
      policy: {
        internal_registry_write_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        runtime_effective_before_approval: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

async function updateHoldDecision(connection, {
  holdId,
  decision,
  decisionBy,
  decisionNote,
  deferUntil,
}) {
  if (!holdId) return;
  const holdStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "open";
  await connection.query(
    `UPDATE approval_holds
        SET status = ?,
            decision_by = ?,
            decision_note = ?,
            decided_at = NOW(),
            expires_at = CASE WHEN ? = 'defer' THEN ? ELSE expires_at END,
            execution_context_json = JSON_SET(
              COALESCE(execution_context_json, JSON_OBJECT()),
              '$.decision_state', ?,
              '$.decision_by', ?,
              '$.decision_note', ?,
              '$.deferred_until', ?,
              '$.secrets_included', FALSE
            )
      WHERE hold_id = ?`,
    [
      holdStatus,
      decisionBy,
      decisionNote,
      decision,
      deferUntil,
      decision === "defer" ? "deferred" : decision === "approve" ? "approved" : "rejected",
      decisionBy,
      decisionNote,
      deferUntil ? deferUntil.toISOString() : null,
      holdId,
    ]
  );
}

async function applyRequestDecision(connection, {
  request,
  decision,
  decisionBy,
  decisionNote,
  grantTtlHours,
  deferUntil,
  provenanceType,
}) {
  const requestStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "deferred";
  const requestExpiresAt = decision === "defer" ? deferUntil : request.expires_at;
  await connection.query(
    `UPDATE agent_skill_grant_requests
        SET request_status = ?,
            decision_by = ?,
            decision_note = ?,
            decided_at = NOW(),
            provenance_type = ?,
            provenance_ref = ?,
            expires_at = ?
      WHERE request_id = ?`,
    [
      requestStatus,
      decisionBy,
      decisionNote,
      provenanceType,
      `decision://${provenanceType}/${request.request_id}`,
      requestExpiresAt,
      request.request_id,
    ]
  );

  if (decision === "approve") {
    const expiresSql = grantTtlHours ? "DATE_ADD(NOW(), INTERVAL ? HOUR)" : "NULL";
    const params = [decisionBy];
    if (grantTtlHours) params.push(grantTtlHours);
    params.push(request.request_id);
    await connection.query(
      `UPDATE agent_skill_grants
          SET status = 'active',
              granted_by = ?,
              granted_at = NOW(),
              expires_at = ${expiresSql}
        WHERE grant_request_id = ?`,
      params
    );
  } else {
    await connection.query(
      "UPDATE agent_skill_grants SET status = 'revoked', expires_at = NULL WHERE grant_request_id = ?",
      [request.request_id]
    );
  }
  await updateHoldDecision(connection, {
    holdId: request.approval_hold_id,
    decision,
    decisionBy,
    decisionNote,
    deferUntil,
  });
}

export async function decidePlatformAgentSkillGrantRequest({
  requestId,
  input = {},
  actor = {},
  pool = getPool(),
  now = () => new Date(),
} = {}) {
  const normalizedRequestId = safeText(requestId, 36);
  if (!normalizedRequestId) throw httpError(400, "AGENT_SKILL_GRANT_REQUEST_ID_REQUIRED", "requestId is required.");
  const nowValue = now();
  const normalized = normalizeSkillGrantDecision(input, nowValue);
  const expectedConfirm = platformSkillGrantDecisionConfirm(normalizedRequestId, normalized.decision);
  if (safeText(input.confirm, 191) !== expectedConfirm) {
    throw httpError(409, "AGENT_SKILL_GRANT_DECISION_CONFIRMATION_REQUIRED", "Typed confirmation is required.", {
      expected_confirm: expectedConfirm,
    });
  }
  const decisionBy = actorId(actor);

  return withTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      "SELECT * FROM agent_skill_grant_requests WHERE request_id = ? LIMIT 1 FOR UPDATE",
      [normalizedRequestId]
    );
    const request = rows[0];
    if (!request) throw httpError(404, "AGENT_SKILL_GRANT_REQUEST_NOT_FOUND", "Agent skill grant request was not found.");
    if (request.tenant_id) {
      throw httpError(403, "AGENT_SKILL_GRANT_TENANT_DECISION_REQUIRED", "Tenant-scoped requests must be decided by the Tenant Skill Approval Center.");
    }
    const targetStatus = normalized.decision === "approve" ? "approved" : normalized.decision === "reject" ? "rejected" : "deferred";
    if (request.request_status === targetStatus) {
      return {
        ok: true,
        changed: false,
        decision: normalized.decision,
        request: await loadRequestReadback(connection, normalizedRequestId),
        idempotency: { existing_decision_returned: true },
        secrets_included: false,
      };
    }
    if (["approved", "rejected", "expired"].includes(request.request_status)) {
      throw httpError(409, "AGENT_SKILL_GRANT_REQUEST_ALREADY_DECIDED", "The request already has a terminal decision.", {
        request_status: request.request_status,
      });
    }

    await applyRequestDecision(connection, {
      request,
      decision: normalized.decision,
      decisionBy,
      decisionNote: normalized.decision_note,
      grantTtlHours: normalized.grant_ttl_hours,
      deferUntil: normalized.defer_until,
      provenanceType: "platform_admin_decision",
    });

    const readback = await loadRequestReadback(connection, normalizedRequestId);
    const expectedEffective = normalized.decision === "approve" ? 1 : 0;
    if (!readback || Number(readback.runtime_effective) !== expectedEffective || readback.request_status !== targetStatus) {
      throw httpError(409, "AGENT_SKILL_GRANT_DECISION_READBACK_FAILED", "Platform skill grant decision could not be verified.", {
        request_id: normalizedRequestId,
        decision: normalized.decision,
      });
    }
    return {
      ok: true,
      changed: true,
      decision: normalized.decision,
      request: readback,
      policy: {
        platform_admin_only: true,
        typed_confirmation: true,
        internal_registry_write_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

export async function applyTenantAgentSkillGrantRequestDecision({
  connection,
  requestIds = [],
  subject,
  decision,
  decisionNote = null,
  grantTtlHours = null,
  deferUntil = null,
} = {}) {
  const uniqueIds = [...new Set(requestIds.filter(Boolean))];
  if (!uniqueIds.length) return { affected_requests: 0 };
  const placeholders = uniqueIds.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT * FROM agent_skill_grant_requests
      WHERE request_id IN (${placeholders})
        AND tenant_id = ?
      FOR UPDATE`,
    [...uniqueIds, subject.tenant_id]
  );
  if (rows.length !== uniqueIds.length) {
    throw httpError(409, "TENANT_SKILL_GRANT_REQUEST_SCOPE_MISMATCH", "One or more grant requests are missing or outside the caller tenant.");
  }
  for (const request of rows) {
    await applyRequestDecision(connection, {
      request,
      decision,
      decisionBy: actorId(subject),
      decisionNote,
      grantTtlHours,
      deferUntil,
      provenanceType: "tenant_owner_decision",
    });
  }
  return { affected_requests: rows.length };
}

export const _testingAgentSkillGrantRequestService = {
  DECISIONS,
  safeText,
  boundedInt,
  normalizeSkillGrantDecision,
  platformSkillGrantDecisionConfirm,
};
