import { Router } from "express";
import {
  buildTenantGrowthDashboard,
  buildTenantDashboardDigest,
  buildTenantDashboardActionPreview,
  readTenantDashboardPreferences,
  upsertTenantDashboardPreferences,
  recordTenantGrowthRecommendationEvent,
} from "../tenantGrowthDashboardService.js";

function requireTenantPrincipal(req, res, next) {
  if (req.auth?.mode !== "user_jwt" || req.auth?.is_admin === true || !req.auth?.tenant_id || !req.auth?.user_id) {
    return res.status(401).json({
      ok: false,
      error: {
        code: "tenant_user_jwt_required",
        message: "A signed tenant user JWT with tenant_id and user_id is required.",
      },
      secrets_included: false,
    });
  }
  return next();
}

function requireMatchingTenantParam(req, res, next) {
  const requestedTenantId = req.params?.tenant_id || req.params?.workspaceId || null;
  if (requestedTenantId && requestedTenantId !== req.auth?.tenant_id) {
    return res.status(403).json({
      ok: false,
      error: {
        code: "tenant_dashboard_scope_mismatch",
        message: "The requested dashboard scope is outside the signed-in tenant.",
      },
      secrets_included: false,
    });
  }
  return next();
}

function parseJsonQuery(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function errorResponse(res, error, fallback = "tenant_growth_dashboard_failed") {
  return res.status(error?.status || 500).json({
    ok: false,
    error: {
      code: error?.code || fallback,
      message: error?.message || String(error || fallback),
    },
    secrets_included: false,
  });
}

function dashboardArgs(req, { tabKey = null, mode = "dashboard" } = {}) {
  return {
    tenantId: req.auth.tenant_id,
    userId: req.auth.user_id,
    containerKey: req.query.container_key || null,
    tabKey: tabKey || req.query.tab || req.query.tab_key || null,
    dateRange: req.query.date_range || null,
    filters: parseJsonQuery(req.query.filters, {}),
    mode,
  };
}

async function dashboardResponse(req, res, { tabKey = null } = {}) {
  try {
    return res.status(200).json(await buildTenantGrowthDashboard(dashboardArgs(req, { tabKey })));
  } catch (error) {
    return errorResponse(res, error, tabKey ? "tenant_growth_dashboard_tab_failed" : "tenant_growth_dashboard_failed");
  }
}

async function preferencesReadResponse(req, res) {
  try {
    return res.status(200).json({
      ...(await readTenantDashboardPreferences({ tenantId: req.auth.tenant_id, userId: req.auth.user_id })),
      secrets_included: false,
    });
  } catch (error) {
    return errorResponse(res, error, "tenant_dashboard_preferences_read_failed");
  }
}

async function preferencesWriteResponse(req, res) {
  try {
    return res.status(200).json(await upsertTenantDashboardPreferences({
      tenantId: req.auth.tenant_id,
      userId: req.auth.user_id,
      preferences: req.body || {},
    }));
  } catch (error) {
    return errorResponse(res, error, "tenant_dashboard_preferences_write_failed");
  }
}

async function digestResponse(req, res) {
  try {
    return res.status(200).json(await buildTenantDashboardDigest({
      tenantId: req.auth.tenant_id,
      userId: req.auth.user_id,
      containerKey: req.query.container_key || null,
    }));
  } catch (error) {
    return errorResponse(res, error, "tenant_dashboard_digest_failed");
  }
}

async function actionPreviewResponse(req, res) {
  try {
    return res.status(200).json(await buildTenantDashboardActionPreview({
      tenantId: req.auth.tenant_id,
      userId: req.auth.user_id,
      actionRefKey: req.params.actionRefKey,
      containerKey: req.query.container_key || null,
    }));
  } catch (error) {
    return errorResponse(res, error, "tenant_dashboard_action_preview_failed");
  }
}

async function feedbackResponse(req, res) {
  try {
    return res.status(201).json(await recordTenantGrowthRecommendationEvent({
      tenantId: req.auth.tenant_id,
      userId: req.auth.user_id,
      recommendationId: req.params.recommendationId,
      eventType: req.body?.event_type,
      reasonCode: req.body?.reason_code || null,
      workspaceId: req.body?.workspace_id || null,
      recommendationKey: req.body?.recommendation_key || null,
      tabKey: req.body?.tab_key || null,
      cardId: req.body?.card_id || null,
      resultMetricKey: req.body?.result_metric_key || null,
      resultValue: req.body?.result_value ?? null,
      context: req.body?.context || {},
    }));
  } catch (error) {
    return errorResponse(res, error, "tenant_dashboard_feedback_failed");
  }
}

export function buildTenantGrowthDashboardRoutes({ requireBackendApiKey } = {}) {
  const router = Router();
  const legacyGuards = [requireBackendApiKey, requireTenantPrincipal].filter(Boolean);
  const userGuards = [requireTenantPrincipal].filter(Boolean);
  const scopedUserGuards = [...userGuards, requireMatchingTenantParam];

  // User-facing aliases. These are the dashboard contract for app clients.
  router.get("/me/dashboard", ...userGuards, dashboardResponse);
  router.get("/me/workspaces/:tenant_id/dashboard", ...scopedUserGuards, dashboardResponse);
  router.get("/me/workspaces/:tenant_id/dashboard/tabs/:tabKey", ...scopedUserGuards, (req, res) => dashboardResponse(req, res, { tabKey: req.params.tabKey }));
  router.get("/me/workspaces/:tenant_id/dashboard/preferences", ...scopedUserGuards, preferencesReadResponse);
  router.put("/me/workspaces/:tenant_id/dashboard/preferences", ...scopedUserGuards, preferencesWriteResponse);
  router.get("/me/workspaces/:tenant_id/dashboard/digest", ...scopedUserGuards, digestResponse);
  router.get("/me/workspaces/:tenant_id/dashboard/actions/:actionRefKey/preview", ...scopedUserGuards, actionPreviewResponse);
  router.post("/me/workspaces/:tenant_id/dashboard/recommendations/:recommendationId/feedback", ...scopedUserGuards, feedbackResponse);

  // Legacy GPT/API aliases kept for backward compatibility.
  router.get("/tenant/dashboard", ...legacyGuards, dashboardResponse);
  router.get("/tenant/dashboard/tabs/:tabKey", ...legacyGuards, (req, res) => dashboardResponse(req, res, { tabKey: req.params.tabKey }));
  router.get("/tenant/dashboard/preferences", ...legacyGuards, preferencesReadResponse);
  router.put("/tenant/dashboard/preferences", ...legacyGuards, preferencesWriteResponse);
  router.get("/tenant/dashboard/digest", ...legacyGuards, digestResponse);
  router.get("/tenant/dashboard/actions/:actionRefKey/preview", ...legacyGuards, actionPreviewResponse);
  router.post("/tenant/dashboard/recommendations/:recommendationId/feedback", ...legacyGuards, feedbackResponse);

  return router;
}

export const _testingTenantGrowthDashboardRoutes = {
  requireMatchingTenantParam,
  dashboardArgs,
};
