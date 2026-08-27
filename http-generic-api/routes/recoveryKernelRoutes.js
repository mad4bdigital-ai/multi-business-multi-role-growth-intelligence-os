import { Router } from "express";
import {
  assertApprovalChallengeAuthorities,
  callRecoveryKernelCapability,
  createApprovalChallenge,
  getRecoveryEvidence,
  getRecoveryRun,
  sanitizeEvidence,
} from "../recoveryKernel.js";
import { issueAndExecuteApprovedRecoveryStep, sanitizeRecoveryActionBridgeOutput } from "../recoveryActionBridge.js";

const READ_ONLY_CAPABILITIES = new Set([
  "production_identity",
  "recovery_manifest_get",
  "recovery_manifest",
  "recovery_trust_model",
  "recovery_trust",
  "runtime_attestation",
  "tool_surface_parity",
  "system_tool_get",
  "system_tools_search",
  "recovery_capabilities",
  "recovery_incident_create",
  "privileged_operation_preview",
  "privileged_lease_preview",
  "recovery_exception_preview",
  "recovery_reconciliation_preview",
  "recovery_cancel_preview",
  "recovery_evidence_chain_preview",
  "secret_observation",
  "production_activation_readiness",
  "production_activation_readiness_probe",
  "database_full_inspection",
  "production_host_local_database_inspect",
  "finding_details",
  "remediation_plan_create",
  "host_breakglass_plan",
  "remediation_plan_preview",
  "host_breakglass_preview",
  "approval_challenge_create",
  "remediation_step_verify",
  "host_breakglass_verify",
  "recovery_run_get",
  "host_breakglass_run_get",
  "recovery_evidence_get",
  "recovery_evidence_export",
  "unsupported_recovery_escalate",
  "ssh_session_preview",
  "sql_session_preview",
  "ephemeral_capability_create",
]);

function requestAdminPrincipal(req) {
  const verified = req?.auth?.is_admin === true;
  return { verified, binding: verified ? "admin_guard_request_auth" : "missing_admin_guard_binding" };
}

function errorResponse(res, error, fallbackCode = "recovery_kernel_failed") {
  return res.status(Number(error?.status || 500)).json({
    ok: false,
    contract: "mad4b.recovery-kernel-error.v1",
    error: {
      code: error?.code || fallbackCode,
      message: error?.message || "Recovery Kernel request failed.",
      ...(error?.details ? { details: sanitizeEvidence(error.details) } : {}),
    },
    database_mutation_performed: false,
    secrets_included: false,
  });
}

function assertProductionEnvironment(env = process.env) {
  const signals = [
    ["NODE_ENV", env.NODE_ENV],
    ["REMOTE_MCP_ENVIRONMENT", env.REMOTE_MCP_ENVIRONMENT],
    ["DEPLOYMENT_ENVIRONMENT", env.DEPLOYMENT_ENVIRONMENT],
    ["GITHUB_REF_NAME", env.GITHUB_REF_NAME],
  ].filter(([, value]) => String(value || "").trim());
  if (!signals.length) {
    const error = new Error("Recovery Kernel Production environment identity is unavailable.");
    error.status = 404;
    error.code = "recovery_kernel_production_environment_unavailable";
    throw error;
  }
  for (const [name, value] of signals) {
    const normalized = String(value).trim().toLowerCase();
    const production = name === "GITHUB_REF_NAME" ? normalized === "production" : ["production", "prod"].includes(normalized);
    if (!production) {
      const error = new Error("Recovery Kernel is restricted to the Production environment.");
      error.status = 404;
      error.code = "recovery_kernel_production_only";
      error.details = { signal: name, environment: normalized, secrets_included: false };
      throw error;
    }
  }
}

function assertObject(value, code = "recovery_kernel_request_invalid") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error("Recovery Kernel request must be a JSON object.");
    error.status = 400;
    error.code = code;
    throw error;
  }
  return value;
}

function assertExactKeys(value, allowed, required = []) {
  const input = assertObject(value);
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unexpected.length) {
    const error = new Error("Recovery Kernel request contains fields outside the fixed contract.");
    error.status = 400;
    error.code = "recovery_kernel_input_field_forbidden";
    error.details = { fields: unexpected, secrets_included: false };
    throw error;
  }
  const missing = required.filter((key) => input[key] === undefined || input[key] === null || input[key] === "");
  if (missing.length) {
    const error = new Error("Recovery Kernel request is missing required fields.");
    error.status = 400;
    error.code = "recovery_kernel_required_field_missing";
    error.details = { fields: missing, secrets_included: false };
    throw error;
  }
  return input;
}

export function buildRecoveryKernelRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  env = process.env,
  repoRoot,
  hostLocalInspectionExecutor,
  recoveryStore,
  approvalIssuer,
  approvalVerifier,
  approvalStore,
  recoveryLock,
  mutationExecutor,
  readbackVerifier,
  executionTicketSigner,
  deploymentIdentityProvider,
  hostBreakglassMutationExecutor,
  productionActivationReadinessExecutor,
  systemToolLookup,
} = {}) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter((value) => typeof value === "function");
  const fixedSystemToolLookup = systemToolLookup || (async (key, input = {}) => {
    const { SYSTEM_LAYER_TOOLS } = await import("./systemLayerRoutes.js");
    const { getSystemToolDescriptorByName, listSystemToolCatalog } = await import("../systemToolCatalogV2.js");
    if (key === "system_tool_get") {
      return getSystemToolDescriptorByName(SYSTEM_LAYER_TOOLS, input.tool_name);
    }
    return {
      ok: true,
      protocol: "openapi-mcp-facade",
      catalog_mode: "repository_static_system_layer",
      ...listSystemToolCatalog(SYSTEM_LAYER_TOOLS, { ...input, limit: Math.min(Number(input.limit || 20), 50) }),
      database_query_performed: false,
      secrets_included: false,
    };
  });
  if (guards.length !== 2) throw new Error("Recovery Kernel routes require backend-key and admin-principal guards.");
  router.use("/admin/recovery/kernel", ...guards);
  router.use("/admin/recovery/kernel", (_req, res, next) => {
    try {
      assertProductionEnvironment(env);
      return next();
    } catch (error) {
      return errorResponse(res, error, "recovery_kernel_production_only");
    }
  });

  router.post("/admin/recovery/kernel/call", async (req, res) => {
    try {
      const body = assertExactKeys(req.body || {}, ["capability_key", "input"], ["capability_key"]);
      const capabilityKey = String(body.capability_key || "").trim();
      if (!READ_ONLY_CAPABILITIES.has(capabilityKey)) {
        const error = new Error("The capability is not available on the read-only Recovery Kernel call surface.");
        error.status = 403;
        error.code = "recovery_kernel_mutation_surface_required";
        error.details = { capability_key: capabilityKey, execution_route: "/admin/recovery/kernel/execute", secrets_included: false };
        throw error;
      }
      const result = await callRecoveryKernelCapability(capabilityKey, body.input || {}, {
        env,
        repoRoot,
        hostLocalExecutor: hostLocalInspectionExecutor,
        recoveryStore,
        approvalIssuer,
        approvalVerifier,
        approvalStore,
        recoveryLock,
        mutationExecutor,
        readbackVerifier,
        executionTicketSigner,
        deploymentIdentityProvider,
        productionActivationReadinessExecutor,
        systemToolLookup: fixedSystemToolLookup,
        adminPrincipal: requestAdminPrincipal(req),
      });
      return res.status(200).json({ ok: true, contract: "mad4b.recovery-kernel-call-receipt.v1", capability_key: capabilityKey, result: sanitizeEvidence(result), database_mutation_performed: false, secrets_included: false });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  const executeApprovedBridge = async (req, res) => {
    try {
      const body = assertExactKeys(req.body || {}, ["plan_id", "plan_hash", "step_id", "approval_token", "idempotency_key"], ["plan_id", "plan_hash", "step_id", "approval_token", "idempotency_key"]);
      const result = await issueAndExecuteApprovedRecoveryStep(body, {
        env,
        adminPrincipal: requestAdminPrincipal(req),
        recoveryStore,
        executionTicketSigner,
        approvalVerifier,
        approvalStore,
        recoveryLock,
        readbackVerifier,
        deploymentIdentityProvider,
        hostBreakglassMutationExecutor,
      });
      return res.status(202).json(sanitizeRecoveryActionBridgeOutput({ ok: true, contract: "mad4b.recovery-action-bridge-route-receipt.v1", result, secrets_included: false }));
    } catch (error) {
      return errorResponse(res, error, "recovery_action_bridge_failed");
    }
  };

  router.post("/admin/recovery/kernel/approval-challenge", async (req, res) => {
    try {
      const body = assertExactKeys(req.body || {}, ["plan_id", "plan_hash", "step_id"], ["plan_id", "plan_hash", "step_id"]);
      assertApprovalChallengeAuthorities({ recoveryStore, approvalIssuer, approvalStore });
      const result = await createApprovalChallenge(body, {
        recoveryStore,
        approvalIssuer,
        approvalStore,
      });
      return res.status(201).json(sanitizeEvidence({
        ok: true,
        contract: "mad4b.recovery-approval-challenge-route-receipt.v1",
        result,
        approval_token_not_returned: true,
        execution_ticket_not_returned: true,
        secrets_included: false,
      }));
    } catch (error) {
      return errorResponse(res, error, "recovery_approval_challenge_failed");
    }
  });

  router.post("/admin/recovery/kernel/execute-approved", executeApprovedBridge);
  // Keep the historical path as a server-issued-ticket alias. Caller-supplied
  // execution_ticket_id/hash/signature fields are rejected by the fixed bridge contract.
  router.post("/admin/recovery/kernel/execute", executeApprovedBridge);

  router.get("/admin/recovery/kernel/runs/:run_id", async (req, res) => {
    try {
      const result = await getRecoveryRun({ run_id: req.params.run_id }, { recoveryStore });
      return res.status(200).json(sanitizeEvidence(result));
    } catch (error) {
      return errorResponse(res, error, "recovery_kernel_run_read_failed");
    }
  });

  router.get("/admin/recovery/kernel/evidence/:run_id", async (req, res) => {
    try {
      const result = await getRecoveryEvidence({ run_id: req.params.run_id }, { recoveryStore });
      return res.status(200).json(sanitizeEvidence(result));
    } catch (error) {
      return errorResponse(res, error, "recovery_kernel_evidence_read_failed");
    }
  });

  return router;
}

export const _testingRecoveryKernelRoutes = Object.freeze({
  READ_ONLY_CAPABILITIES,
  assertExactKeys,
  assertProductionEnvironment,
  errorResponse,
});
