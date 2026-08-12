import { Router } from "express";
import { createUserJwtMiddleware } from "../userJwtAuth.js";
import {
  createResourceApiController,
  errorEnvelope,
} from "../src/api/resourceApi/resourceApiController.js";
import { createDefaultResourceApiService } from "../src/infrastructure/resourceApi/resourceApiComposition.js";
import { createResourceApiContextShadowMiddleware } from "../contextKernel/integration/index.js";
import { materializeWorkspaceBrandCoreAssetTransaction } from "../workspaceBrandCoreAssetMaterialization.js";

const requireUserJwt = createUserJwtMiddleware();

function requireUser(req, res, next) {
  const auth = req.auth?.mode === "user_jwt" ? req.auth : null;
  if (!auth?.user_id) {
    return res.status(401).json(errorEnvelope("user_jwt_required", "Sign in required."));
  }
  req.auth = {
    mode: "user_jwt",
    user_id: auth.user_id,
    tenant_id: auth.tenant_id || null,
    is_admin: false,
  };
  return next();
}

export function buildResourceApiRoutes(deps = {}) {
  const router = Router();
  const requireBackend = deps.requireBackendApiKey || ((req, res, next) => next());
  const requireAdmin = deps.requireAdminPrincipal || ((req, res, next) => next());
  const service = deps.resourceApiService || createDefaultResourceApiService(deps);
  const controller = deps.resourceApiController || createResourceApiController({ service });
  const contextKernelResourceShadow = typeof deps.contextKernelResourceShadowMiddleware === "function"
    ? deps.contextKernelResourceShadowMiddleware
    : deps.contextKernelShadow
      ? createResourceApiContextShadowMiddleware(deps.contextKernelShadow)
      : null;
  const tenantReadHandlers = (handler) => contextKernelResourceShadow
    ? [requireUserJwt, requireUser, contextKernelResourceShadow, handler]
    : [requireUserJwt, requireUser, handler];

  router.get("/admin/resource-types", requireBackend, requireAdmin, controller.adminResourceTypes);
  router.get("/admin/resource-types/:resourceKey", requireBackend, requireAdmin, controller.adminResourceType);
  router.get("/admin/resources/:resourceKey", requireBackend, requireAdmin, controller.adminResourcesList);
  router.get("/admin/resources/:resourceKey/:resourceId", requireBackend, requireAdmin, controller.adminResourceGet);
  router.post("/admin/resources/:resourceKey", requireBackend, requireAdmin, controller.adminResourceCreate);
  router.patch("/admin/resources/:resourceKey/:resourceId", requireBackend, requireAdmin, controller.adminResourceUpdate);
  router.delete("/admin/resources/:resourceKey/:resourceId", requireBackend, requireAdmin, controller.adminResourceArchive);
  router.post("/admin/resources/:resourceKey/:resourceId/restore", requireBackend, requireAdmin, controller.adminResourceRestore);
  router.post("/admin/resources/:resourceKey/:resourceId/purge", requireBackend, requireAdmin, controller.adminResourcePurge);
  router.get("/admin/resources/:resourceKey/:resourceId/permissions", requireBackend, requireAdmin, controller.adminResourcePermissions);
  router.get("/admin/resources/:resourceKey/:resourceId/revisions", requireBackend, requireAdmin, controller.adminResourceRevisions);
  router.get("/admin/resources/:resourceKey/:resourceId/changes", requireBackend, requireAdmin, controller.adminResourceItemChanges);
  router.get("/admin/resource-changes", requireBackend, requireAdmin, controller.adminResourceChanges);
  router.get("/admin/resource-coverage/audit", requireBackend, requireAdmin, controller.adminCoverageAudit);
  router.get("/admin/operations/:operationId", requireBackend, requireAdmin, controller.adminOperationGet);

  // Keep canonical route/auth visible here; transaction orchestration stays outside transport.
  router.post("/me/workspaces/:workspace_id/brands/:brand_key/assets/materialize-brand-core", requireUserJwt, async (req, res) => {
    try {
      const result = await materializeWorkspaceBrandCoreAssetTransaction({
        workspaceId: req.params.workspace_id,
        actorUserId: req.auth.user_id,
        brandRef: req.params.brand_key,
        sourceRef: req.body?.source_ref,
      });
      return res.status(201).json({
        ok: true,
        tenant_id: result.tenant_id,
        workspace_id: result.workspace.workspace_id,
        brand_key: result.workspace.brand_ref,
        asset: result.asset,
        source: result.source,
        workspace: result.workspace,
        readback: "same_cycle",
        secrets_included: false,
      });
    } catch (error) {
      return res.status(error?.status || 500).json({
        ok: false,
        error: { code: error?.code || "brand_core_asset_materialize_failed", message: error?.message || "Brand Core asset materialization failed.", ...(error?.details ? { details: error.details } : {}) },
        secrets_included: false,
      });
    }
  });

  router.get("/me/workspaces/:tenant_id/resources", ...tenantReadHandlers(controller.tenantCatalog));
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey", ...tenantReadHandlers(controller.tenantResourcesList));
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId", ...tenantReadHandlers(controller.tenantResourceGet));
  router.post("/me/workspaces/:tenant_id/resources/:resourceKey", requireUserJwt, requireUser, controller.tenantResourceCreate);
  router.patch("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId", requireUserJwt, requireUser, controller.tenantResourceUpdate);
  router.delete("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId", requireUserJwt, requireUser, controller.tenantResourceArchive);
  router.post("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/restore", requireUserJwt, requireUser, controller.tenantResourceRestore);
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/permissions", requireUserJwt, requireUser, controller.tenantResourcePermissions);
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/revisions", requireUserJwt, requireUser, controller.tenantResourceRevisions);
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/changes", requireUserJwt, requireUser, controller.tenantResourceItemChanges);
  router.get("/me/workspaces/:tenant_id/resource-changes", requireUserJwt, requireUser, controller.tenantResourceChanges);
  router.get("/me/workspaces/:tenant_id/operations/:operationId", requireUserJwt, requireUser, controller.tenantOperationGet);

  router.get("/gpt/sessions", requireBackend, controller.sessionList);
  router.get("/gpt/sessions/:id", requireBackend, controller.sessionGet);
  router.get("/gpt/sessions/:id/turns", requireBackend, controller.sessionTurns);
  router.get("/gpt/sessions/:id/summary", requireBackend, controller.sessionSummary);
  router.get("/gpt/sessions/:id/events", requireBackend, controller.sessionEvents);
  router.get("/gpt/sessions/:id/transcript", requireBackend, controller.sessionTranscript);
  router.post("/gpt/sessions/:id/summary/generate", requireBackend, controller.sessionSummaryGenerate);

  return router;
}

export const _testingResourceApiRoutes = { requireUser, requireUserJwt };
