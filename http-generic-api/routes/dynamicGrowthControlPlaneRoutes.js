import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { createGrowthControlPlaneRepository } from "../src/infrastructure/growthControlPlane/growthControlPlaneRepository.js";
import { createGrowthControlPlaneService } from "../src/application/growthControlPlane/growthControlPlaneService.js";

function requestId(req) {
  return String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || randomUUID());
}

function actorId(req) {
  return req.auth?.user_id || req.auth?.principal_id || req.auth?.admin_id || "platform_admin";
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
  resolvePool = () => getPool()
}) {
  const router = Router();
  const repository = service ? null : createGrowthControlPlaneRepository({ resolvePool });
  const controlPlane = service || createGrowthControlPlaneService({ repository });
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal];

  // frontend-surface-operation: GET /admin/control-plane/configurations
  router.get("/admin/control-plane/configurations", ...requireAdmin, async (req, res) => {
    try {
      assertAllowedKeys(req.query, new Set(["limit", "cursor"]));
      const result = await controlPlane.listConfigurationDefinitions({ limit: req.query.limit, cursor: req.query.cursor });
      return res.json(result);
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

  return router;
}

export const _testingDynamicGrowthControlPlaneRoutes = Object.freeze({ requestId, actorId, assertAllowedKeys, idempotencyKey, errorResponse });
