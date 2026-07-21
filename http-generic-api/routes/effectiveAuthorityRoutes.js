import { Router } from "express";
import jwt from "jsonwebtoken";
import { getEffectiveAuthorityRuntimeService } from "../effectiveAuthorityRuntime.js";
import { createEffectiveAuthorityController } from "../src/api/effectiveAuthority/effectiveAuthorityController.js";

function pass(req, res, next) {
  next();
}

function fallbackAdminGuard(req, res, next) {
  if (req.auth?.is_admin === true || req.auth?.mode === "backend_api_key") return next();
  return res.status(403).json({
    ok: false,
    error: {
      code: "ADMIN_PRINCIPAL_REQUIRED",
      message: "A platform administrator is required.",
      details: [],
      requestId: req.requestId || null,
    },
    secrets_included: false,
  });
}

function fallbackUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt" && req.auth?.user_id && req.auth?.tenant_id) return next();
  try {
    const authorization = String(req.headers.authorization || "");
    if (!authorization.startsWith("Bearer ")) throw new Error("missing bearer token");
    const payload = jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "dev-secret");
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
    return res.status(401).json({
      ok: false,
      error: {
        code: "USER_JWT_REQUIRED",
        message: "A signed tenant user session is required.",
        details: [],
        requestId: req.requestId || null,
      },
      secrets_included: false,
    });
  }
}

export function buildEffectiveAuthorityRoutes(deps = {}) {
  const router = Router();
  const service = deps.effectiveAuthorityService || getEffectiveAuthorityRuntimeService();
  const controller = createEffectiveAuthorityController({ service });
  const requireBackendApiKey =
    typeof deps.requireBackendApiKey === "function" ? deps.requireBackendApiKey : pass;
  const requireAdminPrincipal =
    typeof deps.requireAdminPrincipal === "function" ? deps.requireAdminPrincipal : fallbackAdminGuard;
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
