import { Router } from "express";
import { buildHostBreakglassPlan, dispatchHostBreakglassPlan, publicHostBreakglassCatalog, readHostBreakglassRun } from "../hostBreakglassCatalog.js";
import { publicStagingReadinessRemediationContract, readStagingRuntimeBootstrapContract } from "../stagingRuntimeBootstrapContract.js";

function errorResponse(res, error) {
  return res.status(Number(error?.status || 500)).json({ ok: false, error: { code: error?.code || "host_breakglass_failed", message: error?.message || "Host Breakglass request failed.", details: error?.details || {} }, database_mutation_performed: false, secrets_included: false });
}

function isStagingRequest(input = {}) {
  return String(input.environment_key || "").trim() === "staging_local_windows_docker";
}

export function buildAdminHostBreakglassRoutes({ requireBackendApiKey, requireAdminPrincipal, broker = {} } = {}) {
  const router = Router();
  const planDependencies = { ...broker, proofResolver: broker.proofResolver || broker.resolveRoleSelectionProof || null };
  const dependenciesFor = (input = {}) => isStagingRequest(input)
    ? { ...planDependencies, bootstrapContract: readStagingRuntimeBootstrapContract() }
    : planDependencies;
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter((value) => typeof value === "function");
  if (guards.length !== 2) throw new Error("Admin Host Breakglass routes require backend-key and admin-principal guards.");
  router.use("/admin/runtime-bootstrap", ...guards);
  router.get("/admin/runtime-bootstrap/catalog", (req, res) => res.status(200).json({
    ...publicHostBreakglassCatalog(),
    staging_readiness_remediation: publicStagingReadinessRemediationContract(),
    secrets_included: false,
  }));
  router.post("/admin/runtime-bootstrap/plan", (req, res) => { try { return res.status(200).json({ ok: true, ...buildHostBreakglassPlan(req.body || {}, dependenciesFor(req.body || {})), secrets_included: false }); } catch (error) { return errorResponse(res, error); } });
  router.post("/admin/runtime-bootstrap/runs", async (req, res) => { try { const input = req.body || {}; const plan = buildHostBreakglassPlan(input, dependenciesFor(input)); if (plan.action === "plan") return res.status(200).json({ ok: true, ...plan }); return res.status(202).json(await dispatchHostBreakglassPlan(plan, broker)); } catch (error) { return errorResponse(res, error); } });
  router.get("/admin/runtime-bootstrap/runs/:correlation_id", async (req, res) => { try { return res.status(200).json(await readHostBreakglassRun(req.params.correlation_id, broker)); } catch (error) { return errorResponse(res, error); } });
  return router;
}
