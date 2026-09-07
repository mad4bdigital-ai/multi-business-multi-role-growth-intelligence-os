import { Router } from "express";
import { SYSTEM_LAYER_TOOLS } from "./systemLayerRoutes.js";
import {
  STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
  buildStagingRecoverySystemTools,
  isStagingRecoverySystemEnvironment,
  stagingRecoveryAccessRepairApprove,
  stagingRecoveryAccessRepairPrepare,
  stagingRecoveryCertificationCanaryPlanCreate,
  stagingRecoverySystemSurfaceReadiness,
} from "../stagingRecoverySystemTools.js";
import {
  issueAndExecuteApprovedRecoveryStep,
  sanitizeRecoveryActionBridgeOutput,
} from "../recoveryActionBridge.js";

export const RECOVERY_SYSTEM_TOOL_OVERLAY_CONTRACT = "mad4b.recovery-system-tool-overlay.v1";

const BRIDGE_TOOL_NAME = "recovery_kernel_execute_approved_step";
const STAGING_TOOL_NAMES = new Set([
  "staging_recovery_certification_canary_plan_create",
  "staging_recovery_access_repair_prepare",
  "staging_recovery_access_repair_approve",
  "staging_recovery_system_surface_readiness",
]);
const BRIDGE_ALLOWED_KEYS = new Set([
  "plan_id",
  "plan_hash",
  "step_id",
  "approval_token",
  "approval_id",
  "expected_sha",
  "typed_confirmation",
  "idempotency_key",
]);

function bridgeDescriptor() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["plan_id", "plan_hash", "step_id", "idempotency_key"],
    properties: {
      plan_id: { type: "string", pattern: "^plan:[0-9a-f]{16,64}$" },
      plan_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
      step_id: { type: "string", pattern: "^step:[0-9a-f]{16,64}$" },
      approval_token: {
        type: "string",
        minLength: 16,
        maxLength: 512,
        description: "Legacy private compatibility transport. Production Admin GPT should prefer approval_id + expected_sha + typed_confirmation so approval material remains server-resolved.",
      },
      approval_id: { type: "string", pattern: "^approval:[0-9a-f]{16,64}$" },
      expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },
      typed_confirmation: { type: "string", minLength: 32, maxLength: 512 },
      idempotency_key: { type: "string", minLength: 8, maxLength: 160 },
    },
  };
}

export function synchronizeRecoverySystemToolDescriptors(env = process.env) {
  const bridge = SYSTEM_LAYER_TOOLS.find((tool) => tool?.name === BRIDGE_TOOL_NAME);
  if (!bridge) {
    throw Object.assign(new Error("Recovery Action bridge descriptor is missing from the System Layer."), {
      status: 500,
      code: "RECOVERY_SYSTEM_TOOL_BRIDGE_DESCRIPTOR_MISSING",
    });
  }
  bridge.description = "Private principal-scoped Admin Recovery bridge v2. Accepts immutable plan/step/idempotency references plus either legacy approval transport or server-managed approval_id, exact expected_sha, and typed_confirmation. Approval material and execution tickets are resolved/issued server-side; ticket IDs, hashes, signatures, credentials, SQL, migration selection, and provider controls are never caller-controlled or returned.";
  bridge.inputSchema = bridgeDescriptor();

  for (let index = SYSTEM_LAYER_TOOLS.length - 1; index >= 0; index -= 1) {
    if (SYSTEM_LAYER_TOOLS[index]?.source_key === STAGING_RECOVERY_SYSTEM_SOURCE_KEY) {
      SYSTEM_LAYER_TOOLS.splice(index, 1);
    }
  }
  if (isStagingRecoverySystemEnvironment(env)) {
    SYSTEM_LAYER_TOOLS.push(...buildStagingRecoverySystemTools(env));
  }
  return {
    bridge_v2: true,
    staging_advertised: isStagingRecoverySystemEnvironment(env),
    staging_tool_count: SYSTEM_LAYER_TOOLS.filter((tool) => tool?.source_key === STAGING_RECOVERY_SYSTEM_SOURCE_KEY).length,
    secrets_included: false,
  };
}

function toolArgs(req) {
  return req.body?.tool_args && typeof req.body.tool_args === "object" && !Array.isArray(req.body.tool_args)
    ? req.body.tool_args
    : (req.body?.arguments && typeof req.body.arguments === "object" && !Array.isArray(req.body.arguments) ? req.body.arguments : {});
}

function sendError(res, error) {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    error: {
      code: error?.code || "recovery_system_tool_overlay_failed",
      message: error?.message || "Recovery System Tool overlay failed closed.",
      ...(error?.details !== undefined ? { details: error.details } : {}),
    },
    secrets_included: false,
  });
}

function requireAdmin(req, res, next) {
  if (req.auth?.is_admin === true) return next();
  return res.status(403).json({
    ok: false,
    error: { code: "admin_system_tool_required", message: "This system-layer tool requires an admin/service principal." },
    secrets_included: false,
  });
}

function validateBridgeArgs(args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw Object.assign(new Error("recovery_kernel_execute_approved_step requires a JSON object."), {
      status: 400,
      code: "recovery_kernel_execute_approved_step_input_invalid",
    });
  }
  const unexpected = Object.keys(args).filter((key) => !BRIDGE_ALLOWED_KEYS.has(key));
  if (unexpected.length) {
    throw Object.assign(new Error("Recovery Action bridge v2 accepts only immutable plan/step/idempotency references and bounded approval confirmation fields; execution tickets remain server-issued."), {
      status: 400,
      code: "recovery_kernel_execute_approved_step_field_forbidden",
      details: { fields: unexpected, secrets_included: false },
    });
  }
  return args;
}

async function executeOverlayTool(name, args, deps = {}) {
  const runtimeEnv = deps.recoveryKernelEnv || deps.env || process.env;
  if (STAGING_TOOL_NAMES.has(name)) {
    if (!isStagingRecoverySystemEnvironment(runtimeEnv)) {
      throw Object.assign(new Error("Staging Recovery System Tools are not available outside Staging."), {
        status: 404,
        code: "STAGING_RECOVERY_SYSTEM_SURFACE_UNAVAILABLE",
        details: { production_authority: false, secrets_included: false },
      });
    }
    if (name === "staging_recovery_certification_canary_plan_create") return stagingRecoveryCertificationCanaryPlanCreate(args, { env: runtimeEnv });
    if (name === "staging_recovery_access_repair_prepare") return stagingRecoveryAccessRepairPrepare(args, { env: runtimeEnv });
    if (name === "staging_recovery_access_repair_approve") return stagingRecoveryAccessRepairApprove(args, { env: runtimeEnv });
    if (name === "staging_recovery_system_surface_readiness") return stagingRecoverySystemSurfaceReadiness(args, { env: runtimeEnv });
  }

  if (name === BRIDGE_TOOL_NAME) {
    const result = await issueAndExecuteApprovedRecoveryStep(validateBridgeArgs(args), {
      env: runtimeEnv,
      adminPrincipal: { verified: true, binding: "admin_guard_auth_context" },
      recoveryStore: deps.recoveryStore,
      executionTicketSigner: deps.executionTicketSigner,
      approvalIssuer: deps.approvalIssuer,
      approvalVerifier: deps.approvalVerifier,
      approvalStore: deps.approvalStore,
      recoveryLock: deps.recoveryLock,
      readbackVerifier: deps.readbackVerifier,
      deploymentIdentityProvider: deps.deploymentIdentityProvider,
      hostBreakglassMutationExecutor: deps.hostBreakglassMutationExecutor,
      migrationLedger: deps.migrationLedger,
    });
    return sanitizeRecoveryActionBridgeOutput(result);
  }

  return null;
}

export function buildRecoverySystemToolOverlayRoutes({
  env = process.env,
  recoveryKernelEnv = null,
  requireBackendApiKey,
  requireAdminPrincipal,
  recoveryStore,
  executionTicketSigner,
  approvalIssuer,
  approvalVerifier,
  approvalStore,
  recoveryLock,
  readbackVerifier,
  deploymentIdentityProvider,
  hostBreakglassMutationExecutor,
  migrationLedger,
} = {}) {
  if (typeof requireBackendApiKey !== "function" || typeof requireAdminPrincipal !== "function") {
    throw Object.assign(new Error("Recovery System Tool overlay requires backend and admin guards."), {
      status: 500,
      code: "RECOVERY_SYSTEM_TOOL_OVERLAY_GUARD_MISSING",
    });
  }
  synchronizeRecoverySystemToolDescriptors(recoveryKernelEnv || env);
  const router = Router({ caseSensitive: true, strict: true });
  const deps = {
    env,
    recoveryKernelEnv,
    recoveryStore,
    executionTicketSigner,
    approvalIssuer,
    approvalVerifier,
    approvalStore,
    recoveryLock,
    readbackVerifier,
    deploymentIdentityProvider,
    hostBreakglassMutationExecutor,
    migrationLedger,
  };

  const handler = async (req, res, next) => {
    const name = String(req.body?.name || "").trim();
    if (name !== BRIDGE_TOOL_NAME && !STAGING_TOOL_NAMES.has(name)) return next();
    try {
      const result = await executeOverlayTool(name, toolArgs(req), deps);
      return res.status(200).json(result);
    } catch (error) {
      return sendError(res, error);
    }
  };

  router.post("/system/tools/call", requireBackendApiKey, requireAdmin, handler);
  router.post("/admin/system/tools/call", requireBackendApiKey, requireAdminPrincipal, handler);
  return router;
}

export const _testingRecoverySystemToolOverlay = Object.freeze({
  BRIDGE_TOOL_NAME,
  STAGING_TOOL_NAMES,
  BRIDGE_ALLOWED_KEYS,
  bridgeDescriptor,
  validateBridgeArgs,
  executeOverlayTool,
});
