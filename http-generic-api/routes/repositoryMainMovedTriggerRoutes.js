import { Router } from "express";
import {
  createRepositoryMainMovedTriggerEvent,
  getRepositoryMainMovedTriggerEvent,
} from "../repositoryMainMovedTriggerService.js";
import {
  handleGitHubRepositoryMainMovedWebhook,
  verifyGitHubRepositoryMainMovedWebhookRequest,
} from "../githubRepositoryMainMovedWebhookService.js";

function actorFromRequest(req) {
  return {
    user_id: req.user?.user_id || req.user?.id || req.auth?.user_id || null,
    email: req.user?.email || req.auth?.email || null,
    mode: "repository_main_moved_trigger_route",
  };
}

function sendError(res, error) {
  return res.status(Number(error?.status) || 500).json({
    error: {
      code: error?.code || "repository_main_moved_trigger_internal_error",
      message: error?.message || "Repository main movement coordination failed.",
      details: error?.details || undefined,
      requestId: res.getHeader?.("x-request-id") || undefined,
    },
  });
}

export function createGitHubRepositoryMainMovedWebhookSignatureGuard(deps = {}) {
  return async function requireGitHubWebhookSignature(req, res, next) {
    try {
      req.githubWebhookSignatureVerification = await verifyGitHubRepositoryMainMovedWebhookRequest({
        headers: req.headers || {},
        rawBody: req.rawBody,
      }, deps);
      return next();
    } catch (error) {
      return sendError(res, error);
    }
  };
}

export function buildRepositoryMainMovedTriggerRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
} = {}) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post("/webhooks/github/repository-main-moved", async (req, res) => {
    try {
      const result = await handleGitHubRepositoryMainMovedWebhook({
        headers: req.headers || {},
        body: req.body || {},
        rawBody: req.rawBody,
      });
      return res.status(result.event_type === "ping" || result.deduplicated ? 200 : 201).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.post("/admin/repository-main-moved-events", ...guards, async (req, res) => {
    try {
      const result = await createRepositoryMainMovedTriggerEvent(req.body || {}, actorFromRequest(req));
      return res.status(result.deduplicated ? 200 : 201).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  });

  router.get("/admin/repository-main-moved-events/:triggerEventId", ...guards, async (req, res) => {
    try {
      return res.status(200).json(await getRepositoryMainMovedTriggerEvent(req.params.triggerEventId));
    } catch (error) {
      return sendError(res, error);
    }
  });

  return router;
}
