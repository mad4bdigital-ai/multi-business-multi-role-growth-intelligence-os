import assert from "node:assert/strict";
import {
  gatewayPolicySemanticPayload,
  stabilizeGatewayPolicyProvenance,
} from "./scripts/generate-custom-gpt-schemas.mjs";

const oldSourceHash = "1".repeat(64);
const oldRegistryHash = "2".repeat(64);
const newSourceHash = "3".repeat(64);
const newRegistryHash = "4".repeat(64);

const semantic = {
  manifest_version: 1,
  surface_registry_version: 2,
  warning_budget: [
    {
      surface: "activation_admin_production",
      operation_count: 9,
      warning_limit: 16,
      exceeded: false,
    },
  ],
  policy_key: "activation_gateway",
  public_host: "activation.mad4b.com",
  upstream_origin: "https://auth.mad4b.com",
  mutation_stale_policy: "deny",
  read_stale_grace_seconds: 0,
  ready_provenance: {
    required: true,
    health_path: "/health",
    require_policy_hash: true,
    require_source_commit: true,
  },
  source_registry: "canonicals/openapi/custom-gpt-surfaces.yaml",
  source_surfaces: ["activation_admin_production"],
  oauth_handoff_routes: [],
  routes: [
    {
      method: "GET",
      path: "/activation/awareness",
      mutation: false,
      operation_ids: ["readActivationAwareness"],
      auth_profiles: ["admin_service"],
      surfaces: ["activation_admin_production"],
      allowed_query_parameters: [],
      request_body_limit_bytes: 1048576,
      response_body_limit_bytes: 5242880,
      timeout_ms: 30000,
      freshness_class: "read_strict",
    },
  ],
};

const existing = {
  ...semantic,
  source_openapi_sha256: oldSourceHash,
  surface_registry_sha256: oldRegistryHash,
  content_hash_sha256: "5".repeat(64),
  signature_algorithm: "Ed25519",
  deployment_signature_required: true,
  secrets_included: false,
};

const unrelatedGlobalSourceChange = {
  ...semantic,
  source_openapi_sha256: newSourceHash,
  surface_registry_sha256: newRegistryHash,
};
const stable = stabilizeGatewayPolicyProvenance(unrelatedGlobalSourceChange, existing);
assert.equal(stable.source_openapi_sha256, oldSourceHash);
assert.equal(stable.surface_registry_sha256, oldRegistryHash);
assert.deepEqual(gatewayPolicySemanticPayload(stable), gatewayPolicySemanticPayload(existing));

const semanticRouteChange = {
  ...unrelatedGlobalSourceChange,
  routes: [
    ...semantic.routes,
    {
      ...semantic.routes[0],
      path: "/activation/new-route",
      operation_ids: ["newActivationOperation"],
    },
  ],
};
const rotated = stabilizeGatewayPolicyProvenance(semanticRouteChange, existing);
assert.equal(rotated.source_openapi_sha256, newSourceHash);
assert.equal(rotated.surface_registry_sha256, newRegistryHash);
assert.notDeepEqual(gatewayPolicySemanticPayload(rotated), gatewayPolicySemanticPayload(existing));

const registryVersionChange = {
  ...unrelatedGlobalSourceChange,
  surface_registry_version: 3,
};
const versionRotated = stabilizeGatewayPolicyProvenance(registryVersionChange, existing);
assert.equal(versionRotated.source_openapi_sha256, newSourceHash);
assert.equal(versionRotated.surface_registry_sha256, newRegistryHash);

const malformedPreviousProvenance = {
  ...existing,
  source_openapi_sha256: "not-a-sha",
};
const malformedFallback = stabilizeGatewayPolicyProvenance(unrelatedGlobalSourceChange, malformedPreviousProvenance);
assert.equal(malformedFallback.source_openapi_sha256, newSourceHash);
assert.equal(malformedFallback.surface_registry_sha256, oldRegistryHash);

console.log("gateway_policy_provenance_stability=PASS");
