import {Router} from "express";
import {createRecoveryCapabilityRegistry} from "../recoveryOrchestrator.js";

export const RECOVERY_ORCHESTRATOR_DISCOVERY_PATH="/admin/recovery/orchestrator/capabilities";

export function buildRecoveryOrchestratorRoutes({
  requireBackendApiKey,requireAdminPrincipal,recoveryOrchestratorRegistry=null,
}={}) {
  if(typeof requireBackendApiKey!=="function"||typeof requireAdminPrincipal!=="function")
    throw new Error("recovery_orchestrator_route_authority_missing");
  const router=Router();
  router.get(RECOVERY_ORCHESTRATOR_DISCOVERY_PATH,
    requireBackendApiKey,requireAdminPrincipal,(_req,res)=>{
      // Composition injects registered adapters; requests cannot nominate their
      // own provider, method, secret, endpoint, account, or executor.
      const registry=recoveryOrchestratorRegistry?.contract==="mad4b.recovery-capability-registry.v1"
        ? recoveryOrchestratorRegistry:createRecoveryCapabilityRegistry([]);
      let capabilities;
      try {capabilities=registry.list();}
      catch{return res.status(503).json({ok:false,
        error:{code:"recovery_orchestrator_registry_unavailable"},
        secrets_included:false});}
      return res.status(200).json({
        ok:true,contract:"mad4b.recovery-orchestrator-capability-discovery.v1",
        capabilities,
        execution_authorized:false,
        production_mutation_authorized:false,
        mutation_endpoint_registered:false,
        source:"server_managed_registry",
        secrets_included:false,
      });
    });
  return router;
}
