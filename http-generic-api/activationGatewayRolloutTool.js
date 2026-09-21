import * as production from "./activationGatewayRolloutToolProduction.js";
import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";
import {
  assertPlatformResourceAuthorityStoreSource,
  resolvePlatformResourceAuthorityPool,
} from "./platformResourceAuthorityStore.js";

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
  const runtimePool = deps.runtimePool || deps.pool || null;
  const governancePool = deps.governancePool
    || deps.authorityStorePool
    || resolvePlatformResourceAuthorityPool();

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

  try {
    assertPlatformResourceAuthorityStoreSource({ pool: governancePool, runtimePool });
  } catch (error) {
    if (error?.code === "PLATFORM_RESOURCE_AUTHORITY_RUNTIME_POOL_FORBIDDEN") {
      const mismatch = new Error("Runtime and Governance database authorities must resolve to distinct executors.");
      mismatch.code = "staging_activation_gateway_runtime_database_authority_mismatch";
      mismatch.status = 503;
      mismatch.details = { cause_code: error.code, secrets_included: false };
      throw mismatch;
    }
    throw error;
  }
  return { ...deps, runtimePool, governancePool };
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
