import { Router } from "express";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import {
  buildActivationSnapshot,
  buildActivationTabManifest,
  buildActivationOperationalSummary,
  buildActivationDashboardManifest,
  buildCompletenessEnvelope,
  buildAwarenessIndex,
  readActivationDynamicTabDetail,
} from "../activationAwarenessService.js";
import { acknowledgeActivationRun } from "../activationSessionLifecycleService.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const ALLOWED_PROFILES = new Set(["evidence", "summary", "dashboard", "diagnostic", "full"]);

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

async function fetchActiveMembership({ userId, tenantId = null }) {
  const params = [userId];
  let tenantClause = "";
  if (tenantId) {
    tenantClause = "AND m.tenant_id = ?";
    params.push(tenantId);
  }
  const [rows] = await getPool().query(
    `SELECT m.tenant_id, m.role, m.status
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

async function requireTenantUserJwt(req, res, next) {
  const payload = req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt(req.headers.authorization);
  if (!payload?.user_id) {
    return res.status(401).json({
      ok: false,
      error: { code: "user_jwt_required", message: "Sign in required." },
      secrets_included: false,
    });
  }
  const requestedTenantId = payload.tenant_id || req.headers["x-tenant-id"] || null;
  const membership = await fetchActiveMembership({ userId: payload.user_id, tenantId: requestedTenantId });
  if (!membership) {
    return res.status(403).json({
      ok: false,
      error: { code: "active_tenant_membership_required", message: "No active tenant membership found for this user." },
      secrets_included: false,
    });
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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function queryText(value, max = 200) {
  if (Array.isArray(value)) value = value[0];
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : null;
}

function profileValue(value) {
  const profile = String(value || "evidence").trim().toLowerCase();
  return ALLOWED_PROFILES.has(profile) ? profile : "evidence";
}

function subjectContext(req, isAdmin) {
  return {
    subject: {
      is_admin: isAdmin,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
    },
    platform_access: {
      access_scope: isAdmin ? "platform_admin_all" : "user_scoped",
      principal: {
        is_admin: isAdmin,
        tenant_id: req.auth?.tenant_id || null,
        user_id: req.auth?.user_id || null,
        type: req.auth?.mode || null,
      },
    },
  };
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: {
      code: err.code || fallbackCode,
      message: err.message,
      details: err.details || null,
      requestId: res.locals?.request_id || null,
    },
    secrets_included: false,
  });
}

async function buildAwarenessResponse(req, isAdmin) {
  const sessionContext = subjectContext(req, isAdmin);
  const profile = profileValue(req.query.profile || req.query.response_profile);
  const operationalSummary = await buildActivationOperationalSummary({
    sessionContext,
    attentionLimit: boundedInt(req.query.attention_limit, 10, 1, 20),
  });
  const preliminaryManifest = await buildActivationTabManifest({ sessionContext, operationalSummary });
  const snapshot = buildActivationSnapshot({
    sessionContext,
    registryVersion: preliminaryManifest.registry_version,
    profile,
  });
  const [dynamicTabs, dashboard] = await Promise.all([
    buildActivationTabManifest({ sessionContext, snapshot, operationalSummary }),
    buildActivationDashboardManifest({ sessionContext, snapshot }),
  ]);
  const completeness = buildCompletenessEnvelope({
    tabManifest: dynamicTabs,
    operationalSummary,
    dashboardManifest: dashboard,
    fullyHydratedSurfaces: 0,
  });
  return {
    ok: dynamicTabs.ok && operationalSummary.ok && dashboard.ok,
    activation_layer: "activation_awareness_readback",
    response_profile: profile,
    snapshot,
    dynamic_tabs: dynamicTabs,
    operational_summary: operationalSummary,
    dashboard,
    completeness,
    awareness_index: buildAwarenessIndex({ completeness, operationalSummary }),
    auth_context: {
      source: isAdmin ? "backend_api_key" : "user_jwt",
      is_admin: isAdmin,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      tenant_role: req.auth?.tenant_role || null,
    },
    secrets_included: false,
  };
}

async function detailResponse(req, isAdmin) {
  const containerKey = queryText(req.query.container_key, 240);
  const tabKey = queryText(req.query.tab_key, 180);
  if (!containerKey || !tabKey) {
    const err = new Error("container_key and tab_key are required.");
    err.status = 400;
    err.code = "activation_detail_scope_required";
    throw err;
  }
  return readActivationDynamicTabDetail({
    sessionContext: subjectContext(req, isAdmin),
    explicitSubject: {
      is_admin: isAdmin,
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || null,
      auth_mode: req.auth?.mode || null,
    },
    containerKey,
    tabKey,
    sectionKey: queryText(req.query.section_key, 180),
    cursor: boundedInt(req.query.cursor, 0, 0, 1000000),
    limit: boundedInt(req.query.limit, 25, 1, 100),
    snapshotId: queryText(req.query.snapshot_id, 180),
  });
}

export function buildActivationAwarenessRoutes({ requireBackendApiKey } = {}) {
  const router = Router();
  const adminGuards = [requireBackendApiKey].filter(Boolean);

  router.get("/activation/awareness", ...adminGuards, async (req, res) => {
    try {
      return res.status(200).json(await buildAwarenessResponse(req, true));
    } catch (err) {
      return errorResponse(res, err, "activation_awareness_read_failed");
    }
  });

  router.get("/activation/dynamic-tabs/detail", ...adminGuards, async (req, res) => {
    try {
      return res.status(200).json(await detailResponse(req, true));
    } catch (err) {
      return errorResponse(res, err, "activation_dynamic_tab_detail_failed");
    }
  });

  router.post("/activation/runs/:runId/ack", ...adminGuards, async (req, res) => {
    try {
      const result = await acknowledgeActivationRun(getPool(), {
        runId: req.params.runId,
        acknowledgedBy: req.body?.acknowledged_by || req.auth?.user_id || "platform_admin",
        consumerState: req.body?.consumer_state || "acknowledged",
      });
      if (!result.affected_rows) {
        return res.status(404).json({
          ok: false,
          error: { code: "activation_run_not_found", message: "Activation run was not found." },
          secrets_included: false,
        });
      }
      return res.status(200).json({ ...result, run_id: req.params.runId, secrets_included: false });
    } catch (err) {
      return errorResponse(res, err, "activation_run_ack_failed");
    }
  });

  router.get("/tenant/activation/awareness", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await buildAwarenessResponse(req, false));
    } catch (err) {
      return errorResponse(res, err, "tenant_activation_awareness_read_failed");
    }
  });

  router.get("/tenant/activation/dynamic-tabs/detail", requireTenantUserJwt, async (req, res) => {
    try {
      return res.status(200).json(await detailResponse(req, false));
    } catch (err) {
      return errorResponse(res, err, "tenant_activation_dynamic_tab_detail_failed");
    }
  });

  return router;
}

export const _testingActivationAwarenessRoutes = {
  verifyUserJwt,
  boundedInt,
  queryText,
  profileValue,
  subjectContext,
};
