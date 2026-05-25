import { Router } from "express";
import { loadPlatformPluginCatalog } from "../platformPluginCatalog.js";
import { resolvePlatformPluginExecution } from "../platformPluginResolver.js";
import { upsertPlatformPluginPolicy } from "../platformPluginPolicy.js";

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function buildPlatformPluginRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/platform/plugins/catalog", ...requireAdmin, async (req, res) => {
    try {
      const result = await loadPlatformPluginCatalog({
        tenantId: req.query.tenant_id || null,
        userId: req.query.user_id || null,
        includeInactive: bool(req.query.include_inactive),
        includeBindings: req.query.include_bindings === undefined ? true : bool(req.query.include_bindings),
        limit: boundedInt(req.query.limit, 100, 1, 250),
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "platform_plugin_catalog_failed",
          message: err.message,
        },
        secrets_included: false,
      });
    }
  });

  router.post("/platform/plugins/resolve", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await resolvePlatformPluginExecution({
        pluginKey: input.plugin_key || input.pluginKey,
        actionKey: input.action_key || input.actionKey || null,
        toolKey: input.tool_key || input.toolKey || null,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        agentId: input.agent_id || input.agentId || null,
        requestedCredentialScope: input.requested_credential_scope || input.requestedCredentialScope || null,
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: {
          code: err.code || "platform_plugin_resolve_failed",
          message: err.message,
        },
        secrets_included: false,
      });
    }
  });

  return router;
}
