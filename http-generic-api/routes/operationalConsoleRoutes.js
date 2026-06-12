import { Router } from "express";
import {
  buildOperationalConsole,
  readOperationalConsoleEvidence,
} from "../operationalConsoleService.js";

function parseQuery(req) {
  return {
    environment_key: req.query.environment_key || req.query.environmentKey || "production",
    tile_limit: req.query.tile_limit || req.query.limit,
    evidence_limit: req.query.evidence_limit,
    surface: req.query.surface,
    cursor: req.query.cursor,
  };
}

export function buildOperationalConsoleRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/operational/console", ...guards, async (req, res, next) => {
    try {
      const consolePayload = await buildOperationalConsole(parseQuery(req));
      res.status(200).json(consolePayload);
    } catch (error) {
      next(error);
    }
  });

  router.get("/operational/console/evidence", ...guards, async (req, res, next) => {
    try {
      const evidence = await readOperationalConsoleEvidence(parseQuery(req));
      res.status(200).json(evidence);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
