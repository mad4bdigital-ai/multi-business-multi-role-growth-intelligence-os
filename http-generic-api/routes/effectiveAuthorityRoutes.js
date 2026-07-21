import { Router } from "express";
import jwt from "jsonwebtoken";
import { getEffectiveAuthorityRuntimeService } from "../effectiveAuthorityRuntime.js";
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

function fallbackUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt" && req.auth?.user_id && req.auth?.tenant_id) return next();

  const jwtSecret = String(process.env.JWT_SECRET || "").trim();
  if (!jwtSecret) {
    return res
      .status(503)
      .json(
        errorEnvelope(
          req,
          "USER_AUTH_CONFIGURATION_UNAVAILABLE",
          "Tenant authentication is not configured for this authority surface."
        )
      );
  }

  try {
    const authorization = String(req.headers.authorization || "");
    if (!authorization.startsWith("Bearer ")) throw new Error("missing bearer token");
    const payload = jwt.verify(authorization.slice(7), jwtSecret);
    if (!payload?.user_id || !payload?.tenant_id) throw new Error("missing tenant identity");
    req.auth = {
      mode: "user_jwt",
      user_id: payload.user_id,
      tenant_id: payload.tenant_id,
      principal_type: payload.principal_type || "tenant_member",
      claims: payload,
    };
    return next();
  } catch {
    return res
      .status(401)
      .json(
        errorEnvelope(
          req,
          "USER_JWT_REQUIRED",
          "A signed tenant user session is required."
        )
      );
  }
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
