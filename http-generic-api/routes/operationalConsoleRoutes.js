import { Router } from "express";
import {
  buildOperationalConsole,
  readOperationalConsoleEvidence,
} from "../operationalConsoleService.js";
import { listRemoteRuntimeTargets } from "../remoteRuntime.js";

function parseQuery(req) {
  return {
    environment_key: req.query.environment_key || req.query.environmentKey || "production",
    tile_limit: req.query.tile_limit || req.query.limit,
    evidence_limit: req.query.evidence_limit,
    surface: req.query.surface,
    cursor: req.query.cursor,
  };
}

function queryBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || ["true", "1", "yes"].includes(String(value).trim().toLowerCase());
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
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

  router.get("/platform/remote-runtime/targets/catalog-readonly", ...guards, async (req, res, next) => {
    try {
      const result = await listRemoteRuntimeTargets({
        tenantId: req.query.tenant_id || null,
        userId: req.query.user_id || null,
        targetKind: req.query.target_kind || null,
        providerFamily: req.query.provider_family || null,
        status: req.query.status || null,
        includeCommands: queryBool(req.query.include_commands, true),
        limit: boundedInt(req.query.limit, 100, 1, 250),
      });
      res.status(200).json({ ...result, secrets_included: false });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
