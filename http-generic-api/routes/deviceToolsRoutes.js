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

export function buildDeviceToolsRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

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
