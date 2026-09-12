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
  const buildApprovedStagingRebuildHandoff = async (approvalInput = {}, issued = {}) => {
    const contract = readStagingRuntimeBootstrapContract();
    const roles = Array.isArray(issued.selected_zero_object_roles) ? issued.selected_zero_object_roles : [];
    const prefix = contract.execution_policy?.rebuild_confirmation_prefix || "APPLY_STAGING_RUNTIME_BASELINE_REBUILD";
    const runInput = {
      environment_key: "staging_local_windows_docker",
      operation_key: "database.rebuild_empty",
      runbook_key: "database.empty_rebuild",
      action: "apply_migration",
      expected_sha: issued.expected_sha,
      target_source: "staging_local_role_env",
      target_key: issued.target_key || "staging-runtime",
      migration: "",
      confirmation: `${prefix}:${issued.expected_sha}:${issued.target_key || "staging-runtime"}:${roles.join(",")}`,
      correlation_id: approvalInput.idempotency_key,
      execution_ticket_id: issued.execution_ticket_id,
      execution_ticket_hash: issued.execution_ticket_hash,
      authority_plan_hash: issued.authority_plan_hash,
      role_selection_proof: issued.role_selection_proof,
    };
    const plan = await buildGovernedPlan(runInput);
    const receipt = await dispatchHostBreakglassPlan(plan, broker);
    return {
      run_input: { ...runInput, role_selection_proof: structuredClone(issued.role_selection_proof) },
      transport_plan_sha256: plan.plan_sha256,
      local_handoff: attachVerifiedStagingLocalRequest(plan, receipt, runInput),
    };
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
    try {
      const input = req.body || {};
      const issued = await stagingAuthority().approveAndIssue(input);
      const handoff = await buildApprovedStagingRebuildHandoff(input, issued);
      return res.status(202).json({
        ...issued,
        status: "execution_ticket_issued_local_handoff_ready",
        transport_plan_sha256: handoff.transport_plan_sha256,
        local_handoff: handoff.local_handoff,
        database_mutation_performed: false,
        grant_mutation_performed: false,
        production_authority: false,
        secrets_included: false,
      });
    } catch (error) { return errorResponse(res, error); }
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
