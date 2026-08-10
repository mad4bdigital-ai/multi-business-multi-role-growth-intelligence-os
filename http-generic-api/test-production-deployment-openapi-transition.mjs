import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const syncSource = readFileSync("scripts/openapi-precise-contract-registry-sync.mjs", "utf8");
const registrySource = readFileSync("openapi-route-contracts.d/spec018-production-deployment-authority.yaml", "utf8");
const preciseSource = readFileSync("openapi/production-deployment-authority.yaml", "utf8");

const transitionStart = syncSource.indexOf('"POST /platform/remote-runtime/hosting/deploy-release"');
assert(transitionStart >= 0, "precise sync must register the bounded legacy deploy transition");
const transitionWindow = syncSource.slice(transitionStart, transitionStart + 900);
assert(transitionWindow.includes('route_file: "routes/platformPluginRoutes.js"'), "transition must bind to the real platform route file");
assert(transitionWindow.includes('operation_id: "remoteRuntimeHostingerDeployRelease"'), "transition must bind to the historical deploy operationId");
assert(transitionWindow.includes('auth_profile: "admin_backend"'), "transition must preserve admin/backend auth shape");
assert(transitionWindow.includes("consequential: true"), "deploy transition must remain consequential");
assert(transitionWindow.includes('composition_mode: "ref"'), "deploy transition must converge to one precise ref");
assert(transitionWindow.includes('path_item_ref: "./openapi/production-deployment-authority.yaml#/productionDeploymentAuthorityPath"'), "transition must converge only to the Spec018 path-item source");
assert(transitionWindow.includes('legacy_request_required: ["target_id", "expected_commit_sha"]'), "transition must require the exact historical deploy identity fields");

assert(syncSource.includes("registered_path_inline_contract_not_replaceable"), "unknown inline path contracts must still fail closed");
assert(syncSource.includes("!isKnownLegacyRegisteredOperation(operation, contract)"), "replaceability must still require the bounded legacy matcher");
assert(syncSource.includes('operation["x-runtime-contract-source"] == null'), "legacy transition must not absorb already-runtime-derived contracts");
assert(syncSource.includes('operation["x-contract-completeness"] == null'), "legacy transition must not absorb canonical precise contracts");

assert(registrySource.includes('"POST /platform/remote-runtime/hosting/deploy-release"'), "Spec018 registry fragment must own deploy-release");
assert(registrySource.includes("./openapi/production-deployment-authority.yaml#/productionDeploymentAuthorityPath"), "registry must target the precise Production authority source");
assert(preciseSource.includes("environment_branch_authority_v1"), "precise source must describe policy-derived Production authority");
assert(!preciseSource.includes("enum: [main, Production]"), "precise source must not preserve legacy caller branch selection");

console.log("Production deployment OpenAPI transition tests passed");
