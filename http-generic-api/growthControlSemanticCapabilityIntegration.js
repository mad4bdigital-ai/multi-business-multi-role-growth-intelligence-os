import { resolveTenantEffectiveCapability } from "./tenantEffectiveCapabilityResolver.js";
import { createGrowthControlSemanticCapabilityAdapter } from "./src/application/growthControlPlane/semanticCapabilityResolutionAdapter.js";

const integration = createGrowthControlSemanticCapabilityAdapter({
  resolveCapability: resolveTenantEffectiveCapability
});

export async function previewGrowthControlSemanticCapabilities(input = {}, context = {}) {
  return integration.previewSemanticCapabilities(input, context);
}

export const GROWTH_CONTROL_SEMANTIC_CAPABILITY_INTEGRATION = Object.freeze({
  integration: "growth_control_plane_semantic_capability_adapter_v1",
  resolver: "tenant_effective_capability_resolver_v1",
  sourceSpec: "007",
  previewOnly: true,
  providerDispatchAllowed: false,
  providerApplyAllowed: false,
  externalWrites: false,
  secretsIncluded: false
});
