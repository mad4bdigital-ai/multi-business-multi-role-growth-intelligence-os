// Canonical Recovery authority facade for the fixed System Layer bridge.
//
// Non-Recovery tools remain delegated to the existing system-layer core. Recovery tools
// are intercepted here so read-only evidence authority and consequential mutation/control
// authority are selected explicitly. Presence of a new dependency key is authoritative:
// an explicit null mutationRecoveryStore must never fall back to the legacy recoveryStore.
export * from "./systemLayerRoutesCore.js";

import { Router } from "express";
import * as Core from "./systemLayerRoutesCore.js";
import { requireAdminPrincipal } from "./adminCliRoutes.js";
import {
  maybeChunkToolResponseBody,
  shouldChunkDispatchedToolResponse,
} from "./gptToolsRoutes.js";

const FIXED_RECOVERY_SYSTEM_TOOLS = new Set([
  "recovery_kernel_call",
  "recovery_kernel_create_approval_challenge",
  "recovery_kernel_execute_approved_step",
]);

const CONTROL_CAPABILITIES_FORBIDDEN_ON_READ_BRIDGE = new Set([
  "approval_challenge_create",
  "ephemeral_capability_create",
  "remediation_step_execute",
  "host_breakglass_execute",
  "unsupported_capability_execute",
]);

export function resolveSystemRecoveryStores(deps = {}) {
  const hasExplicitReadOnly = Object.prototype.hasOwnProperty.call(deps, "readOnlyRecoveryStore");
  const hasExplicitMutation = Object.prototype.hasOwnProperty.call(deps, "mutationRecoveryStore");
  return Object.freeze({
    readOnlyRecoveryStore: hasExplicitReadOnly
      ? (deps.readOnlyRecoveryStore ?? null)
      : (deps.recoveryStore ?? null),
    mutationRecoveryStore: hasExplicitMutation
      ? (deps.mutationRecoveryStore ?? null)
      : (deps.recoveryStore ?? null),
    explicit_read_only_boundary: hasExplicitReadOnly,
    explicit_mutation_boundary: hasExplicitMutation,
  });
}

function privateRecoverySurfaceError(capabilityKey) {
  const error = new Error("Consequential Recovery control or execution is not available through the read-only fixed Admin System Tool bridge.");
  error.status = 404;
  error.code = "recovery_kernel_private_surface_required";
  error.details = {
    capability_key: capabilityKey,
    required_surface: "recovery_kernel_create_approval_challenge_or_execute_approved_step",
    secrets_included: false,
  };
  return error;
}

export async function callSystemLayerTool(name, args = {}, auth = null, deps = {}) {
  const stores = resolveSystemRecoveryStores(deps);

  if (name === "recovery_kernel_call") {
    const capabilityKey = String(args?.capability_key || "").trim();
    if (CONTROL_CAPABILITIES_FORBIDDEN_ON_READ_BRIDGE.has(capabilityKey)) {
      throw privateRecoverySurfaceError(capabilityKey);
    }
    return Core.callSystemLayerTool(name, args, auth, {
      ...deps,
      recoveryStore: stores.readOnlyRecoveryStore,
    });
  }

  if (name === "recovery_kernel_create_approval_challenge" || name === "recovery_kernel_execute_approved_step") {
    return Core.callSystemLayerTool(name, args, auth, {
      ...deps,
      recoveryStore: stores.mutationRecoveryStore,
    });
  }

  return Core.callSystemLayerTool(name, args, auth, deps);
}

function toolArgs(req) {
  return req.body?.tool_args && typeof req.body.tool_args === "object"
    ? req.body.tool_args
    : (req.body?.arguments && typeof req.body.arguments === "object" ? req.body.arguments : {});
}

function sendBridgeError(res, error) {
  return res.status(error?.status || 500).json({
    ok: false,
    error: {
      code: error?.code || "system_tool_call_failed",
      message: error?.message || "System tool call failed.",
      ...(error?.details !== undefined ? { details: error.details } : {}),
    },
    secrets_included: false,
  });
}

async function sendBridgeResult(res, name, args, auth, result, sourceSurface) {
  if (!shouldChunkDispatchedToolResponse(name, result)) return res.status(200).json(result);
  try {
    const responseOptions = args?.response_options && typeof args.response_options === "object"
      ? args.response_options
      : {};
    const body = await maybeChunkToolResponseBody(
      { ok: true, name, result, secrets_included: false },
      {
        response_options: {
          max_chars: Number(responseOptions.max_chars || args?.max_chars || 45000),
          cursor: Number(responseOptions.cursor || args?.cursor || 0),
          chunk_ttl_ms: Number(responseOptions.chunk_ttl_ms || args?.chunk_ttl_ms || 0) || undefined,
          chunk_ttl_minutes: Number(responseOptions.chunk_ttl_minutes || args?.chunk_ttl_minutes || 0) || undefined,
        },
        auth,
        source_tool_key: name,
        source_surface: sourceSurface,
      },
    );
    return res.status(200).json(body);
  } catch (error) {
    const { buildBoundedInlineChunkFallback } = await import("../systemLayerResponseFallback.js");
    return res.status(200).json(buildBoundedInlineChunkFallback(
      { ok: true, name, result, secrets_included: false },
      error,
      { sourceToolKey: name, maxChars: 150000 },
    ));
  }
}

function fixedRecoveryBridgeHandler(deps, sourceSurface) {
  return async (req, res, next) => {
    const name = String(req.body?.name || "").trim();
    if (!FIXED_RECOVERY_SYSTEM_TOOLS.has(name)) return next();
    try {
      const args = toolArgs(req);
      const result = await callSystemLayerTool(name, args, req.auth, deps);
      return await sendBridgeResult(res, name, args, req.auth, result, sourceSurface);
    } catch (error) {
      return sendBridgeError(res, error);
    }
  };
}

export function buildSystemLayerRoutes(deps = {}) {
  const router = Router();
  const requireBackendApiKey = deps.requireBackendApiKey;
  const authenticated = [requireBackendApiKey].filter((value) => typeof value === "function");
  const adminOnly = [requireBackendApiKey, requireAdminPrincipal].filter((value) => typeof value === "function");

  // These handlers run before the core router and only claim the three fixed Recovery
  // bridge tools. Every unrelated system-layer route remains owned by the existing core.
  router.post(
    "/system/tools/call",
    ...authenticated,
    fixedRecoveryBridgeHandler(deps, "system_tools_call"),
  );
  router.post(
    "/admin/system/tools/call",
    ...adminOnly,
    fixedRecoveryBridgeHandler(deps, "admin_system_tools_call"),
  );

  router.use(Core.buildSystemLayerRoutes(deps));
  return router;
}

export const systemLayerRecoveryAuthorityFacadeInternals = Object.freeze({
  FIXED_RECOVERY_SYSTEM_TOOLS,
  CONTROL_CAPABILITIES_FORBIDDEN_ON_READ_BRIDGE,
});
