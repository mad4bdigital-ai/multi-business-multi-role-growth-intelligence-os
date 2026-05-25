import { Router } from "express";
import {
  checkBrowserRuntimePolicyFromDb,
  createBrowserDataExtractionJob,
  createBrowserSiteInspectionRun,
  getBrowserRuntime,
  healthBrowserRuntime,
  listBrowserRuntimes,
  upsertBrowserRuntimeBinding,
} from "../browserRuntimeGovernance.js";

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function boundedInt(value, fallback = 100, min = 1, max = 250) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message, details: err.details || null },
    secrets_included: false,
  });
}

export function buildBrowserRuntimeRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/browser-runtime/runtimes", ...requireAdmin, async (req, res) => {
    try {
      const result = await listBrowserRuntimes({
        status: req.query.status || null,
        provider: req.query.provider || null,
        capability_class: req.query.capability_class || null,
        limit: boundedInt(req.query.limit),
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "browser_runtime_list_failed"); }
  });

  router.get("/browser-runtime/runtimes/:runtime_key", ...requireAdmin, async (req, res) => {
    try {
      const result = await getBrowserRuntime({ runtime_key: req.params.runtime_key });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "browser_runtime_get_failed"); }
  });

  router.post("/browser-runtime/health", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await healthBrowserRuntime({
        runtime_key: input.runtime_key || input.runtimeKey || null,
        binding_key: input.binding_key || input.bindingKey || null,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "browser_runtime_health_failed"); }
  });

  router.post("/browser-runtime/bindings", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await upsertBrowserRuntimeBinding({ binding: {
        binding_key: input.binding_key || input.bindingKey,
        runtime_key: input.runtime_key || input.runtimeKey,
        use_case: input.use_case || input.useCase,
        tenant_id: input.tenant_id || input.tenantId || null,
        user_id: input.user_id || input.userId || null,
        allowed_brands: input.allowed_brands || input.allowedBrands || [],
        allowed_actions: input.allowed_actions || input.allowedActions || [],
        domain_allowlist: input.domain_allowlist || input.domainAllowlist || input.allowed_domains || [],
        policy: input.policy || {},
        status: input.status || "active",
      } });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "browser_runtime_binding_upsert_failed"); }
  });

  router.post("/browser-runtime/policy-check", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await checkBrowserRuntimePolicyFromDb({
        binding_key: input.binding_key || input.bindingKey || null,
        runtime_key: input.runtime_key || input.runtimeKey || null,
        input: {
          ...input,
          target_url: input.target_url || input.targetUrl || input.url,
          explicit_approval: bool(input.explicit_approval ?? input.explicitApproval ?? input.approved),
          session_reuse_approved: bool(input.session_reuse_approved ?? input.sessionReuseApproved),
        },
      });
      return res.status(result.ok ? 200 : 403).json(result);
    } catch (err) { return errorResponse(res, err, "browser_runtime_policy_check_failed"); }
  });

  router.post("/browser-runtime/extract-data", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await createBrowserDataExtractionJob({ input });
      return res.status(result.ok ? 202 : 403).json(result);
    } catch (err) { return errorResponse(res, err, "browser_runtime_extract_data_failed"); }
  });

  router.post("/browser-runtime/inspect-site", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await createBrowserSiteInspectionRun({ input });
      return res.status(result.ok ? 202 : 403).json(result);
    } catch (err) { return errorResponse(res, err, "browser_runtime_inspect_site_failed"); }
  });

  return router;
}

export const _testingBrowserRuntimeRoutes = { bool, boundedInt };
