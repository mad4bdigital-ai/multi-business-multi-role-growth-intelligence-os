import { Router } from "express";
import {
  buildCapabilityMirrorPlan,
  buildInstallRequestPlan,
  buildReinstallDiffPlan,
  buildRepoIngestionPlan,
  buildSanitizedPackagePlan,
  buildVariantPatchPlan,
  buildVariantMergePlan,
  listCapabilityVaultPackages,
  resolveCapabilityRuntime,
  resolveGoogleFileReadDecision,
} from "../platformPrivateCapabilityVault.js";
import { recordRepoIngestionPlan } from "../platformCapabilityVaultRecordOnly.js";

function errorResponse(res, error, fallbackCode) {
  res.status(error.status || 500).json({
    ok: false,
    error: {
      code: error.code || fallbackCode,
      message: error.message,
    },
  });
}

export function buildPlatformPrivateCapabilityVaultRoutes(deps = {}) {
  const router = Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((_req, _res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((_req, _res, next) => next());
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal];

  router.get("/platform/capability-vault/packages", ...requireAdmin, async (req, res) => {
    try {
      const packages = await listCapabilityVaultPackages({
        status: req.query.status,
        limit: req.query.limit,
      }, deps);
      res.json({ ok: true, packages, dry_run: true, will_execute: false });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_package_list_failed");
    }
  });

  router.post("/platform/capability-vault/repo-ingestion-plan", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, plan: buildRepoIngestionPlan(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_repo_ingestion_plan_failed");
    }
  });
  router.post("/platform/capability-vault/repo-ingestion-record", ...requireAdmin, async (req, res) => {
    try {
      const result = await recordRepoIngestionPlan(req.body || {}, {
        ...deps,
        principal: {
          tenant_id: req.auth?.tenant_id || null,
          user_id: req.auth?.user_id || null,
          mode: req.auth?.mode || "backend_api_key",
        },
      });
      res.json({ ok: true, result });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_repo_ingestion_record_failed");
    }
  });

  router.post("/platform/capability-vault/mirror-plan", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, plan: buildCapabilityMirrorPlan(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_mirror_plan_failed");
    }
  });

  router.post("/platform/capability-vault/package-plan", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, plan: buildSanitizedPackagePlan(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_package_plan_failed");
    }
  });

  router.post("/platform/capability-vault/reinstall-diff-plan", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, plan: buildReinstallDiffPlan(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_reinstall_diff_plan_failed");
    }
  });

  router.post("/platform/capability-vault/variant-plan", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, plan: buildVariantPatchPlan(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_variant_plan_failed");
    }
  });

  router.post("/platform/capability-vault/install-request-plan", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, plan: buildInstallRequestPlan(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_install_request_plan_failed");
    }
  });

  router.post("/platform/capability-vault/variant-merge-plan", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, plan: buildVariantMergePlan(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_variant_merge_plan_failed");
    }
  });
  router.post("/platform/capability-vault/runtime-resolve", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, resolution: resolveCapabilityRuntime(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_runtime_resolve_failed");
    }
  });

  router.post("/platform/capability-vault/google-file-read/resolve", ...requireAdmin, (req, res) => {
    try {
      res.json({ ok: true, decision: resolveGoogleFileReadDecision(req.body || {}) });
    } catch (error) {
      errorResponse(res, error, "platform_capability_vault_google_file_read_resolve_failed");
    }
  });

  return router;
}

