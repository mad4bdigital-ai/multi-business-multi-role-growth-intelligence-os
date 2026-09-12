import { Router } from "express";
import { buildHostBreakglassPlan, dispatchHostBreakglassPlan, publicHostBreakglassCatalog, readHostBreakglassRun } from "../hostBreakglassCatalog.js";
import { buildVerifiedHostBreakglassLocalRequest } from "../hostBreakglassLocalRequest.js";
import { resolveDurableRoleSelectionProof } from "../hostBreakglassRoleSelectionArtifact.js";
import { publicStagingReadinessRemediationContract, readStagingRuntimeBootstrapContract } from "../stagingRuntimeBootstrapContract.js";

function errorResponse(res, error) {
  return res.status(Number(error?.status || 500)).json({ ok: false, error: { code: error?.code || "host_breakglass_failed", message: error?.message || "Host Breakglass request failed.", details: error?.details || {} }, database_mutation_performed: false, secrets_included: false });
}

function isStagingRequest(input = {}) {
  return String(input.environment_key || "").trim() === "staging_local_windows_docker";
}

function isRoleSelectiveApply(input = {}) {
  return String(input.operation_key || "").trim() === "database.rebuild_empty"
    && String(input.action || "").trim() === "apply_migration";
}

function isRoleSelectiveProductionApply(input = {}) {
  return !isStagingRequest(input) && isRoleSelectiveApply(input);
}

function isRoleSelectiveStagingApply(input = {}) {
  return isStagingRequest(input) && isRoleSelectiveApply(input);
}

function stagingRebuildRecoverySurfaceRequired() {
  const error = new Error("Staging selective rebuild-empty is governed only by the Recovery System Tool lifecycle; Host Breakglass remains the local execution transport after server approval.");
  error.status = 409;
  error.code = "STAGING_REBUILD_EMPTY_RECOVERY_SYSTEM_TOOL_REQUIRED";
  error.details = {
    required_tools: [
      "staging_recovery_rebuild_empty_inspection_record",
      "staging_recovery_rebuild_empty_prepare",
      "staging_recovery_rebuild_empty_approve",
    ],
    direct_runtime_bootstrap_rebuild_authority: false,
    production_authority: false,
    secrets_included: false,
  };
  return error;
}

function attachVerifiedStagingLocalRequest(plan, receipt, input = {}) {
  const supported = plan?.environment_key === "staging_local_windows_docker"
    && plan?.operation_key === "database.repair"
    && plan?.runbook_key === "database.access_repair";
  if (receipt?.status !== "local_execution_required" || !supported) return receipt;
  const verifiedRequest = buildVerifiedHostBreakglassLocalRequest({ ...plan, authority_plan_hash: input.authority_plan_hash || null });
  const requestFileName = `verified-staging-access-repair-${plan.plan_sha256.slice(0, 16)}.json`;
  return {
    ...receipt,
    command: `node scripts/host-breakglass-local-verified.mjs --request-file .\\${requestFileName}`,
    request_file_name: requestFileName,
    verified_request: verifiedRequest,
    verified_request_sha256: verifiedRequest.request_sha256,
    exact_plan_match_required: true,
    authority_plan_hash_separate_from_transport_plan: false,
    legacy_runner_invocation_after_verification: true,
    production_authority: false,
    database_mutation_performed: false,
    secrets_included: false,
  };
}

export function buildAdminHostBreakglassRoutes({ requireBackendApiKey, requireAdminPrincipal, broker = {} } = {}) {
  const router = Router();
  const planDependencies = { ...broker, proofResolver: broker.proofResolver || broker.resolveRoleSelectionProof || null };
  const dependenciesFor = (input = {}) => isStagingRequest(input)
    ? { ...planDependencies, bootstrapContract: readStagingRuntimeBootstrapContract() }
    : planDependencies;

  const buildGovernedPlan = async (input = {}) => {
    const deps = dependenciesFor(input);
    if (isRoleSelectiveStagingApply(input)) throw stagingRebuildRecoverySurfaceRequired();
    if (!isRoleSelectiveProductionApply(input)) return buildHostBreakglassPlan(input, deps);
    const resolver = typeof broker.resolveDurableRoleSelectionProof === "function"
      ? broker.resolveDurableRoleSelectionProof
      : resolveDurableRoleSelectionProof;
    const durableProof = await resolver(input, {
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      env: broker.env || process.env,
      fetchImpl: broker.fetchImpl || fetch,
      tokenResolver: broker.tokenResolver,
    });
    if (!durableProof || durableProof.source !== "durable_full_inspection") {
      const error = new Error("Role-selective apply requires a server-resolved durable full-inspection proof.");
      error.status = 503;
      error.code = "host_breakglass_role_selection_provenance_unavailable";
      throw error;
    }
    return buildHostBreakglassPlan({ ...input, role_selection_proof: durableProof }, {
      ...deps,
      proofResolver: () => durableProof,
    });
  };

  const guards = [requireBackendApiKey, requireAdminPrincipal].filter((value) => typeof value === "function");
  if (guards.length !== 2) throw new Error("Admin Host Breakglass routes require backend-key and admin-principal guards.");
  router.use("/admin/runtime-bootstrap", ...guards);
  router.get("/admin/runtime-bootstrap/catalog", (_req, res) => res.status(200).json({
    ...publicHostBreakglassCatalog(),
    staging_readiness_remediation: publicStagingReadinessRemediationContract(),
    staging_rebuild_empty_orchestration: {
      authority_surface: "recovery_system_tools",
      direct_runtime_bootstrap_authority: false,
      tools: [
        "staging_recovery_rebuild_empty_inspection_record",
        "staging_recovery_rebuild_empty_prepare",
        "staging_recovery_rebuild_empty_approve",
      ],
      host_breakglass_role: "verified_local_execution_transport_only",
      secrets_included: false,
    },
    secrets_included: false,
  }));
  router.post("/admin/runtime-bootstrap/plan", async (req, res) => {
    try { return res.status(200).json({ ok: true, ...await buildGovernedPlan(req.body || {}), secrets_included: false }); }
    catch (error) { return errorResponse(res, error); }
  });
  router.post("/admin/runtime-bootstrap/runs", async (req, res) => {
    try {
      const input = req.body || {};
      const plan = await buildGovernedPlan(input);
      if (plan.action === "plan") return res.status(200).json({ ok: true, ...plan });
      const receipt = await dispatchHostBreakglassPlan(plan, broker);
      return res.status(202).json(attachVerifiedStagingLocalRequest(plan, receipt, input));
    } catch (error) {
      return errorResponse(res, error);
    }
  });
  router.get("/admin/runtime-bootstrap/runs/:correlation_id", async (req, res) => {
    try { return res.status(200).json(await readHostBreakglassRun(req.params.correlation_id, broker)); }
    catch (error) { return errorResponse(res, error); }
  });
  return router;
}

export const __adminHostBreakglassRoutesTest = Object.freeze({ isRoleSelectiveProductionApply, isRoleSelectiveStagingApply, attachVerifiedStagingLocalRequest, stagingRebuildRecoverySurfaceRequired });
