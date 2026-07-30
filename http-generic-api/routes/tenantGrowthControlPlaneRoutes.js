import { Router } from "express";
import { createTenantGrowthControlProjectionService } from "../src/application/growthControlPlane/tenantGrowthControlProjectionService.js";
import { createTenantGrowthControlProjectionRepository } from "../src/infrastructure/growthControlPlane/tenantGrowthControlProjectionRepository.js";

function requestId(req) {
  return String(req.headers?.["x-request-id"] || req.id || "");
}

function assertAllowedQuery(query = {}) {
  const allowed = new Set(["workspaceId", "brandKey", "limit", "cursor"]);
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));
  if (unknown.length) {
    const error = new Error("Unsupported query parameters were provided.");
    error.code = "TENANT_GROWTH_CONTROL_QUERY_INVALID";
    error.status = 400;
    error.details = unknown.map((field) => ({ field, issue: "unsupported" }));
    throw error;
  }
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

function errorResponse(req, res, error) {
  return res.status(Number(error.status) || 500).json({
    error: {
      code: error.code || "TENANT_GROWTH_CONTROL_INTERNAL_ERROR",
      message: error.message || "Tenant Growth Control Plane projection failed.",
      details: Array.isArray(error.details) ? error.details : [],
      requestId: requestId(req)
    },
    secretsIncluded: false
  });
}

export function buildTenantGrowthControlPlaneRoutes({ pool }) {
  const router = Router();
  const repository = createTenantGrowthControlProjectionRepository({ pool });
  const service = createTenantGrowthControlProjectionService({ repository });

  // frontend-surface-operation: GET /tenant/control-plane/configuration-versions
  router.get("/tenant/control-plane/configuration-versions", requireTenantUserJwt, async (req, res) => {
    try {
      assertAllowedQuery(req.query);
      const result = await service.listConfigurationVersions(req.auth, req.query);
      return res.status(200).json(result);
    } catch (error) {
      return errorResponse(req, res, error);
    }
  });

  // frontend-surface-operation: GET /tenant/control-plane/activity-bindings
  router.get("/tenant/control-plane/activity-bindings", requireTenantUserJwt, async (req, res) => {
    try {
      assertAllowedQuery(req.query);
      const result = await service.listActivityBindings(req.auth, req.query);
      return res.status(200).json(result);
    } catch (error) {
      return errorResponse(req, res, error);
    }
  });

  return router;
}

export const _testingTenantGrowthControlPlaneRoutes = Object.freeze({
  assertAllowedQuery,
  requireTenantProjectionPrincipal: requireTenantUserJwt,
  errorResponse
});
