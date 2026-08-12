import { Router } from "express";
import { getPool } from "../db.js";
import { createUserJwtMiddleware } from "../userJwtAuth.js";
import {
  analyzeRepoConflict,
  buildConflictCaseStudy,
  buildPrAutomationPreview,
  buildRepoConflictPlan,
  buildRepoConflictResolutionDryRun,
  buildTenantConflictReadinessReport,
  buildTenantConflictResolutionDryRun,
  buildTenantConflictSummary,
  previewSemanticPatches,
} from "../repoConflictIntelligenceService.js";

const requireUserJwt = createUserJwtMiddleware();

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

  router.post("/admin/repo-conflict-intelligence/resolve-dry-run", ...adminGuards, async (req, res) => {
    try { return res.status(200).json(buildRepoConflictResolutionDryRun(req.body || {})); } catch (error) { return errorResponse(res, error, "repo_conflict_resolver_dry_run_failed"); }
  });

  router.post("/admin/repo-conflict-intelligence/pr-automation-preview", ...adminGuards, async (req, res) => {
    try { return res.status(200).json(buildPrAutomationPreview(req.body || {})); } catch (error) { return errorResponse(res, error, "repo_conflict_pr_automation_preview_failed"); }
  });

  router.get("/admin/repo-conflict-intelligence/case-studies/:caseKey", ...adminGuards, async (req, res) => {
    try { return res.status(200).json(buildConflictCaseStudy(req.params.caseKey)); } catch (error) { return errorResponse(res, error, "repo_conflict_case_study_get_failed"); }
  });

  router.post("/admin/repo-conflict-intelligence/tenant-readiness-smoke", ...adminGuards, async (req, res) => {
    try {
      const [registryRows] = await getPool().query(
        `SELECT tool_key, is_enabled, http_method, http_path, tags
         FROM tenant_platform_endpoint_tools
         WHERE tool_key IN (?, ?, ?)
         ORDER BY tool_key`,
        [
          "tenant_repo_conflict_intelligence_analyze",
          "tenant_repo_conflict_intelligence_plan",
          "tenant_repo_conflict_intelligence_resolve_dry_run",
        ],
      );
      return res.status(200).json(buildTenantConflictReadinessReport({
        registry_rows: registryRows,
        sample_input: req.body?.sample_input,
      }));
    } catch (error) {
      return errorResponse(res, error, "tenant_repo_conflict_readiness_smoke_failed");
    }
  });

  router.post("/me/repo-conflict-intelligence/analyze", requireUserJwt, async (req, res) => {
    try { return res.status(200).json(buildTenantConflictSummary(req.body || {})); } catch (error) { return errorResponse(res, error, "tenant_repo_conflict_analyze_failed"); }
  });

  router.post("/me/repo-conflict-intelligence/plan", requireUserJwt, async (req, res) => {
    try { return res.status(200).json({ scope: "tenant", ...buildRepoConflictPlan(req.body || {}), execution_allowed: false, safe_next_actions: ["request_admin_resolution"], secrets_included: false }); } catch (error) { return errorResponse(res, error, "tenant_repo_conflict_plan_failed"); }
  });

  router.post("/me/repo-conflict-intelligence/resolve-dry-run", requireUserJwt, async (req, res) => {
    try { return res.status(200).json(buildTenantConflictResolutionDryRun(req.body || {})); } catch (error) { return errorResponse(res, error, "tenant_repo_conflict_resolver_dry_run_failed"); }
  });

  return router;
}
