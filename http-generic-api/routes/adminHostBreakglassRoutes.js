import { Router } from "express";
import { buildHostBreakglassPlan, dispatchHostBreakglassPlan, publicHostBreakglassCatalog, readHostBreakglassRun } from "../hostBreakglassCatalog.js";
import { resolveDurableRoleSelectionProof } from "../hostBreakglassRoleSelectionArtifact.js";
import { publicStagingReadinessRemediationContract, readStagingRuntimeBootstrapContract } from "../stagingRuntimeBootstrapContract.js";

function errorResponse(res, error) {
  return res.status(Number(error?.status || 500)).json({ ok: false, error: { code: error?.code || "host_breakglass_failed", message: error?.message || "Host Breakglass request failed.", details: error?.details || {} }, database_mutation_performed: false, secrets_included: false });
}

function isStagingRequest(input = {}) {
  return String(input.environment_key || "").trim() === "staging_local_windows_docker";
}

function isRoleSelectiveProductionApply(input = {}) {
  return !isStagingRequest(input)
    && String(input.operation_key || "").trim() === "database.rebuild_empty"
    && String(input.action || "").trim() === "apply_migration";
}

export function buildAdminHostBreakglassRoutes({ requireBackendApiKey, requireAdminPrincipal, broker = {} } = {}) {
  const router = Router();
  const planDependencies = { ...broker, proofResolver: broker.proofResolver || broker.resolveRoleSelectionProof || null };
  const dependenciesFor = (input = {}) => isStagingRequest(input)
    ? { ...planDependencies, bootstrapContract: readStagingRuntimeBootstrapContract() }
    : planDependencies;
  const buildGovernedPlan = async (input = {}) => {
    const deps = dependenciesFor(input);
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
  router.post("/admin/runtime-bootstrap/plan", async (req, res) => { try { return res.status(200).json({ ok: true, ...await buildGovernedPlan(req.body || {}), secrets_included: false }); } catch (error) { return errorResponse(res, error); } });
  router.post("/admin/runtime-bootstrap/runs", async (req, res) => { try { const input = req.body || {}; const plan = await buildGovernedPlan(input); if (plan.action === "plan") return res.status(200).json({ ok: true, ...plan }); return res.status(202).json(await dispatchHostBreakglassPlan(plan, broker)); } catch (error) { return errorResponse(res, error); } });
  router.get("/admin/runtime-bootstrap/runs/:correlation_id", async (req, res) => { try { return res.status(200).json(await readHostBreakglassRun(req.params.correlation_id, broker)); } catch (error) { return errorResponse(res, error); } });
  return router;
}

export const __adminHostBreakglassRoutesTest = Object.freeze({ isRoleSelectiveProductionApply });
