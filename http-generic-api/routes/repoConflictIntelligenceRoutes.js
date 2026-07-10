import { Router } from "express";
import jwt from "jsonwebtoken";
import {
  analyzeRepoConflict,
  buildConflictCaseStudy,
  buildPrAutomationPreview,
  buildRepoConflictPlan,
  buildRepoConflictResolutionDryRun,
  buildTenantConflictResolutionDryRun,
  buildTenantConflictSummary,
  previewSemanticPatches,
} from "../repoConflictIntelligenceService.js";

function verifyUserJwt(authorization) {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  try { return jwt.verify(authorization.slice(7), process.env.JWT_SECRET || "dev-secret"); } catch { return null; }
}

function requireUserJwt(req, res, next) {
  if (req.auth?.mode === "user_jwt") return next();
  const payload = verifyUserJwt(req.headers.authorization);
  if (!payload?.user_id || !payload?.tenant_id) return res.status(401).json({ ok: false, error: { code: "user_jwt_required", message: "Tenant sign-in is required." }, secrets_included: false });
  req.auth = { mode: "user_jwt", user_id: payload.user_id, tenant_id: payload.tenant_id, is_admin: false };
  return next();
}

function errorResponse(res, error, fallbackCode) {
  return res.status(error.status || 500).json({ ok: false, error: { code: error.code || fallbackCode, message: error.message || "Request failed." }, secrets_included: false });
}

export function buildRepoConflictIntelligenceRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();
  const adminGuards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post("/admin/repo-conflict-intelligence/analyze", ...adminGuards, async (req, res) => {
    try { return res.status(200).json(analyzeRepoConflict(req.body || {})); } catch (error) { return errorResponse(res, error, "repo_conflict_analyze_failed"); }
  });

  router.post("/admin/repo-conflict-intelligence/plan", ...adminGuards, async (req, res) => {
    try { return res.status(200).json(buildRepoConflictPlan(req.body || {})); } catch (error) { return errorResponse(res, error, "repo_conflict_plan_failed"); }
  });

  router.post("/admin/repo-conflict-intelligence/semantic-preview", ...adminGuards, async (req, res) => {
    try { return res.status(200).json(previewSemanticPatches(req.body || {})); } catch (error) { return errorResponse(res, error, "repo_conflict_semantic_preview_failed"); }
  });

  router.post("/me/repo-conflict-intelligence/analyze", requireUserJwt, async (req, res) => {
    try { return res.status(200).json(buildTenantConflictSummary(req.body || {})); } catch (error) { return errorResponse(res, error, "tenant_repo_conflict_analyze_failed"); }
  });

  router.post("/me/repo-conflict-intelligence/plan", requireUserJwt, async (req, res) => {
    try { return res.status(200).json({ scope: "tenant", ...buildRepoConflictPlan(req.body || {}), execution_allowed: false, safe_next_actions: ["request_admin_resolution"], secrets_included: false }); } catch (error) { return errorResponse(res, error, "tenant_repo_conflict_plan_failed"); }
  });

  return router;
}
