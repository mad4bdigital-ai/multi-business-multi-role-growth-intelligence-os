import { Router } from "express";
import jwt from "jsonwebtoken";
import {
  createResourceApiController,
  errorEnvelope,
} from "../src/api/resourceApi/resourceApiController.js";
import { createDefaultResourceApiService } from "../src/infrastructure/resourceApi/resourceApiComposition.js";
import { createResourceApiContextShadowMiddleware } from "../contextKernel/integration/index.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

function verifyJwt(header) {
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice(7), JWT_SECRET);
  } catch {
    return null;
  }
}

function requireUser(req, res, next) {
  const auth = req.auth?.mode === "user_jwt"
    ? req.auth
    : verifyJwt(req.headers.authorization);
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
  function tenantReadHandlers(handler) {
    if (contextKernelResourceShadow) return [requireUser, contextKernelResourceShadow, handler];
    return [requireUser, handler];
  }

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

  router.get("/me/workspaces/:tenant_id/resources", ...tenantReadHandlers(controller.tenantCatalog));
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey", ...tenantReadHandlers(controller.tenantResourcesList));
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId", ...tenantReadHandlers(controller.tenantResourceGet));
  router.post("/me/workspaces/:tenant_id/resources/:resourceKey", requireUser, controller.tenantResourceCreate);
  router.patch("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId", requireUser, controller.tenantResourceUpdate);
  router.delete("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId", requireUser, controller.tenantResourceArchive);
  router.post("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/restore", requireUser, controller.tenantResourceRestore);
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/permissions", requireUser, controller.tenantResourcePermissions);
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/revisions", requireUser, controller.tenantResourceRevisions);
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/changes", requireUser, controller.tenantResourceItemChanges);
  router.get("/me/workspaces/:tenant_id/resource-changes", requireUser, controller.tenantResourceChanges);
  router.get("/me/workspaces/:tenant_id/operations/:operationId", requireUser, controller.tenantOperationGet);

  router.get("/gpt/sessions", requireBackend, controller.sessionList);
  router.get("/gpt/sessions/:id", requireBackend, controller.sessionGet);
  router.get("/gpt/sessions/:id/turns", requireBackend, controller.sessionTurns);
  router.get("/gpt/sessions/:id/summary", requireBackend, controller.sessionSummary);
  router.get("/gpt/sessions/:id/events", requireBackend, controller.sessionEvents);
  router.get("/gpt/sessions/:id/transcript", requireBackend, controller.sessionTranscript);
  router.post("/gpt/sessions/:id/summary/generate", requireBackend, controller.sessionSummaryGenerate);

  return router;
}

export const _testingResourceApiRoutes = { verifyJwt, requireUser };
