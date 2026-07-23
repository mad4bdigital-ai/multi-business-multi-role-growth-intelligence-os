import { Router } from "express";
import { getEffectiveAuthorityRuntimeService } from "../effectiveAuthorityRuntime.js";
import { createUserJwtMiddleware } from "../userJwtAuth.js";
import { createEffectiveAuthorityController } from "../src/api/effectiveAuthority/effectiveAuthorityController.js";

function errorEnvelope(req, code, message) {
  return {
    ok: false,
    error: {
      code,
      message,
      details: [],
      requestId: req.requestId || null,
    },
    secrets_included: false,
  };
}

function missingBackendAuthMiddleware(req, res) {
  return res
    .status(503)
    .json(
      errorEnvelope(
        req,
        "BACKEND_AUTH_MIDDLEWARE_UNAVAILABLE",
        "Backend authentication is not configured for this authority surface."
      )
    );
}

function fallbackAdminGuard(req, res, next) {
  if (req.auth?.is_admin === true || req.auth?.mode === "backend_api_key") return next();
  return res
    .status(403)
    .json(
      errorEnvelope(
        req,
        "ADMIN_PRINCIPAL_REQUIRED",
        "A platform administrator is required."
      )
    );
}

const centralizedUserJwt = createUserJwtMiddleware();

function requireTenantIdentity(req, res, next) {
  if (req.auth?.mode === "user_jwt" && req.auth?.user_id && req.auth?.tenant_id) {
    return next();
  }
  return res
    .status(403)
    .json(
      errorEnvelope(
        req,
        "TENANT_IDENTITY_REQUIRED",
        "A tenant-scoped user identity is required for this authority surface."
      )
    );
}

function fallbackUserJwt(req, res, next) {
  return centralizedUserJwt(req, res, () => requireTenantIdentity(req, res, next));
}

export function buildEffectiveAuthorityRoutes(deps = {}) {
  const router = Router();
  const service = deps.effectiveAuthorityService || getEffectiveAuthorityRuntimeService();
  const controller = createEffectiveAuthorityController({ service });
  const requireBackendApiKey =
    typeof deps.requireBackendApiKey === "function"
      ? deps.requireBackendApiKey
      : missingBackendAuthMiddleware;
  const requireAdminPrincipal =
    typeof deps.requireAdminPrincipal === "function"
      ? deps.requireAdminPrincipal
      : fallbackAdminGuard;
  const requireUserJwt =
    typeof deps.requireUserJwt === "function" ? deps.requireUserJwt : fallbackUserJwt;

  router.get(
    "/authority/projections/connectors",
    requireBackendApiKey,
    requireAdminPrincipal,
    controller.listAdminConnectors
  );
  router.post(
    "/authority/decisions/resolve",
    requireBackendApiKey,
    requireAdminPrincipal,
    controller.resolveAdminDecision
  );
  router.get(
    "/me/authority/projections/connectors",
    requireUserJwt,
    controller.listTenantConnectors
  );
  router.post(
    "/me/authority/decisions/resolve",
    requireUserJwt,
    controller.resolveTenantDecision
  );

  return router;
}
