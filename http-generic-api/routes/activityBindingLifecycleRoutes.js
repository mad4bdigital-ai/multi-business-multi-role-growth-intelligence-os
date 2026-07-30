import { Router } from "express";
import { getPool } from "../db.js";
import { GrowthControlPlaneError } from "../src/domain/growthControlPlane/growthControlPlane.js";
import { createActivityBindingLifecycleService } from "../src/application/growthControlPlane/activityBindingLifecycleService.js";
import { createActivityBindingLifecycleRepository } from "../src/infrastructure/growthControlPlane/activityBindingLifecycleRepository.js";

function requestId(req) {
  return req.requestId || req.headers?.["x-request-id"] || null;
}

function requiredScope(req) {
  const tenantId = String(req.body?.tenantId ?? "").trim();
  const workspaceId = String(req.body?.workspaceId ?? "").trim();
  const brandKey = String(req.body?.brandKey ?? "").trim();
  const details = [];
  if (!tenantId) details.push({ field: "tenantId", issue: "required" });
  if (!workspaceId) details.push({ field: "workspaceId", issue: "required" });
  if (!brandKey) details.push({ field: "brandKey", issue: "required" });
  if (details.length) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_ACTIVITY_BINDING_SCOPE_REQUIRED",
      "tenantId, workspaceId, and brandKey are required.",
      400,
      details
    );
  }
  return Object.freeze({
    tenantId,
    workspaceId,
    brandKey,
    actorId: req.auth?.userId || req.auth?.sub || req.user?.id || "platform_admin",
    requestId: requestId(req),
    correlationId: req.headers?.["x-correlation-id"] || null
  });
}

function errorEnvelope(error, req) {
  const status = Number(error?.status || error?.statusCode || 500);
  return Object.freeze({
    status: status >= 400 && status <= 599 ? status : 500,
    body: {
      error: {
        code: error?.code || "GROWTH_CONTROL_ACTIVITY_BINDING_INTERNAL_ERROR",
        message: status >= 500 ? "Activity binding lifecycle request failed." : String(error?.message || "Request failed."),
        details: Array.isArray(error?.details) ? error.details : [],
        requestId: requestId(req)
      }
    }
  });
}

function asyncRoute(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      const mapped = errorEnvelope(error, req);
      res.status(mapped.status).json(mapped.body);
    }
  };
}

export function buildActivityBindingLifecycleRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  service = null,
  resolvePool = () => getPool()
}) {
  const router = Router();
  const repository = service ? null : createActivityBindingLifecycleRepository({ resolvePool });
  const lifecycle = service || createActivityBindingLifecycleService({ repository });
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post(
    "/admin/control-plane/brand-activity-bindings/:activityBindingId/readiness",
    ...guards,
    asyncRoute(async (req, res) => {
      const result = await lifecycle.assessReadiness(
        req.params.activityBindingId,
        { expectedRevision: req.body?.expectedRevision },
        requiredScope(req)
      );
      res.status(200).json({ activityBinding: result });
    })
  );

  router.post(
    "/admin/control-plane/brand-activity-bindings/:activityBindingId/transitions",
    ...guards,
    asyncRoute(async (req, res) => {
      const result = await lifecycle.transitionActivityBinding(
        req.params.activityBindingId,
        {
          targetStatus: req.body?.targetStatus,
          expectedRevision: req.body?.expectedRevision,
          reason: req.body?.reason
        },
        requiredScope(req)
      );
      res.status(200).json({ activityBinding: result });
    })
  );

  return router;
}

export const _testingActivityBindingLifecycleRoutes = Object.freeze({
  requestId,
  requiredScope,
  errorEnvelope,
  asyncRoute
});
