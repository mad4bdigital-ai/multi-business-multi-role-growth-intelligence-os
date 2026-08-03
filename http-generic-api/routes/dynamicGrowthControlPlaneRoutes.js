import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { createGrowthControlPlaneRepository } from "../src/infrastructure/growthControlPlane/growthControlPlaneRepository.js";
import { createGrowthControlShadowParityRepository } from "../src/infrastructure/growthControlPlane/growthControlShadowParityRepository.js";
import { createGrowthControlAnalyticsObservabilityRepository } from "../src/infrastructure/growthControlPlane/growthControlAnalyticsObservabilityRepository.js";
import { createGrowthControlPlaneService } from "../src/application/growthControlPlane/growthControlPlaneService.js";
import { createGrowthControlShadowParityService } from "../src/application/growthControlPlane/growthControlShadowParityService.js";
import { createAdminGrowthControlUiProjectionService } from "../src/application/growthControlPlane/adminGrowthControlUiProjectionService.js";
import { createGrowthControlAnalyticsObservabilityService } from "../src/application/growthControlPlane/growthControlAnalyticsObservabilityService.js";

function requestId(req) {
  return String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || randomUUID());
}

function actorId(req) {
  return req.auth?.user_id || req.auth?.principal_id || req.auth?.admin_id || "platform_admin";
}

function lifecycleRequestContext(req) {
  const stableRequestId = requestId(req);
  return Object.freeze({
    actorId: actorId(req),
    requestId: stableRequestId,
    correlationId: String(req.headers["x-correlation-id"] || stableRequestId),
    sourceEnvironment: process.env.APP_ENV || process.env.NODE_ENV || "development"
  });
}

function assertAllowedKeys(body, allowed) {
  const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key));
  if (unknown.length) {
    const error = new Error("Request contains unsupported fields.");
    error.status = 400;
    error.code = "GROWTH_CONTROL_VALIDATION_ERROR";
    error.details = unknown.map((field) => ({ field, issue: "unsupported" }));
    throw error;
  }
}

function idempotencyKey(req) {
  return String(req.headers["idempotency-key"] || "").trim();
}

function requireTenantUserJwt(req, res, next) {
  const auth = req.auth || {};
  if (auth.mode !== "user_jwt" || !auth.user_id || !auth.tenant_id || auth.is_admin === true) {
    return res.status(401).json({
      error: {
        code: "TENANT_USER_JWT_REQUIRED",
        message: "A signed non-admin tenant user JWT is required.",
        details: [],
        requestId: requestId(req)
      },
      secretsIncluded: false
    });
  }
  return next();
}

function requireBackendServicePrincipal(req, res, next) {
  const auth = req.auth || {};
  if (auth.mode !== "backend_api_key" || auth.is_admin !== true) {
    return res.status(403).json({
      error: {
        code: "BACKEND_SERVICE_AUTH_REQUIRED",
        message: "Backend service authentication is required for internal Growth Control writes.",
        details: [],
        requestId: requestId(req)
      },
      secretsIncluded: false
    });
  }
  return next();
}

function booleanQuery(value) {
  if (value == null || value === "") return false;
  return String(value).trim().toLowerCase() === "true";
}

function errorResponse(req, res, error) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    error: {
      code: error?.code || "GROWTH_CONTROL_INTERNAL_ERROR",
      message: status >= 500 ? "Growth Control Plane operation failed." : error.message,
      details: Array.isArray(error?.details) ? error.details : [],
      requestId: requestId(req)
    },
    secretsIncluded: false
  });
}

export function buildDynamicGrowthControlPlaneRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  service = null,
  uiProjectionService = null,
  analyticsObservabilityService = null,
  resolvePool = () => getPool(),
  shadowParityEnabled = process.env.GROWTH_CONTROL_SHADOW_PARITY_ENABLED === "true"
}) {
  const router = Router();
  const repository = createGrowthControlPlaneRepository({ resolvePool });
  const shadowParityRepository = service || !shadowParityEnabled
    ? null
    : createGrowthControlShadowParityRepository({ resolvePool });
  const shadowParityObserver = shadowParityRepository
    ? createGrowthControlShadowParityService({ repository: shadowParityRepository })
    : null;
  const controlPlane = service || createGrowthControlPlaneService({ repository, shadowParityObserver });
  const adminUiProjection = uiProjectionService || createAdminGrowthControlUiProjectionService({ repository });
  const analyticsRepository = analyticsObservabilityService
    ? null
    : createGrowthControlAnalyticsObservabilityRepository({ resolvePool });
  const analyticsOperations = analyticsObservabilityService
    || createGrowthControlAnalyticsObservabilityService({ repository: analyticsRepository });
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal];
  const requireInternalBackend = [requireBackendApiKey, requireBackendServicePrincipal];

  // frontend-surface-operation: GET /admin/control-plane/configurations
  router.get("/admin/control-plane/configurations", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["limit", "cursor"]));
      const result = await controlPlane.listConfigurationDefinitions({ limit: req.query.limit, cursor: req.query.cursor });
      return res.json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: GET /admin/control-plane/configurations/{configKey}/ui-projection
  router.get("/admin/control-plane/configurations/:configKey/ui-projection", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["baseVersionId", "compareVersionId"]));
      const result = await adminUiProjection.projectConfiguration(req.params.configKey, req.query || {});
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/configurations
  router.post("/admin/control-plane/configurations", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["configKey","schemaVersion","schema","defaultValues","allowedScopes","mergeProfile","securityClassification"]));
      const result = await controlPlane.createConfigurationDefinition(req.body || {}, { actorId: actorId(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/configurations/{configKey}/versions
  router.post("/admin/control-plane/configurations/:configKey/versions", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["scope","values","expectedRevision"]));
      const result = await controlPlane.createConfigurationVersion(req.params.configKey, req.body || {}, {
        actorId: actorId(req), idempotencyKey: idempotencyKey(req)
      });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/configurations/{configKey}/resolve
  router.post("/admin/control-plane/configurations/:configKey/resolve", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["context","includeDraftVersionIds"]));
      const result = await controlPlane.resolveConfiguration(req.params.configKey, req.body || {}, { actorId: actorId(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/configurations/{configKey}/versions/{configVersionId}/validations
  router.post("/admin/control-plane/configurations/:configKey/versions/:configVersionId/validations", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["expectedRevision"]));
      const result = await controlPlane.validateConfigurationVersion(
        req.params.configKey,
        req.params.configVersionId,
        req.body || {},
        lifecycleRequestContext(req)
      );
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/configurations/{configKey}/versions/{configVersionId}/approval-holds
  router.post("/admin/control-plane/configurations/:configKey/versions/:configVersionId/approval-holds", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["operation", "expiresInMinutes"]));
      const result = await controlPlane.createConfigurationLifecycleApprovalHold(
        req.params.configKey,
        req.params.configVersionId,
        req.body || {},
        lifecycleRequestContext(req)
      );
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/configurations/{configKey}/versions/{configVersionId}/activations
  router.post("/admin/control-plane/configurations/:configKey/versions/:configVersionId/activations", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["approvalHoldId", "expectedRevision"]));
      const result = await controlPlane.activateConfigurationVersion(
        req.params.configKey,
        req.params.configVersionId,
        req.body || {},
        lifecycleRequestContext(req)
      );
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/configurations/{configKey}/versions/{configVersionId}/rollbacks
  router.post("/admin/control-plane/configurations/:configKey/versions/:configVersionId/rollbacks", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["approvalHoldId", "expectedRevision"]));
      const result = await controlPlane.rollbackConfigurationVersion(
        req.params.configKey,
        req.params.configVersionId,
        req.body || {},
        lifecycleRequestContext(req)
      );
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: GET /admin/control-plane/activity-packs
  router.get("/admin/control-plane/activity-packs", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["limit", "cursor"]));
      const result = await controlPlane.listActivityPacks({ limit: req.query.limit, cursor: req.query.cursor });
      return res.json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/activity-packs
  router.post("/admin/control-plane/activity-packs", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["activityPackKey","activityTypeKey","displayName","description"]));
      const result = await controlPlane.createActivityPackDefinition(req.body || {}, { actorId: actorId(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/activity-packs/{activityPackKey}/versions
  router.post("/admin/control-plane/activity-packs/:activityPackKey/versions", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["manifest"]));
      const result = await controlPlane.createActivityPackVersion(req.params.activityPackKey, req.body || {}, {
        actorId: actorId(req), idempotencyKey: idempotencyKey(req)
      });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: POST /admin/control-plane/brand-activity-bindings
  router.post("/admin/control-plane/brand-activity-bindings", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["tenantId","workspaceId","brandKey","activityTypeKey","activityPackKey","activityPackVersion","markets","locales","channels","objectives","allowedCapabilities"]));
      const result = await controlPlane.createBrandActivityBinding(req.body || {}, {
        actorId: actorId(req), idempotencyKey: idempotencyKey(req)
      });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: GET /admin/control-plane/analytics/kpis
  router.get("/admin/control-plane/analytics/kpis", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["tenantId","workspaceIds","brandKeys","activityBindingIds","normalizedKpiKeys"]));
      const result = await analyticsOperations.projectKpiCatalog(req.query || {});
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: GET /admin/control-plane/analytics/portfolio
  router.get("/admin/control-plane/analytics/portfolio", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["tenantId","workspaceIds","brandKeys","normalizedKpiKeys","periodStart","periodEnd","limit"]));
      const result = await analyticsOperations.projectAdminPortfolio(req.query || {});
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: GET /tenant/control-plane/analytics/portfolio
  router.get("/tenant/control-plane/analytics/portfolio", requireTenantUserJwt, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["workspaceId","brandKey","normalizedKpiKeys","periodStart","periodEnd","limit"]));
      const result = await analyticsOperations.projectTenantPortfolio(req.auth, req.query || {});
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: GET /admin/control-plane/operations/dashboard
  router.get("/admin/control-plane/operations/dashboard", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["tenantId","workspaceIds","brandKeys","environment","windowStart","windowEnd","sampleLimit","findingLimit","includePortfolio","normalizedKpiKeys","periodStart","periodEnd","limit"]));
      const result = await analyticsOperations.projectAdminOperationalHealth({ ...req.query, includePortfolio: booleanQuery(req.query.includePortfolio) });
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  // frontend-surface-operation: GET /tenant/control-plane/operations/dashboard
  router.get("/tenant/control-plane/operations/dashboard", requireTenantUserJwt, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["workspaceId","brandKey","environment","windowStart","windowEnd","sampleLimit","findingLimit","includePortfolio","normalizedKpiKeys","periodStart","periodEnd","limit"]));
      const result = await analyticsOperations.projectTenantOperationalHealth(req.auth, { ...req.query, includePortfolio: booleanQuery(req.query.includePortfolio) });
      return res.status(200).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  router.post("/internal/control-plane/analytics/observations", ...requireInternalBackend, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["observationId","tenantId","workspaceId","brandKey","activityBindingId","nativeKpiKey","nativeValue","weight","periodStart","periodEnd","observedAt","confidence","sourceSystemKey","sourceObservationId","sourceEventId","now"]));
      const result = await analyticsOperations.recordMetricObservation({ ...(req.body || {}), idempotencyKey: idempotencyKey(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  router.post("/internal/control-plane/operations/samples", ...requireInternalBackend, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["sampleId","metricKey","tenantId","workspaceId","brandKey","environment","value","weight","observedAt","sourceEvidenceSha256"]));
      const result = await analyticsOperations.recordObservabilitySample({ ...(req.body || {}), idempotencyKey: idempotencyKey(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  router.post("/internal/control-plane/operations/decision-evidence", ...requireInternalBackend, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["requestId","traceId","tenantId","workspaceId","brandKey","activityBindingId","planId","runId","capabilityKey","workflowVersion","configSnapshotId","policySnapshotId","selectedAdapterKey","gateResults","reasonCodes","durationMs","resultClassification","readbackStatus"]));
      const result = await analyticsOperations.recordDecisionEvidence({ ...(req.body || {}), idempotencyKey: idempotencyKey(req) });
      return res.status(201).json(result);
    } catch (error) { return errorResponse(req, res, error); }
  });

  return router;
}

export const _testingDynamicGrowthControlPlaneRoutes = Object.freeze({ requestId, actorId, assertAllowedKeys, idempotencyKey, requireTenantUserJwt, requireBackendServicePrincipal, booleanQuery, errorResponse });
