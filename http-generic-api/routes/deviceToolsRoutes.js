/**
 * Device Tools MCP Facade — Sprint 56
 *
 * GET  /device/tools         — list device-tagged tools for the current principal
 * POST /device/tools/call    — dispatch a device-tagged tool by name
 *
 * This is a thin MCP-style namespace over the existing /gpt/tools dispatcher.
 * It filters the admin/tenant tool catalog to rows tagged 'device' so an admin
 * GPT (or any MCP client) can attach a single schema dedicated to local-device
 * control without seeing every admin operation.
 *
 * Device tools live in the same admin_platform_endpoint_tools and
 * tenant_platform_endpoint_tools tables. Dispatch reuses gptToolsRoutes so
 * audit, scope-grant resolution, and grant_dispatch logging all keep working.
 */

import { Router } from "express";
import { getPool } from "../db.js";
import { adminConnectorInventory } from "../adminLocalConnectorTarget.js";
import {
  resolveCallerTypeForRequest,
  fetchToolsForCaller,
  dispatchToolForCaller,
} from "./gptToolsRoutes.js";
import {
  resolveRuntimeRecoverySourceMode,
} from "../runtimeRecoverySnapshot.js";

function isDeviceTagged(tool) {
  const tags = Array.isArray(tool?.tags) ? tool.tags : [];
  return tags.some((tag) => String(tag).trim().toLowerCase() === "device");
}

export function deviceToolsDiagnostics(catalogSourceMode, count) {
  const sqlCatalog = catalogSourceMode === "sql";
  const hasDeviceTools = Number(count) > 0;
  return {
    catalog_source: sqlCatalog ? "sql_registry" : "runtime_recovery_snapshot",
    dispatch_available: sqlCatalog && hasDeviceTools,
    reason_code: hasDeviceTools
      ? null
      : sqlCatalog
        ? "device_tool_projection_empty"
        : "runtime_recovery_snapshot_read_only",
  };
}

// Only identity claims verified by the signed user-JWT middleware can select
// a tenant device inventory. Never take a principal from query/body/API key.
export function signedDeviceRegistryScope(req = {}) {
  const auth = req.auth || {};
  if (auth.mode !== "user_jwt" ||
      typeof auth.user_id !== "string" || !auth.user_id.trim() ||
      typeof auth.tenant_id !== "string" || !auth.tenant_id.trim()) return null;
  return { user_id: auth.user_id.trim(), tenant_id: auth.tenant_id.trim() };
}

export function buildDeviceToolsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // Credential-free multi-device discovery ONLY. Device execution still
  // requires a separate exact-device grant and live heartbeat verification.
  router.get("/device/tools/devices", requireBackendApiKey, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const scope = signedDeviceRegistryScope(req);
    if (!scope) return res.status(403).json({
      ok: false, error: { code: "signed_device_scope_required",
        message: "Signed user and tenant identity is required." },
      secrets_included: false,
    });
    try {
      const inventory = await adminConnectorInventory({ pool: getPool(), scope });
      return res.status(200).json({
        ...inventory, discovery_only: true, execution_allowed: false,
        explicit_device_selection_required: inventory.devices.filter(
          item => item.state === "ACTIVE").length !== 1,
        secrets_included: false,
      });
    } catch (error) {
      return res.status(error.status || 503).json({
        ok: false, error: { code: error.code || "device_inventory_unavailable",
          message: "Device inventory is unavailable for this signed principal." },
        secrets_included: false,
      });
    }
  });

  router.get("/device/tools", requireBackendApiKey, async (req, res) => {
    try {
      const callerType = resolveCallerTypeForRequest(req);
      const catalogSourceMode = resolveRuntimeRecoverySourceMode();
      const allTools = await fetchToolsForCaller(callerType);
      const deviceTools = allTools.filter(isDeviceTagged);
      const diagnostics = deviceToolsDiagnostics(catalogSourceMode, deviceTools.length);
      return res.status(200).json({
        ok: true,
        protocol: "openapi-mcp-facade",
        surface: "device",
        caller_type: callerType,
        ...diagnostics,
        count: deviceTools.length,
        tools: deviceTools,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "device_tools_list_failed", message: err.message } });
    }
  });

  router.post("/device/tools/call", requireBackendApiKey, async (req, res) => {
    try {
      const body = req.body || {};
      const args = body.tool_args ?? body.arguments ?? {};
      const { name } = body;
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_name", message: "name is required." } });
      }

      const callerType = resolveCallerTypeForRequest(req);
      const allTools = await fetchToolsForCaller(callerType);
      const tool = allTools.find((t) => t.name === name);
      if (!tool) {
        return res.status(404).json({
          ok: false,
          error: { code: "tool_not_found", message: `Tool '${name}' not found in the device-tools surface.` },
        });
      }
      if (!isDeviceTagged(tool)) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "tool_not_in_device_surface",
            message: `Tool '${name}' is not tagged 'device'. Use /gpt/tools/call for non-device tools.`,
            details: { tags: tool.tags || [] },
          },
        });
      }

      const result = await dispatchToolForCaller(callerType, name, args, req);
      return res.status(result.status).json(result.body);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "device_tool_call_failed", message: err.message },
      });
    }
  });

  return router;
}
