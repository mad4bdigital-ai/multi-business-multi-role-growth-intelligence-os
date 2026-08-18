import { Router } from "express";
import { getPool } from "../db.js";
import {
  buildRepositoryAutomationPlan,
  readRepositoryAutomationRun,
  runRepositoryAutomation,
  scanRepositoryAutomationHygiene,
} from "../repositoryAutomationPolicyFacade.js";
import { runGithubRepositoryPolicyController } from "../githubRepositoryPolicyController.js";
import { runGithubRepositoryGovernanceAttestation } from "../githubRepositoryGovernanceAttestation.js";
import { runRepositoryReconciliationLeaseControl } from "../repositoryReconciliationLeaseControl.js";
import { dispatchToolForCaller, resolveCallerTypeForRequest } from "./gptToolsRoutes.js";
import { buildOperationObservabilityRoutes } from "./operationObservabilityRoutes.js";

function bodyOf(req) {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  if (body.tool_args && typeof body.tool_args === "object" && !Array.isArray(body.tool_args)) return body.tool_args;
  if (body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)) return body.arguments;
  return body;
}

function errorResponse(res, error, fallbackCode) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: {
      code: error?.code || fallbackCode,
      message: error?.message || "Repository automation request failed.",
      details: error?.details || null,
    },
    secrets_included: false,
  });
}

function automationDeps(req) {
  const callerType = resolveCallerTypeForRequest(req);
  return {
    pool: getPool(),
    auth: {
      tenant_id: req.auth?.tenant_id || null,
      user_id: req.auth?.user_id || req.auth?.admin_id || null,
      admin_id: req.auth?.admin_id || null,
      role: req.auth?.role || req.auth?.admin_role || null,
      is_admin: req.auth?.is_admin === true,
      caller_type: callerType,
    },
    dispatch: (toolKey, args) => dispatchToolForCaller(callerType, toolKey, args, req),
  };
}

function isRepositoryPolicyRequest(input = {}) {
  const key = String(input?.automation_key || input?.workflow || "").trim().toLowerCase();
  return key === "repository_policy" || key === "repository_policy_controller";
}

function assertLegacySurfaceDoesNotOwnRepositoryPolicy(input = {}) {
  if (!isRepositoryPolicyRequest(input)) return;
  const error = new Error("repository_policy is Constitution-owned and must use /admin/repository-automation/policy-controller.");
  error.status = 409;
  error.code = "repository_policy_legacy_surface_retired";
  error.details = {
    canonical_surface: "/admin/repository-automation/policy-controller",
    constitution: "http-generic-api/config/repository-governance-constitution.json",
    legacy_plan_run_mutation_authority: false,
    secrets_included: false,
  };
  throw error;
}

export function buildRepositoryAutomationRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.use(buildOperationObservabilityRoutes({ requireBackendApiKey, requireAdminPrincipal }));

  router.post("/admin/repository-automation/plan", ...requireAdmin, async (req, res) => {
    try {
      const input = bodyOf(req);
      assertLegacySurfaceDoesNotOwnRepositoryPolicy(input);
      const result = buildRepositoryAutomationPlan(input);
      return res.status(200).json(result);
    } catch (error) {
      return errorResponse(res, error, "repository_automation_plan_failed");
    }
  });

  router.post("/admin/repository-automation/run", ...requireAdmin, async (req, res) => {
    try {
      const input = bodyOf(req);
      assertLegacySurfaceDoesNotOwnRepositoryPolicy(input);
      const result = await runRepositoryAutomation(input, automationDeps(req));
      const status = result.ok ? 200 : result.status === "awaiting_input" ? 202 : 409;
      return res.status(status).json(result);
    } catch (error) {
      return errorResponse(res, error, "repository_automation_run_failed");
    }
  });

  router.post("/admin/repository-automation/policy-controller", ...requireAdmin, async (req, res) => {
    try {
      const input = bodyOf(req);
      const deps = automationDeps(req);
      const result = String(input.mode || "").trim().toLowerCase() === "attest"
        ? await runGithubRepositoryGovernanceAttestation(input, deps)
        : await runGithubRepositoryPolicyController(input, deps);
      return res.status(200).json(result);
    } catch (error) {
      return errorResponse(res, error, "github_repository_policy_controller_failed");
    }
  });

  router.post("/admin/repository-automation/status", ...requireAdmin, async (req, res) => {
    try {
      const result = await readRepositoryAutomationRun(bodyOf(req), { pool: getPool() });
      return res.status(200).json(result);
    } catch (error) {
      return errorResponse(res, error, "repository_automation_status_failed");
    }
  });

  router.post("/admin/repository-automation/hygiene-scan", ...requireAdmin, async (req, res) => {
    try {
      const result = await scanRepositoryAutomationHygiene(bodyOf(req), automationDeps(req));
      return res.status(200).json(result);
    } catch (error) {
      return errorResponse(res, error, "repository_automation_hygiene_scan_failed");
    }
  });

  router.post("/admin/repository-automation/reconciliation-lease", ...requireAdmin, async (req, res) => {
    try {
      const result = await runRepositoryReconciliationLeaseControl(bodyOf(req), automationDeps(req));
      return res.status(200).json(result);
    } catch (error) {
      return errorResponse(res, error, "repository_reconciliation_lease_control_failed");
    }
  });

  return router;
}
