import { Router } from "express";
import { SYSTEM_LAYER_TOOLS } from "./systemLayerRoutes.js";
import { getRecoveryCapabilities } from "../recoveryKernel.js";
import {
  STAGING_RECOVERY_SYSTEM_SOURCE_KEY,
  buildStagingRecoverySystemTools,
  isStagingRecoverySystemEnvironment,
  stagingRecoveryAccessRepairApprove,
  stagingRecoveryAccessRepairExecute,
  stagingRecoveryAccessRepairPrepare,
  stagingRecoveryCertificationCanaryPlanCreate,
  stagingRecoverySystemSurfaceReadiness,
} from "../stagingRecoverySystemTools.js";
import {
  buildStagingSchemaRepairSystemTools,
  stagingRecoverySchemaRepairApprove,
  stagingRecoverySchemaRepairExecute,
  stagingRecoverySchemaRepairPrepare,
} from "../stagingSchemaRepairSystemTools.js";
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
  "staging_recovery_access_repair_execute",
  "staging_recovery_schema_repair_prepare",
  "staging_recovery_schema_repair_approve",
  "staging_recovery_schema_repair_execute",
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
    SYSTEM_LAYER_TOOLS.push(...buildStagingRecoverySystemTools(env), ...buildStagingSchemaRepairSystemTools(env));
  }
  return {
    bridge_v2: true,
    staging_advertised: isStagingRecoverySystemEnvironment(env),
    staging_tool_count: SYSTEM_LAYER_TOOLS.filter((tool) => tool?.source_key === STAGING_RECOVERY_SYSTEM_SOURCE_KEY).length,
    secrets_included: false,
  };
}

function stagingExecutionDependenciesReady(deps = {}) {
  const executor = deps.hostBreakglassMutationExecutor;
  return Boolean(
    (typeof executor === "function" || typeof executor?.execute === "function")
    && typeof deps.recoveryLock?.acquire === "function"
    && typeof deps.readbackVerifier?.verify === "function"
    && deps.readbackVerifier?.independent_authority === true
    && deps.readbackVerifier?.role_aware === true
    && deps.readbackVerifier?.mutation_authority !== true
    && typeof deps.deploymentIdentityProvider?.readAttestation === "function"
    && typeof deps.recoveryStore?.getPlan === "function"
    && typeof deps.recoveryStore?.getExecutionTicket === "function"
  );
}

function stagingSchemaExecutionDependenciesReady(deps = {}) {
  const executor = deps.hostBreakglassMutationExecutor;
  return Boolean(
    (typeof executor === "function" || typeof executor?.execute === "function")
    && typeof deps.recoveryLock?.acquire === "function"
    && typeof deps.recoveryLock?.heartbeat === "function"
    && typeof deps.recoveryLock?.assertFence === "function"
    && typeof deps.recoveryLock?.release === "function"
    && typeof deps.readbackVerifier?.verify === "function"
    && deps.readbackVerifier?.independent_authority === true
    && deps.readbackVerifier?.role_aware === true
    && deps.readbackVerifier?.mutation_authority !== true
    && typeof deps.deploymentIdentityProvider?.readAttestation === "function"
    && typeof deps.recoveryStore?.getPlan === "function"
    && typeof deps.recoveryStore?.getExecutionTicket === "function"
    && typeof deps.recoveryStore?.reserveExecutionTicket === "function"
    && typeof deps.recoveryStore?.finalizeExecutionTicket === "function"
    && typeof deps.recoveryStore?.markApprovalUsed === "function"
    && typeof deps.migrationLedger?.finalize === "function"
  );
}

export function projectRecoveryCapabilitiesForSystemSurface(env = process.env, deps = {}) {
  const kernel = getRecoveryCapabilities({ env });
  if (!isStagingRecoverySystemEnvironment(env)) return kernel;
  const executionReady = stagingExecutionDependenciesReady(deps);
  const schemaExecutionReady = stagingSchemaExecutionDependenciesReady(deps);
  return {
    ...kernel,
    environment_view: "staging_bounded_control_plane",
    kernel_environment_view: kernel.environment_view,
    system_surface_contract: RECOVERY_SYSTEM_TOOL_OVERLAY_CONTRACT,
    system_surface_extensions: [
      {
        capability_key: "staging_certification_canary_plan_create",
        risk_class: "C1",
        state_scope: "durable_recovery_control_plane",
        target_database_mutation: false,
        provider_mutation: false,
        production_authority: false,
      },
      {
        capability_key: "staging_database_access_repair",
        risk_class: "C2",
        state_scope: executionReady ? "plan_approval_execute_readback" : "plan_approval_ticket_only",
        target_database_mutation: executionReady,
        provider_mutation: false,
        production_authority: false,
      },
      {
        capability_key: "staging_database_schema_repair",
        risk_class: "C3",
        state_scope: schemaExecutionReady ? "allowlist_plan_approval_execute_same_cycle_readback" : "allowlist_plan_approval_ticket_only",
        target_database_mutation: schemaExecutionReady,
        provider_mutation: false,
        production_authority: false,
        raw_sql_allowed: false,
        caller_database_allowed: false,
      },
    ],
    control_plane_state_write_capabilities: ["staging_certification_canary_plan_create", "staging_database_access_repair", "staging_database_schema_repair"],
    target_database_mutation_capabilities: [
      ...(executionReady ? ["staging_database_access_repair"] : []),
      ...(schemaExecutionReady ? ["staging_database_schema_repair"] : []),
    ],
    production_authority: false,
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

  if (name === "recovery_kernel_capabilities") {
    return projectRecoveryCapabilitiesForSystemSurface(runtimeEnv, deps);
  }
  if (name === "recovery_kernel_call" && String(args?.capability_key || "").trim() === "recovery_capabilities") {
    return projectRecoveryCapabilitiesForSystemSurface(runtimeEnv, deps);
  }

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
    if (name === "staging_recovery_access_repair_execute") {
      if (!stagingExecutionDependenciesReady(deps)) throw Object.assign(new Error("Staging access-repair execution dependencies are incomplete."), { status: 503, code: "STAGING_RECOVERY_EXECUTION_UNAVAILABLE" });
      return stagingRecoveryAccessRepairExecute(args, { env: runtimeEnv, adapters: deps });
    }
    if (name === "staging_recovery_schema_repair_prepare") return stagingRecoverySchemaRepairPrepare(args, { env: runtimeEnv, adapters: deps });
    if (name === "staging_recovery_schema_repair_approve") return stagingRecoverySchemaRepairApprove(args, { env: runtimeEnv, adapters: deps });
    if (name === "staging_recovery_schema_repair_execute") {
      if (!stagingSchemaExecutionDependenciesReady(deps)) throw Object.assign(new Error("Staging schema-repair execution dependencies are incomplete."), { status: 503, code: "STAGING_SCHEMA_REPAIR_EXECUTION_UNAVAILABLE" });
      return stagingRecoverySchemaRepairExecute(args, { env: runtimeEnv, adapters: deps });
    }
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
    const args = toolArgs(req);
    const capabilityProjection = name === "recovery_kernel_capabilities"
      || (name === "recovery_kernel_call" && String(args?.capability_key || "").trim() === "recovery_capabilities");
    if (name !== BRIDGE_TOOL_NAME && !STAGING_TOOL_NAMES.has(name) && !capabilityProjection) return next();
    try {
      const result = await executeOverlayTool(name, args, deps);
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
  stagingExecutionDependenciesReady,
  stagingSchemaExecutionDependenciesReady,
  executeOverlayTool,
});
