import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import { loadPlatformPluginCatalog } from "../platformPluginCatalog.js";
import { resolvePlatformPluginExecution } from "../platformPluginResolver.js";
import { installPlatformPluginForTenant } from "../platformPluginInstall.js";
import { createCredentialIntakeSessionRecord } from "./credentialIntakeRoutes.js";
import { writeAuditLogAsync } from "../auditLogger.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const TENANT_CONNECTION_MANAGER_ROLES = new Set(["owner", "admin"]);
const TENANT_INTAKE_ALLOWED_FIELDS = new Set([
  "plugin_key", "pluginKey", "purpose", "display_label", "displayLabel",
  "expires_in_minutes", "expiresInMinutes",
]);

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

async function fetchActiveMembershipForTenant({ userId, tenantId = null }) {
  const pool = getPool();
  const params = [userId];
  let tenantClause = "";
  if (tenantId) {
    tenantClause = "AND m.tenant_id = ?";
    params.push(tenantId);
  }
  const [rows] = await pool.query(
    `SELECT m.tenant_id, m.role, m.status, t.display_name AS tenant_display_name
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
        ${tenantClause}
      ORDER BY m.granted_at ASC
      LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function loadTenantIntakePolicy({ tenantId, pluginKey }) {
  const [rows] = await getPool().query(
    `SELECT p.tenant_id, p.app_key, p.source_mode, p.fallback_allowed,
            p.required_for_device_install, p.status AS policy_status,
            a.display_name, a.auth_type, a.status AS app_status
       FROM tenant_integration_policies p
       JOIN app_integrations a ON a.app_key = p.app_key
      WHERE p.tenant_id = ?
        AND p.app_key = ?
        AND p.status = 'active'
        AND a.status IN ('active', 'beta')
      LIMIT 1`,
    [tenantId, pluginKey]
  );
  return rows[0] || null;
}

function tenantCanManageConnections(role) {
  return TENANT_CONNECTION_MANAGER_ROLES.has(String(role || "").trim().toLowerCase());
}

function tenantIntakeUnknownFields(input = {}) {
  return Object.keys(input).filter((key) => !TENANT_INTAKE_ALLOWED_FIELDS.has(key));
}

async function requireTenantUserJwt(req, res, next) {
  const payload = req.auth?.mode === "user_jwt"
    ? req.auth
    : verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Sign in required." }, secrets_included: false });
  }
  const requestedTenantId = payload.tenant_id || req.headers["x-tenant-id"] || null;
  const membership = await fetchActiveMembershipForTenant({ userId: payload.user_id, tenantId: requestedTenantId });
  if (!membership) {
    return res.status(403).json({ ok: false, error: { code: "active_tenant_membership_required", message: "No active tenant membership found for this user." }, secrets_included: false });
  }
  req.auth = {
    mode: "user_jwt",
    user_id: payload.user_id,
    tenant_id: membership.tenant_id,
    tenant_role: membership.role,
    is_admin: false,
  };
  return next();
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message, details: err.details || null },
    secrets_included: false,
  });
}

export function buildTenantPlatformPluginRoutes() {
  const router = Router();

  router.get("/tenant/platform/plugins/catalog", requireTenantUserJwt, async (req, res) => {
    try {
      const result = await loadPlatformPluginCatalog({
        tenantId: req.auth.tenant_id,
        userId: req.auth.user_id,
        includeInactive: false,
        includeBindings: req.query.include_bindings === undefined ? true : bool(req.query.include_bindings),
        limit: boundedInt(req.query.limit, 100, 1, 250),
      });
      return res.status(200).json({
        ...result,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_platform_plugin_catalog_failed"); }
  });

  router.post("/tenant/platform/plugins/install", requireTenantUserJwt, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await installPlatformPluginForTenant({
        tenantId: req.auth.tenant_id,
        userId: req.auth.user_id,
        pluginKey: input.plugin_key || input.pluginKey,
        sourceMode: input.source_mode || input.sourceMode || "dedicated",
        fallbackAllowed: input.fallback_allowed ?? input.fallbackAllowed ?? false,
        requiredForDeviceInstall: input.required_for_device_install ?? input.requiredForDeviceInstall ?? false,
        notes: input.notes || "tenant self-serve Platform Plugin install",
        connection: input.connection || null,
        rawPayload: input,
      });
      return res.status(result.ok ? 200 : 409).json({
        ...result,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        tenant_facing: true,
        platform_base_mutated: false,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_platform_plugin_install_failed"); }
  });

  router.post("/tenant/platform/plugins/resolve", requireTenantUserJwt, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await resolvePlatformPluginExecution({
        pluginKey: input.plugin_key || input.pluginKey,
        actionKey: input.action_key || input.actionKey || null,
        toolKey: input.tool_key || input.toolKey || null,
        tenantId: req.auth.tenant_id,
        userId: req.auth.user_id,
        agentId: input.agent_id || input.agentId || null,
        principalClass: "tenant",
        requestedCredentialScope: input.requested_credential_scope || input.requestedCredentialScope || null,
      });
      return res.status(200).json({
        ...result,
        auth_context: {
          tenant_id: req.auth.tenant_id,
          user_id: req.auth.user_id,
          tenant_role: req.auth.tenant_role,
          source: "user_jwt",
        },
        tenant_facing: true,
        secrets_included: false,
      });
    } catch (err) { return errorResponse(res, err, "tenant_platform_plugin_resolve_failed"); }
  });

  return router;
}

export const _testingTenantPlatformPluginRoutes = {
  verifyUserJwt,
  boundedInt,
  bool,
};
