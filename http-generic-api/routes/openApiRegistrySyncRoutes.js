import express from "express";
import {
  getOpenApiEndpointInventorySyncStatus,
  syncOpenApiEndpointInventory,
} from "../openApiEndpointInventorySync.js";

function requestId(req) {
  return String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || "").trim() || null;
}

function errorResponse(req, res, error) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    ok: false,
    error: {
      code: error?.code || "openapi_endpoint_inventory_sync_failed",
      message: status >= 500 ? "OpenAPI endpoint inventory sync failed." : String(error?.message || error),
      details: error?.details || undefined,
      requestId: requestId(req),
    },
    secrets_included: false,
  });
}

function assertAllowedKeys(body = {}, allowed = new Set()) {
  const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key));
  if (!unknown.length) return;
  const error = new Error("Request contains unsupported fields.");
  error.status = 400;
  error.code = "validation_error";
  error.details = unknown.map((field) => ({ field, issue: "unsupported" }));
  throw error;
}

export function buildOpenApiRegistrySyncRoutes(deps = {}) {
  const router = express.Router();
  const requireBackendApiKey = deps.requireBackendApiKey || ((_req, _res, next) => next());
  const requireAdminPrincipal = deps.requireAdminPrincipal || ((_req, _res, next) => next());
  const guards = [requireBackendApiKey, requireAdminPrincipal];

  router.get("/admin/openapi-registry-sync/status", ...guards, async (req, res) => {
    try {
      const result = await getOpenApiEndpointInventorySyncStatus();
      return res.json(result);
    } catch (error) {
      return errorResponse(req, res, error);
    }
  });

  router.post("/admin/openapi-registry-sync", ...guards, async (req, res) => {
    try {
      assertAllowedKeys(req.body, new Set(["mode", "confirm", "capability_envelope_id"]));
      const result = await syncOpenApiEndpointInventory({
        mode: req.body?.mode || "dry_run",
        confirm: req.body?.confirm,
        capability_envelope_id: req.body?.capability_envelope_id,
        trigger_source: "admin_tool",
      }, { auth: req.auth || {} });
      return res.status(result.applied ? 201 : 200).json(result);
    } catch (error) {
      return errorResponse(req, res, error);
    }
  });

  return router;
}

export const _testingOpenApiRegistrySyncRoutes = { assertAllowedKeys, errorResponse };
