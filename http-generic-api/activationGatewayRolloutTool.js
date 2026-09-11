import * as production from "./activationGatewayRolloutToolProduction.js";
import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";

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

export async function buildActivationGatewayRolloutPlan(input = {}, deps = {}) {
  const registry = deps.registry || readEnvironmentConvergenceRegistry();
  if (!stagingRequest(input, registry)) return production.buildActivationGatewayRolloutPlan(input, deps);
  const { buildStagingActivationGatewayApplyPlan } = await import("./stagingActivationGatewayApplyAdapter.js");
  return buildStagingActivationGatewayApplyPlan(input, { ...deps, registry });
}

export async function runActivationGatewayDarkDeploy(input = {}, deps = {}) {
  const registry = deps.registry || readEnvironmentConvergenceRegistry();
  if (!stagingRequest(input, registry)) return production.runActivationGatewayDarkDeploy(input, deps);
  const { runStagingActivationGatewayApply } = await import("./stagingActivationGatewayApplyAdapter.js");
  return runStagingActivationGatewayApply(input, { ...deps, registry });
}
