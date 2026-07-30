import { Router } from "express";
import {
  activateBrandSkillForUser,
  listBrandSkillsForUser,
  revokeBrandSkillForUser,
} from "../brandSkillActivationService.js";
import { createUserJwtMiddleware } from "../userJwtAuth.js";

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

export function buildBrandSkillRoutes(deps = {}) {
  const requireUserJwt = deps.requireUserJwt || createUserJwtMiddleware({ env: deps.env || process.env });
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
