import { Router } from "express";
import { applyPlatformResourceAuthorityGrant } from "../platformResourceAuthorityGrantTool.js";

function passthrough(_req, _res, next) {
  next();
}

function toErrorEnvelope(error) {
  return {
    ok: false,
    error: {
      code: error?.code || "platform_resource_authority_grant_failed",
      message: error?.message || "Platform resource authority grant failed.",
      details: error?.details || undefined,
    },
    secrets_included: false,
  };
}

export function buildResourceAuthorityGrantRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();
  const requireBackend = typeof requireBackendApiKey === "function" ? requireBackendApiKey : passthrough;
  const requireAdmin = typeof requireAdminPrincipal === "function" ? requireAdminPrincipal : passthrough;

  router.post("/admin/resource-authority/grants", requireBackend, requireAdmin, async (req, res) => {
    try {
      const result = await applyPlatformResourceAuthorityGrant(req.body || {});
      res.status(200).json(result);
    } catch (error) {
      res.status(error?.statusCode || 500).json(toErrorEnvelope(error));
    }
  });

  return router;
}
