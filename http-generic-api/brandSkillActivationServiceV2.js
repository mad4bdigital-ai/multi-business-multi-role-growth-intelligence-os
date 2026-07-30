import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { platformResourceContextResolve } from "./platformResourceContextResolver.js";

const OWNER_ROLES = new Set(["owner", "admin", "tenant_owner", "tenant_admin"]);
const ACTIVE_MODES = new Set(["self_service", "temporary_only"]);
const OPERATION_PATTERN = /^[a-z][a-z0-9_.:-]{0,63}$/;
const BRAND_RESOLVABLE_RESOURCE_TYPES = new Set(["brand", "workspace", "asset", "site"]);
const DEFAULT_MAX_TTL_HOURS = 24 * 365;

function httpError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function safeText(value, max = 255) {
  return String(value ?? "").trim().slice(0, max);
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedOperationList(value) {
  return [...new Set(parseArray(value).map((item) => safeText(item, 64).toLowerCase()).filter(Boolean))];
}

export function normalizeRequestedOperations(value) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  const normalized = [...new Set(source.map((item) => safeText(item, 64).toLowerCase()).filter(Boolean))];
  if (!normalized.length) {
    throw httpError(400, "BRAND_SKILL_OPERATIONS_REQUIRED", "At least one requested operation is required.");
  }
  if (normalized.length > 32 || normalized.some((item) => !OPERATION_PATTERN.test(item))) {
    throw httpError(400, "BRAND_SKILL_OPERATIONS_INVALID", "One or more requested operations are invalid.");
  }
  return normalized;
}

export function operationsAllowed(requested = [], allowed = []) {
  const allowedSet = new Set(normalizedOperationList(allowed));
  return allowedSet.has("*") || requested.every((item) => allowedSet.has(item));
}

export function normalizeTtlHours(value, mode, maxTtlHours) {
  const configuredMaximum = Number(maxTtlHours);
  const hasConfiguredMaximum = maxTtlHours !== null
    && maxTtlHours !== undefined
    && maxTtlHours !== ""
    && Number.isFinite(configuredMaximum)
    && configuredMaximum > 0;
  const maximum = Math.max(
    1,
    Math.min(hasConfiguredMaximum ? configuredMaximum : DEFAULT_MAX_TTL_HOURS, DEFAULT_MAX_TTL_HOURS),
  );

  if (value === null || value === undefined || value === "") {
    if (mode === "temporary_only") return Math.floor(Math.min(maximum, 24));
    if (hasConfiguredMaximum) return Math.floor(maximum);
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > maximum) {
    throw httpError(400, "BRAND_SKILL_TTL_INVALID", `ttl_hours must be between 1 and ${maximum}.`);
  }
  return Math.floor(parsed);
}

function actorUserId(actor = {}) {
  return safeText(actor.user_id || actor.subject_id, 36);
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

async function resolveMembership(connection, tenantId, userId) {
  const [rows] = await connection.query(
    `SELECT m.user_id, m.tenant_id, m.role AS role, m.status, t.status AS tenant_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.tenant_id = ?
      LIMIT 1
      FOR UPDATE`,
    [userId, tenantId],
  );
  const row = rows[0] || null;
  if (!row || row.status !== "active" || row.tenant_status !== "active") {
    throw httpError(403, "BRAND_SKILL_ACTIVE_MEMBERSHIP_REQUIRED", "Active tenant membership is required.");
  }
  return row;
}

async function resolveWorkspace(connection, tenantId, brandKey) {
  const [rows] = await connection.query(
    `SELECT workspace_id, workspace_key, linked_brand_key, bootstrap_status
       FROM workspace_registry
      WHERE tenant_id = ?
        AND workspace_type = 'brand'
        AND linked_brand_key = ?
      ORDER BY bootstrap_status = 'ready' DESC, updated_at DESC
      LIMIT 1`,
    [tenantId, brandKey],
  );
  return rows[0] || null;
}

export function resourceContextIncludesBrand(result, requestedResourceType, requestedResourceRef, brandKey) {
  if (!result?.ok || result.status !== "resolved") return false;
  if (safeText(result.match?.resource_type, 64).toLowerCase() !== safeText(requestedResourceType, 64).toLowerCase()) {
    return false;
  }
  return Array.isArray(result.context?.brands)
    && result.context.brands.some((brand) => safeText(brand?.target_key, 128) === safeText(brandKey, 128));
}

async function verifyExplicitResourceBrandBinding({
  pool,
  tenantId,
  userId,
  brandKey,
  requestedResourceType,
  requestedResourceRef,
  resourceContextResolver,
}) {
  if (!requestedResourceType && !requestedResourceRef) return null;
  if (!requestedResourceType || !requestedResourceRef) {
    throw httpError(
      400,
      "BRAND_SKILL_RESOURCE_BINDING_INCOMPLETE",
      "resource_type and resource_ref must be provided together.",
    );
  }

  if (requestedResourceType === "brand") {
    if (requestedResourceRef !== brandKey) {
      throw httpError(
        403,
        "BRAND_SKILL_RESOURCE_BRAND_MISMATCH",
        "The requested brand resource does not match the selected brand.",
        { brand_key: brandKey, resource_type: requestedResourceType, resource_ref: requestedResourceRef },
      );
    }
    return { resource_type: requestedResourceType, resource_ref: requestedResourceRef, brand_key: brandKey };
  }

  if (!BRAND_RESOLVABLE_RESOURCE_TYPES.has(requestedResourceType)) {
    throw httpError(
      403,
      "BRAND_SKILL_RESOURCE_BRAND_BINDING_UNSUPPORTED",
      "The requested resource type cannot be bound safely to a brand through the canonical resource graph.",
      { brand_key: brandKey, resource_type: requestedResourceType, resource_ref: requestedResourceRef },
    );
  }

  let resolved;
  try {
    resolved = await resourceContextResolver(
      {
        resource_type: requestedResourceType,
        resource_ref: requestedResourceRef,
        candidate_refs: [requestedResourceRef],
        include_brand_context: false,
      },
      {
        auth: { tenant_id: tenantId, user_id: userId, is_admin: false },
        pool,
      },
    );
  } catch (error) {
    throw httpError(
      503,
      "BRAND_SKILL_RESOURCE_BRAND_RESOLUTION_FAILED",
      "The requested resource could not be verified against the selected brand.",
      {
        brand_key: brandKey,
        resource_type: requestedResourceType,
        resource_ref: requestedResourceRef,
        resolver_code: safeText(error?.code, 128) || null,
      },
    );
  }

  if (!resourceContextIncludesBrand(resolved, requestedResourceType, requestedResourceRef, brandKey)) {
    throw httpError(
      403,
      "BRAND_SKILL_RESOURCE_BRAND_MISMATCH",
      "The requested resource is not authorized as part of the selected brand.",
      { brand_key: brandKey, resource_type: requestedResourceType, resource_ref: requestedResourceRef },
    );
  }

  return {
    resource_type: requestedResourceType,
    resource_ref: requestedResourceRef,
    brand_key: brandKey,
  };
}

async function resolveResourceAuthority(connection, {
  tenantId,
  userId,
  brandKey,
  membershipRole,
  workspace,
  requestedResourceType,
  requestedResourceRef,
}) {
  const ownerScoped = OWNER_ROLES.has(safeText(membershipRole, 64).toLowerCase());
  const params = [tenantId, userId];
  let scopeClause;

  if (requestedResourceType && requestedResourceRef) {
    scopeClause = "resource_type = ? AND resource_ref = ?";
    params.push(requestedResourceType, requestedResourceRef);
  } else if (ownerScoped) {
    const workspaceRefs = [workspace?.workspace_id, workspace?.workspace_key, tenantId].filter(Boolean);
    scopeClause = `((resource_type = 'brand' AND resource_ref = ?) OR (resource_type = 'workspace' AND resource_ref IN (${workspaceRefs.map(() => "?").join(",")})))`;
    params.push(brandKey, ...workspaceRefs);
  } else {
    scopeClause = "resource_type = 'brand' AND resource_ref = ?";
    params.push(brandKey);
  }

  const [rows] = await connection.query(
    `SELECT grant_id, resource_type, resource_ref, permission, expires_at
       FROM workspace_resource_grants
      WHERE tenant_id = ?
        AND grantee_user_id = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND ${scopeClause}
      ORDER BY FIELD(permission, 'owner','admin','manage','operate','edit','comment','view')
      LIMIT 1
      FOR UPDATE`,
    params,
  );

  if (!rows[0]) {
    throw httpError(
      403,
      "BRAND_SKILL_RESOURCE_GRANT_REQUIRED",
      "An active resource grant for the selected brand or resource is required.",
      {
        brand_key: brandKey,
        resource_type: requestedResourceType || null,
        resource_ref: requestedResourceRef || null,
      },
    );
  }
  return rows[0];
}

async function resolveSkillAndAgent(connection, { tenantId, brandKey, skillKey, agentId }) {
  const [rows] = await connection.query(
    `SELECT s.skill_id, s.skill_key, s.display_name, s.scope, s.status AS skill_status,
            a.agent_id, a.status AS agent_status, g.grant_id AS agent_skill_grant_id
       FROM agent_skills s
       JOIN agents a ON a.agent_id = ? AND a.status = 'active'
       JOIN v_effective_agent_skill_grants g
         ON g.agent_id = a.agent_id
        AND g.skill_id = s.skill_id
        AND (g.tenant_id IS NULL OR g.tenant_id = ?)
        AND (g.brand_key IS NULL OR g.brand_key = ?)
      WHERE s.skill_key = ?
        AND s.status = 'active'
      LIMIT 1
      FOR UPDATE`,
    [agentId, tenantId, brandKey, skillKey],
  );
  if (!rows[0]) {
    throw httpError(
      403,
      "BRAND_SKILL_AGENT_GRANT_REQUIRED",
      "The selected agent does not have an effective grant for this skill and brand.",
    );
  }
  return rows[0];
}

async function resolvePolicy(connection, { tenantId, brandKey, skillId }) {
  const [rows] = await connection.query(
    `SELECT policy_id, activation_mode, allowed_roles_json, allowed_agent_ids_json,
            allowed_operations_json, max_ttl_hours, requires_resource_binding,
            constraints_json, status
       FROM brand_skill_policies
      WHERE tenant_id = ? AND brand_key = ? AND skill_id = ? AND status = 'active'
      LIMIT 1
      FOR UPDATE`,
    [tenantId, brandKey, skillId],
  );
  if (!rows[0]) {
    throw httpError(
      403,
      "BRAND_SKILL_POLICY_REQUIRED",
      "This skill is not enabled for self-service activation on the selected brand.",
    );
  }
  return rows[0];
}

function validatePolicy(policy, { membershipRole, agentId, operations }) {
  const mode = safeText(policy.activation_mode, 32).toLowerCase();
  if (!ACTIVE_MODES.has(mode)) {
    const code = mode === "disabled" ? "BRAND_SKILL_DISABLED" : "BRAND_SKILL_APPROVAL_REQUIRED";
    throw httpError(
      mode === "disabled" ? 403 : 409,
      code,
      "This skill cannot be activated through self-service for the selected brand.",
      { activation_mode: mode },
    );
  }

  const allowedRoles = normalizedOperationList(policy.allowed_roles_json);
  if (allowedRoles.length && !allowedRoles.includes(safeText(membershipRole, 64).toLowerCase())) {
    throw httpError(403, "BRAND_SKILL_ROLE_DENIED", "The caller role is not allowed to activate this skill.");
  }

  const allowedAgents = parseArray(policy.allowed_agent_ids_json).map((item) => safeText(item, 36));
  if (allowedAgents.length && !allowedAgents.includes(agentId)) {
    throw httpError(403, "BRAND_SKILL_AGENT_DENIED", "The selected agent is not allowed by the brand skill policy.");
  }

  const policyOperations = parseArray(policy.allowed_operations_json);
  if (!policyOperations.length || !operationsAllowed(operations, policyOperations)) {
    throw httpError(
      403,
      "BRAND_SKILL_OPERATION_DENIED",
      "One or more requested operations are not allowed by the brand skill policy.",
      { requested_operations: operations },
    );
  }
  return mode;
}

async function expireStaleUserBrandSkillGrants(connection, {
  tenantId,
  userId,
  brandKey,
  agentId,
  skillId,
  resourceType,
  resourceRef,
}) {
  const [result] = await connection.query(
    `UPDATE user_brand_skill_grants
        SET status = 'expired', updated_at = NOW()
      WHERE tenant_id = ? AND user_id = ? AND brand_key = ? AND agent_id = ? AND skill_id = ?
        AND COALESCE(resource_type, '') = COALESCE(?, '')
        AND COALESCE(resource_ref, '') = COALESCE(?, '')
        AND status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at <= CURRENT_TIMESTAMP`,
    [tenantId, userId, brandKey, agentId, skillId, resourceType, resourceRef],
  );
  return Number(result.affectedRows || 0);
}

async function loadGrantReadback(connection, grantId) {
  const [rows] = await connection.query(
    `SELECT grant_id, tenant_id, user_id, brand_key, agent_id, skill_id, skill_key,
            policy_id, workspace_id, resource_grant_id, resource_type, resource_ref,
            allowed_operations_json, constraints_json, granted_by, granted_at,
            expires_at, provenance_type, provenance_ref, status
       FROM v_effective_user_brand_skill_grants
      WHERE grant_id = ?
      LIMIT 1`,
    [grantId],
  );
  return rows[0] || null;
}

function expiryCompliesWithTtl(expiresAt, ttlHours, now = Date.now()) {
  if (ttlHours === null) return true;
  const expiry = new Date(expiresAt || "").getTime();
  if (!Number.isFinite(expiry) || expiry <= now) return false;
  const maximumExpiry = now + (ttlHours * 60 * 60 * 1000) + 60_000;
  return expiry <= maximumExpiry;
}

export async function activateBrandSkillForUser({
  tenantId,
  brandKey,
  skillKey,
  agentId,
  input = {},
  actor = {},
  pool = getPool(),
  uuid = randomUUID,
  resourceContextResolver = platformResourceContextResolve,
} = {}) {
  const userId = actorUserId(actor);
  const normalizedTenantId = safeText(tenantId, 36);
  const normalizedBrandKey = safeText(brandKey, 128);
  const normalizedSkillKey = safeText(skillKey, 128);
  const normalizedAgentId = safeText(agentId || input.agent_id, 36);

  if (!userId) throw httpError(401, "BRAND_SKILL_USER_JWT_REQUIRED", "Signed-in user identity is required.");
  if (!normalizedTenantId || !normalizedBrandKey || !normalizedSkillKey || !normalizedAgentId) {
    throw httpError(400, "BRAND_SKILL_SCOPE_REQUIRED", "tenant, brand, skill, and agent scope are required.");
  }

  const operations = normalizeRequestedOperations(input.requested_operations || input.allowed_operations);
  const requestedResourceType = safeText(input.resource_type, 64).toLowerCase() || null;
  const requestedResourceRef = safeText(input.resource_ref, 255) || null;

  await verifyExplicitResourceBrandBinding({
    pool,
    tenantId: normalizedTenantId,
    userId,
    brandKey: normalizedBrandKey,
    requestedResourceType,
    requestedResourceRef,
    resourceContextResolver,
  });

  return withTransaction(pool, async (connection) => {
    const membership = await resolveMembership(connection, normalizedTenantId, userId);
    const workspace = await resolveWorkspace(connection, normalizedTenantId, normalizedBrandKey);
    const skill = await resolveSkillAndAgent(connection, {
      tenantId: normalizedTenantId,
      brandKey: normalizedBrandKey,
      skillKey: normalizedSkillKey,
      agentId: normalizedAgentId,
    });
    const policy = await resolvePolicy(connection, {
      tenantId: normalizedTenantId,
      brandKey: normalizedBrandKey,
      skillId: skill.skill_id,
    });
    const mode = validatePolicy(policy, {
      membershipRole: membership.role,
      agentId: normalizedAgentId,
      operations,
    });
    const authority = await resolveResourceAuthority(connection, {
      tenantId: normalizedTenantId,
      userId,
      brandKey: normalizedBrandKey,
      membershipRole: membership.role,
      workspace,
      requestedResourceType,
      requestedResourceRef,
    });

    if (Number(policy.requires_resource_binding || 0) === 1 && !authority?.grant_id) {
      throw httpError(403, "BRAND_SKILL_RESOURCE_BINDING_REQUIRED", "The policy requires a verified resource binding.");
    }

    const ttlHours = normalizeTtlHours(input.ttl_hours, mode, policy.max_ttl_hours);
    await expireStaleUserBrandSkillGrants(connection, {
      tenantId: normalizedTenantId,
      userId,
      brandKey: normalizedBrandKey,
      agentId: normalizedAgentId,
      skillId: skill.skill_id,
      resourceType: authority.resource_type,
      resourceRef: authority.resource_ref,
    });

    const [existingRows] = await connection.query(
      `SELECT grant_id, policy_id, allowed_operations_json, expires_at
         FROM user_brand_skill_grants
        WHERE tenant_id = ? AND user_id = ? AND brand_key = ? AND agent_id = ? AND skill_id = ?
          AND COALESCE(resource_type, '') = COALESCE(?, '')
          AND COALESCE(resource_ref, '') = COALESCE(?, '')
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        LIMIT 1
        FOR UPDATE`,
      [
        normalizedTenantId,
        userId,
        normalizedBrandKey,
        normalizedAgentId,
        skill.skill_id,
        authority.resource_type,
        authority.resource_ref,
      ],
    );

    const existing = existingRows[0] || null;
    if (existing) {
      const existingOperations = normalizedOperationList(existing.allowed_operations_json);
      const operationsCovered = operationsAllowed(operations, existingOperations);
      const ttlCompliant = expiryCompliesWithTtl(existing.expires_at, ttlHours);
      const policyCurrent = existing.policy_id === policy.policy_id;

      if (operationsCovered && ttlCompliant && policyCurrent) {
        const readback = await loadGrantReadback(connection, existing.grant_id);
        return {
          ok: true,
          changed: false,
          grant: readback,
          activation_mode: mode,
          secrets_included: false,
        };
      }

      const mergedOperations = normalizeRequestedOperations([...existingOperations, ...operations]);
      await connection.query(
        `UPDATE user_brand_skill_grants
            SET policy_id = ?,
                workspace_id = ?,
                resource_grant_id = ?,
                allowed_operations_json = ?,
                constraints_json = ?,
                expires_at = CASE WHEN ? IS NULL THEN NULL ELSE DATE_ADD(NOW(), INTERVAL ? HOUR) END,
                updated_at = NOW()
          WHERE grant_id = ? AND status = 'active'`,
        [
          policy.policy_id,
          workspace?.workspace_id || null,
          authority.grant_id,
          JSON.stringify(mergedOperations),
          policy.constraints_json || null,
          ttlHours,
          ttlHours,
          existing.grant_id,
        ],
      );
      const readback = await loadGrantReadback(connection, existing.grant_id);
      if (!readback) {
        throw httpError(409, "BRAND_SKILL_GRANT_READBACK_FAILED", "The updated user brand skill grant could not be verified.");
      }
      return {
        ok: true,
        changed: true,
        updated_existing: true,
        activation_mode: mode,
        grant: readback,
        secrets_included: false,
      };
    }

    const grantId = uuid();
    await connection.query(
      `INSERT INTO user_brand_skill_grants (
         grant_id, tenant_id, user_id, brand_key, agent_id, skill_id, policy_id,
         workspace_id, resource_grant_id, resource_type, resource_ref,
         allowed_operations_json, constraints_json, granted_by, expires_at,
         provenance_type, provenance_ref, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 CASE WHEN ? IS NULL THEN NULL ELSE DATE_ADD(NOW(), INTERVAL ? HOUR) END,
                 'brand_self_service', ?, 'active')`,
      [
        grantId,
        normalizedTenantId,
        userId,
        normalizedBrandKey,
        normalizedAgentId,
        skill.skill_id,
        policy.policy_id,
        workspace?.workspace_id || null,
        authority.grant_id,
        authority.resource_type,
        authority.resource_ref,
        JSON.stringify(operations),
        policy.constraints_json || null,
        userId,
        ttlHours,
        ttlHours,
        `brand-skill://${normalizedTenantId}/${normalizedBrandKey}/${normalizedSkillKey}`,
      ],
    );

    const readback = await loadGrantReadback(connection, grantId);
    if (!readback) {
      throw httpError(409, "BRAND_SKILL_GRANT_READBACK_FAILED", "The user brand skill grant could not be verified.");
    }

    return {
      ok: true,
      changed: true,
      activation_mode: mode,
      membership_role: membership.role,
      resource_authority: {
        grant_id: authority.grant_id,
        resource_type: authority.resource_type,
        resource_ref: authority.resource_ref,
        permission: authority.permission,
      },
      grant: readback,
      policy: {
        user_jwt_required: true,
        active_membership_required: true,
        resource_authority_required: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

export async function listBrandSkillsForUser({ tenantId, brandKey, actor = {}, pool = getPool() } = {}) {
  const userId = actorUserId(actor);
  const normalizedTenantId = safeText(tenantId, 36);
  const normalizedBrandKey = safeText(brandKey, 128);
  if (!userId) throw httpError(401, "BRAND_SKILL_USER_JWT_REQUIRED", "Signed-in user identity is required.");

  const membership = await resolveMembership(pool, normalizedTenantId, userId);
  const [rows] = await pool.query(
    `SELECT p.policy_id, p.tenant_id, p.brand_key, p.activation_mode,
            p.allowed_roles_json, p.allowed_agent_ids_json, p.allowed_operations_json,
            p.max_ttl_hours, p.requires_resource_binding, p.constraints_json,
            s.skill_id, s.skill_key, s.display_name, s.description, s.skill_type, s.scope,
            g.grant_id, g.agent_id, g.resource_type, g.resource_ref,
            g.allowed_operations_json AS granted_operations_json, g.expires_at
       FROM brand_skill_policies p
       JOIN agent_skills s ON s.skill_id = p.skill_id AND s.status = 'active'
       LEFT JOIN v_effective_user_brand_skill_grants g
         ON g.policy_id = p.policy_id AND g.user_id = ?
      WHERE p.tenant_id = ? AND p.brand_key = ? AND p.status = 'active'
      ORDER BY s.skill_type, s.skill_key`,
    [userId, normalizedTenantId, normalizedBrandKey],
  );

  return {
    ok: true,
    tenant_id: normalizedTenantId,
    brand_key: normalizedBrandKey,
    membership_role: membership.role,
    skills: rows,
    total: rows.length,
    secrets_included: false,
  };
}

export async function revokeBrandSkillForUser({
  tenantId,
  brandKey,
  skillKey,
  agentId = null,
  actor = {},
  pool = getPool(),
} = {}) {
  const userId = actorUserId(actor);
  if (!userId) throw httpError(401, "BRAND_SKILL_USER_JWT_REQUIRED", "Signed-in user identity is required.");

  const normalizedTenantId = safeText(tenantId, 36);
  const normalizedBrandKey = safeText(brandKey, 128);
  const normalizedSkillKey = safeText(skillKey, 128);
  await resolveMembership(pool, normalizedTenantId, userId);

  const params = [userId, userId, normalizedTenantId, normalizedBrandKey, normalizedSkillKey];
  let agentClause = "";
  if (agentId) {
    agentClause = " AND g.agent_id = ?";
    params.push(safeText(agentId, 36));
  }

  const [result] = await pool.query(
    `UPDATE user_brand_skill_grants g
       JOIN agent_skills s ON s.skill_id = g.skill_id
        SET g.status = 'revoked', g.revoked_by = ?, g.revoked_at = NOW(), g.updated_at = NOW()
      WHERE g.user_id = ? AND g.tenant_id = ? AND g.brand_key = ? AND s.skill_key = ?
        AND g.status = 'active'${agentClause}`,
    params,
  );

  return {
    ok: true,
    tenant_id: normalizedTenantId,
    brand_key: normalizedBrandKey,
    skill_key: normalizedSkillKey,
    revoked_count: Number(result.affectedRows || 0),
    secrets_included: false,
  };
}

export const _testingBrandSkillActivationService = {
  OWNER_ROLES,
  ACTIVE_MODES,
  BRAND_RESOLVABLE_RESOURCE_TYPES,
  safeText,
  parseArray,
  normalizeRequestedOperations,
  operationsAllowed,
  normalizeTtlHours,
  resourceContextIncludesBrand,
  validatePolicy,
  expiryCompliesWithTtl,
};
