import { Router } from "express";
import {
  activateBrandSkillForUser,
  listBrandSkillsForUser,
  revokeBrandSkillForUser,
} from "../brandSkillActivationService.js";
import {
  listBrandClaims,
  prepareClaimChallenge,
  requestBrandClaim,
  revokeWorkspaceBrandClaim,
  submitClaimEvidence,
} from "../brandClaimService.js";
import { createUserJwtMiddleware } from "../userJwtAuth.js";

function sendError(req, res, error) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: {
      code: error?.code || "BRAND_SKILL_ACTIVATION_FAILED",
      message: error?.message || "Brand operation failed.",
      details: error?.details || null,
      requestId: req.requestId || req.headers["x-request-id"] || null,
    },
    secrets_included: false,
  });
}

export function brandSkillActivationHttpStatus(result = {}) {
  return result.created === true ? 201 : 200;
}

export function buildBrandSkillRoutes(deps = {}) {
  const requireUserJwt = deps.requireUserJwt || createUserJwtMiddleware({ env: deps.env || process.env });
  const router = Router();

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_claim_request
  router.post("/me/workspaces/:tenant_id/brand-claims", requireUserJwt, async (req, res) => {
    try {
      const result = await requestBrandClaim({
        tenantId: req.params.tenant_id,
        actorUserId: req.auth?.user_id,
        input: req.body || {},
      });
      return res.status(result.created ? 202 : 200).json({ ok: true, tenant_id: req.params.tenant_id, ...result, secrets_included: false });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_claims_list
  router.get("/me/workspaces/:tenant_id/brand-claims", requireUserJwt, async (req, res) => {
    try {
      const result = await listBrandClaims({
        tenantId: req.params.tenant_id,
        actorUserId: req.auth?.user_id,
      });
      return res.json({ ok: true, tenant_id: req.params.tenant_id, ...result, secrets_included: false });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_claim_challenge_prepare
  router.post("/me/workspaces/:tenant_id/brand-claims/:claim_id/challenges", requireUserJwt, async (req, res) => {
    try {
      const result = await prepareClaimChallenge({
        tenantId: req.params.tenant_id,
        actorUserId: req.auth?.user_id,
        claimId: req.params.claim_id,
        input: req.body || {},
      });
      return res.status(201).json({ ok: true, tenant_id: req.params.tenant_id, challenge: result, secrets_included: false });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_claim_evidence_submit
  router.post("/me/workspaces/:tenant_id/brand-claims/:claim_id/evidence", requireUserJwt, async (req, res) => {
    try {
      const result = await submitClaimEvidence({
        tenantId: req.params.tenant_id,
        actorUserId: req.auth?.user_id,
        claimId: req.params.claim_id,
        input: req.body || {},
      });
      return res.status(202).json({ ok: true, tenant_id: req.params.tenant_id, ...result, secrets_included: false });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_claim_revoke
  router.post("/me/workspaces/:tenant_id/brand-claims/:claim_id/revoke", requireUserJwt, async (req, res) => {
    try {
      const result = await revokeWorkspaceBrandClaim({
        tenantId: req.params.tenant_id,
        actorUserId: req.auth?.user_id,
        claimId: req.params.claim_id,
        input: req.body || {},
      });
      return res.json({ ok: true, tenant_id: req.params.tenant_id, ...result, secrets_included: false });
    } catch (error) {
      return sendError(req, res, error);
    }
  });

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
      return res.status(brandSkillActivationHttpStatus(result)).json(result);
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
