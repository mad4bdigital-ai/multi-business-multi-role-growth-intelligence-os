import * as production from "./activationGatewayRolloutToolProduction.js";
import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";
import { assertPlatformResourceAuthorityStoreSource } from "./platformResourceAuthorityStore.js";

export {
  ACTIVATION_GATEWAY_ROLLOUT_CONTRACT,
  activationGatewayTypedConfirmation,
  buildActivationGatewayUploadForm,
  createCloudflareApiClient,
} from "./activationGatewayRolloutToolProduction.js";

function stagingRequest(input = {}, registry = readEnvironmentConvergenceRegistry()) {
  const profileHash = String(registry?.profiles?.staging?.activation_gateway?.expected_policy_hash || "").trim().toLowerCase();
  const expectedHash = String(input?.expected_policy_hash || "").trim().toLowerCase();
  const scriptName = String(input?.script_name || "").trim();
  return Boolean(profileHash) && (expectedHash === profileHash || scriptName === "mad4b-activation-gateway-staging");
}

function bindStagingGovernanceAuthorityStore(deps = {}) {
  const explicitRuntimePool = deps.runtimePool || null;
  const runtimePool = explicitRuntimePool || deps.pool || null;
  const governancePool = deps.governancePool || deps.authorityStorePool || null;

  // Legacy/internal callers that supply one generic pool keep their existing contract.
  // The live GPT/Admin surface supplies explicit runtime + governance pools and must
  // preserve that ownership boundary fail-closed.
  if (!explicitRuntimePool && !governancePool) return deps;

  if (!runtimePool || typeof runtimePool.query !== "function") {
    const error = new Error("Staging Activation Gateway requires an explicit Runtime DB query executor.");
    error.code = "STAGING_ACTIVATION_GATEWAY_RUNTIME_POOL_REQUIRED";
    error.status = 503;
    throw error;
  }
  if (!governancePool || typeof governancePool.query !== "function") {
    const error = new Error("Staging Activation Gateway requires the dedicated Governance Authority Store executor.");
    error.code = "STAGING_ACTIVATION_GATEWAY_GOVERNANCE_AUTHORITY_STORE_REQUIRED";
    error.status = 503;
    throw error;
  }

  assertPlatformResourceAuthorityStoreSource({ pool: governancePool, runtimePool });

  const routedRuntimePool = new Proxy(runtimePool, {
    get(target, property, receiver) {
      if (property === "query") {
        return async (sql, params = []) => {
          const statement = String(sql ?? "");
          if (/\b(?:FROM|JOIN)\s+platform_resource_authority_bindings\b/iu.test(statement)) {
            return governancePool.query(sql, params);
          }
          return target.query(sql, params);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { ...deps, runtimePool: routedRuntimePool, governancePool };
}

export async function buildActivationGatewayRolloutPlan(input = {}, deps = {}) {
  const registry = deps.registry || readEnvironmentConvergenceRegistry();
  if (!stagingRequest(input, registry)) return production.buildActivationGatewayRolloutPlan(input, deps);
  const { buildStagingActivationGatewayApplyPlan } = await import("./stagingActivationGatewayApplyAdapter.js");
  return buildStagingActivationGatewayApplyPlan(input, { ...bindStagingGovernanceAuthorityStore(deps), registry });
}

export async function runActivationGatewayDarkDeploy(input = {}, deps = {}) {
  const registry = deps.registry || readEnvironmentConvergenceRegistry();
  if (!stagingRequest(input, registry)) return production.runActivationGatewayDarkDeploy(input, deps);
  const { runStagingActivationGatewayApply } = await import("./stagingActivationGatewayApplyAdapter.js");
  return runStagingActivationGatewayApply(input, { ...bindStagingGovernanceAuthorityStore(deps), registry });
}
