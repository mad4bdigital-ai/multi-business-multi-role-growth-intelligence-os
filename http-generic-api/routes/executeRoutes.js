import { Router } from "express";

export function buildExecuteRoutes(deps) {
  const { requireBackendApiKey, executionFacade } = deps;

  const router = Router();

  router.post("/http-execute", requireBackendApiKey, async (req, res) => {
    const { status, body } = await executionFacade.execute(req.body);
    return res.status(status).json(body);
  });

  return router;
}
