import { Router } from "express";

export function buildJobRoutes(deps) {
  const { requireBackendApiKey, executionFacade, resolveRequestedBy } = deps;

  const router = Router();

  router.post("/site-migrate", requireBackendApiKey, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const requestedBy = resolveRequestedBy(req);
    const idempotencyKey = String(
      body.idempotency_key || req.header("Idempotency-Key") || ""
    ).trim();
    const { status, body: responseBody } = await executionFacade.submitSiteMigration(body, requestedBy, idempotencyKey);
    return res.status(status).json(responseBody);
  });

  router.post("/jobs", requireBackendApiKey, async (req, res) => {
    const requestedBy = resolveRequestedBy(req);
    const idempotencyKey = String(
      (req.body?.idempotency_key) || req.header("Idempotency-Key") || ""
    ).trim();
    const { status, body } = await executionFacade.submitJob(req.body, requestedBy, idempotencyKey);
    return res.status(status).json(body);
  });

  router.get("/jobs/:jobId", requireBackendApiKey, async (req, res) => {
    const { status, body } = await executionFacade.getJob(req.params.jobId);
    return res.status(status).json(body);
  });

  router.get("/jobs/:jobId/result", requireBackendApiKey, async (req, res) => {
    const { status, body } = await executionFacade.pollJobResult(req.params.jobId);
    return res.status(status).json(body);
  });

  return router;
}
