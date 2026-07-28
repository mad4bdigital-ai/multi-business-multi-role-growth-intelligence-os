import { Router } from "express";
import jwt from "jsonwebtoken";
import {
  activateBrandSkillForUser,
  listBrandSkillsForUser,
  revokeBrandSkillForUser,
} from "../brandSkillActivationService.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

function verifyUserJwt(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try { return jwt.verify(authHeader.slice(7), JWT_SECRET); } catch { return null; }
}

function requireUserJwt(req, res, next) {
  const payload = req.auth?.mode === "user_jwt" ? req.auth : verifyUserJwt(req.headers.authorization);
  if (!payload || !payload.user_id) {
    return res.status(401).json({
      ok: false,
      error: { code: "user_jwt_required", message: "Sign in required.", requestId: req.requestId || null },
      secrets_included: false,
    });
  }
  req.auth = {
    mode: "user_jwt",
    user_id: payload.user_id,
    tenant_id: payload.tenant_id || null,
    is_admin: false,
  };
  return next();
}

function sendError(req, res, error) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: {
      code: error?.code || "BRAND_SKILL_ACTIVATION_FAILED",
      message: error?.message || "Brand skill activation failed.",
      details: error?.details || null,
      requestId: req.requestId || req.headers["x-request-id"] || null,
    },
    secrets_included: false,
  });
}

export function buildBrandSkillRoutes() {
  const router = Router();

  router.get("/me/workspaces/:tenant_id/brands/:brand_key/skills", requireUserJwt, async (req, res) => {
    try {
      const result = await listBrandSkillsForUser({
        tenantId: req.params.tenant_id,
        brandKey: req.params.brand_key,
        actor: req.auth,
      });
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.post("/me/workspaces/:tenant_id/brands/:brand_key/skills/:skill_key/activate", requireUserJwt, async (req, res) => {
    try {
      const result = await activateBrandSkillForUser({
        tenantId: req.params.tenant_id,
        brandKey: req.params.brand_key,
        skillKey: req.params.skill_key,
        agentId: req.body?.agent_id,
        input: req.body || {},
        actor: req.auth,
      });
      return res.status(result.changed ? 201 : 200).json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  router.delete("/me/workspaces/:tenant_id/brands/:brand_key/skills/:skill_key/activation", requireUserJwt, async (req, res) => {
    try {
      const result = await revokeBrandSkillForUser({
        tenantId: req.params.tenant_id,
        brandKey: req.params.brand_key,
        skillKey: req.params.skill_key,
        agentId: req.query.agent_id || null,
        actor: req.auth,
      });
      return res.json(result);
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  return router;
}
