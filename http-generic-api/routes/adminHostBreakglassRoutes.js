import { Router } from "express";
import { buildHostBreakglassPlan, dispatchHostBreakglassPlan, publicHostBreakglassCatalog, readHostBreakglassRun } from "../hostBreakglassCatalog.js";
import { buildVerifiedHostBreakglassLocalRequest } from "../hostBreakglassLocalRequest.js";
import { resolveDurableRoleSelectionProof } from "../hostBreakglassRoleSelectionArtifact.js";
import { createStagingRebuildEmptyAuthority } from "../stagingRebuildEmptyAuthority.js";
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

function attachVerifiedStagingLocalRequest(plan, receipt, input = {}) {
  const supported = plan?.environment_key === "staging_local_windows_docker" && (
    (plan?.operation_key === "database.repair" && plan?.runbook_key === "database.access_repair")
    || (plan?.operation_key === "database.rebuild_empty" && plan?.runbook_key === "database.empty_rebuild")
  );
  if (receipt?.status !== "local_execution_required" || !supported) return receipt;
  const verifiedRequest = buildVerifiedHostBreakglassLocalRequest({
    ...plan,
    authority_plan_hash: input.authority_plan_hash || null,
  });
  const purpose = plan.operation_key === "database.rebuild_empty" ? "rebuild-empty" : "access-repair";
  const requestFileName = `verified-staging-${purpose}-${plan.plan_sha256.slice(0, 16)}.json`;
  return {
    ...receipt,
    command: `node scripts/host-breakglass-local-verified.mjs --request-file .\\${requestFileName}`,
    request_file_name: requestFileName,
    verified_request: verifiedRequest,
    verified_request_sha256: verifiedRequest.request_sha256,
    exact_plan_match_required: true,
    authority_plan_hash_separate_from_transport_plan: plan.operation_key === "database.rebuild_empty",
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
  const stagingAuthority = () => {
    if (broker.stagingRebuildEmptyAuthority) return broker.stagingRebuildEmptyAuthority;
    if (typeof broker.createStagingRebuildEmptyAuthority === "function") return broker.createStagingRebuildEmptyAuthority();
    return createStagingRebuildEmptyAuthority({ env: broker.env || process.env, adapters: broker.stagingRecoveryAdapters || null, authorityGraph: broker.stagingRecoveryAuthorityGraph || null });
  };
  const buildGovernedPlan = async (input = {}) => {
    const deps = dependenciesFor(input);
    if (isRoleSelectiveStagingApply(input)) {
      const resolver = typeof broker.resolveDurableStagingRoleSelectionProof === "function"
        ? broker.resolveDurableStagingRoleSelectionProof
        : async (candidate) => stagingAuthority().resolveProof(candidate);
      const durableProof = await resolver(input);
      if (!durableProof || durableProof.source !== "durable_full_inspection") {
        const error = new Error("Staging role-selective apply requires a server-resolved durable full-inspection proof.");
        error.status = 503;
        error.code = "host_breakglass_role_selection_provenance_unavailable";
        throw error;
      }
      return buildHostBreakglassPlan({ ...input, role_selection_proof: durableProof }, { ...deps, proofResolver: () => durableProof });
    }
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
  router.get("/admin/runtime-bootstrap/catalog", (req, res) => res.status(200).json({
    ...publicHostBreakglassCatalog(),
    staging_readiness_remediation: publicStagingReadinessRemediationContract(),
    secrets_included: false,
  }));
  router.post("/admin/runtime-bootstrap/staging/rebuild-empty/inspection", async (req, res) => {
    try { return res.status(201).json(await stagingAuthority().recordInspection(req.body || {})); }
    catch (error) { return errorResponse(res, error); }
  });
  router.post("/admin/runtime-bootstrap/staging/rebuild-empty/prepare", async (req, res) => {
    try { return res.status(200).json(await stagingAuthority().prepare(req.body || {})); }
    catch (error) { return errorResponse(res, error); }
  });
  router.post("/admin/runtime-bootstrap/staging/rebuild-empty/approve", async (req, res) => {
    try { return res.status(200).json(await stagingAuthority().approveAndIssue(req.body || {})); }
    catch (error) { return errorResponse(res, error); }
  });
  router.post("/admin/runtime-bootstrap/plan", async (req, res) => { try { return res.status(200).json({ ok: true, ...await buildGovernedPlan(req.body || {}), secrets_included: false }); } catch (error) { return errorResponse(res, error); } });
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
  router.get("/admin/runtime-bootstrap/runs/:correlation_id", async (req, res) => { try { return res.status(200).json(await readHostBreakglassRun(req.params.correlation_id, broker)); } catch (error) { return errorResponse(res, error); } });
  return router;
}

export const __adminHostBreakglassRoutesTest = Object.freeze({ isRoleSelectiveProductionApply, isRoleSelectiveStagingApply, attachVerifiedStagingLocalRequest });
