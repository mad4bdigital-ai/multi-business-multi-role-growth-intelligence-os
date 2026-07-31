import assert from "node:assert/strict";

import {
  growthControlProviderAdapterResolverContract,
  resolveGrowthControlProviderAdapter,
} from "./src/domain/growthControlPlane/growthControlProviderAdapterResolver.js";

const NOW = "2030-01-01T00:10:00.000Z";
const REQUIRED_METHODS = [
  "describeCapabilities",
  "validateRequest",
  "checkReadiness",
  "prepareDispatch",
  "dispatch",
  "inspect",
  "readback",
  "normalizeError",
  "normalizeResult",
  "cancel",
];

const context = Object.freeze({
  tenantId: "tenant-adapter-01",
  workspaceId: "workspace-adapter-01",
  brandId: "brand-adapter-01",
  activityBindingId: "activity-binding-adapter-01",
  resourceId: "provider:cms/site-01",
  capabilityKey: "content.publish",
  activityTypeKey: "content.marketing",
  channel: "website",
  environment: "production",
  dispatchRequested: true,
  applyRequested: true,
  now: NOW,
});

function candidate({
  adapterKey,
  versionId,
  bindingRef,
  version = 1,
  scope = {},
  preferenceWeight = 0,
  bindingPriority = 0,
  healthScore = 90,
  healthStatus = "healthy",
  healthObservedAt = "2030-01-01T00:09:00.000Z",
  healthMaxAgeSeconds = 300,
  rolloutMode = "general_availability",
  rolloutEligible = true,
  certificationStatus = "certified",
  certificationEnvironment = "production",
  certificationExpiresAt = "2030-01-02T00:00:00.000Z",
  dispatchCertified = true,
  applyCertified = true,
  methods = REQUIRED_METHODS,
  definitionStatus = "active",
  versionStatus = "active",
  immutable = true,
  providerEnabled = true,
  connectionReady = true,
  credentialReferenceReady = true,
  quotaReady = true,
  capabilityKeys = ["content.publish"],
  activityTypeKeys = ["content.marketing"],
  channels = ["website"],
  environments = ["production"],
} = {}) {
  return {
    adapterKey,
    adapterVersionId: versionId,
    providerBindingRef: bindingRef,
    connectedSystemId: `system:${adapterKey}`,
    connectionId: `connection:${adapterKey}`,
    endpointKey: "content.publish",
    version,
    definitionStatus,
    versionStatus,
    immutable,
    contractMethods: methods,
    capabilityKeys,
    activityTypeKeys,
    channels,
    environments,
    scope,
    preferenceWeight,
    bindingPriority,
    certification: {
      status: certificationStatus,
      environment: certificationEnvironment,
      dispatchCertified,
      applyCertified,
      expiresAt: certificationExpiresAt,
      evidenceSha256: adapterKey[0].repeat(64),
    },
    health: {
      status: healthStatus,
      score: healthScore,
      observedAt: healthObservedAt,
      maxAgeSeconds: healthMaxAgeSeconds,
      evidenceSha256: adapterKey[1].repeat(64),
    },
    rollout: {
      mode: rolloutMode,
      eligible: rolloutEligible,
      evidenceSha256: adapterKey[2].repeat(64),
    },
    readiness: {
      providerEnabled,
      connectionReady,
      credentialReferenceReady,
      quotaReady,
    },
  };
}

const generic = candidate({
  adapterKey: "alpha.adapter",
  versionId: "adapter-version-alpha-01",
  bindingRef: "binding-alpha-01",
  version: 4,
  bindingPriority: 100,
  healthScore: 99,
  scope: { tenantId: "tenant-adapter-01" },
});
const exact = candidate({
  adapterKey: "beta.adapter",
  versionId: "adapter-version-beta-01",
  bindingRef: "binding-beta-01",
  version: 2,
  bindingPriority: 20,
  healthScore: 80,
  scope: {
    tenantId: "tenant-adapter-01",
    workspaceId: "workspace-adapter-01",
    brandId: "brand-adapter-01",
    activityBindingId: "activity-binding-adapter-01",
    resourceIds: ["provider:cms/site-01"],
  },
});
const selected = resolveGrowthControlProviderAdapter({
  registryCandidates: [generic, exact],
  context,
});
assert.equal(selected.contract_version, "growth-control-provider-adapter-resolution-v1");
assert.equal(selected.status, "selected");
assert.equal(selected.ready, true);
assert.equal(selected.blocker, null);
assert.equal(selected.selection.adapter_key, "beta.adapter");
assert.equal(selected.selection.adapter_version_id, "adapter-version-beta-01");
assert.equal(selected.selection.provider_binding_ref, "binding-beta-01");
assert.deepEqual(selected.selection.rank_vector.slice(0, 6), [0, 1, 1, 1, 1, 1]);
assert.equal(selected.candidate_count, 2);
assert.equal(selected.ready_candidate_count, 2);
assert.equal(selected.authority_granted, false);
assert.equal(selected.runtime_authority_changed, false);
assert.equal(selected.provider_calls, false);
assert.equal(selected.provider_dispatch_allowed, false);
assert.equal(selected.provider_apply_allowed, false);
assert.equal(selected.external_writes, false);
assert.equal(selected.secrets_included, false);
assert.match(selected.context_sha256, /^[a-f0-9]{64}$/);
assert.match(selected.resolution_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(selected), true);
assert.equal(Object.isFrozen(selected.candidates), true);
assert.equal(Object.isFrozen(selected.selection), true);

const preferred = resolveGrowthControlProviderAdapter({
  registryCandidates: [generic, exact],
  context: { ...context, preferredAdapterKey: "alpha.adapter" },
});
assert.equal(preferred.selection.adapter_key, "alpha.adapter", "explicit preference must rank before scope specificity after readiness passes");
assert.equal(preferred.selection.rank_vector[0], 1);

const reordered = resolveGrowthControlProviderAdapter({
  registryCandidates: [exact, generic],
  context,
});
assert.equal(reordered.resolution_sha256, selected.resolution_sha256, "registry order must not affect deterministic resolution");
assert.deepEqual(reordered.selection, selected.selection);

const tiedLeft = candidate({
  adapterKey: "delta.adapter",
  versionId: "adapter-version-delta-01",
  bindingRef: "binding-delta-01",
  version: 3,
  bindingPriority: 50,
  healthScore: 95,
  scope: { tenantId: "tenant-adapter-01" },
});
const tiedRight = candidate({
  adapterKey: "gamma.adapter",
  versionId: "adapter-version-gamma-01",
  bindingRef: "binding-gamma-01",
  version: 3,
  bindingPriority: 50,
  healthScore: 95,
  scope: { tenantId: "tenant-adapter-01" },
});
const ambiguous = resolveGrowthControlProviderAdapter({
  registryCandidates: [tiedRight, tiedLeft],
  context,
});
assert.equal(ambiguous.status, "ambiguous");
assert.equal(ambiguous.ready, false);
assert.equal(ambiguous.blocker, "ADAPTER_SELECTION_AMBIGUOUS");
assert.equal(ambiguous.selection, null);
assert.deepEqual(
  ambiguous.tied_top_candidates.map((item) => item.adapter_key),
  ["delta.adapter", "gamma.adapter"],
  "stable identity may order evidence but must not break an equal top rank",
);
const ambiguousReordered = resolveGrowthControlProviderAdapter({
  registryCandidates: [tiedLeft, tiedRight],
  context,
});
assert.equal(ambiguousReordered.resolution_sha256, ambiguous.resolution_sha256);

const blockedCandidates = [
  candidate({
    adapterKey: "blocked.methods",
    versionId: "adapter-version-blocked-methods",
    bindingRef: "binding-blocked-methods",
    methods: REQUIRED_METHODS.filter((method) => method !== "readback"),
  }),
  candidate({
    adapterKey: "blocked.health",
    versionId: "adapter-version-blocked-health",
    bindingRef: "binding-blocked-health",
    healthObservedAt: "2029-12-31T23:00:00.000Z",
  }),
  candidate({
    adapterKey: "blocked.certification",
    versionId: "adapter-version-blocked-certification",
    bindingRef: "binding-blocked-certification",
    certificationExpiresAt: "2030-01-01T00:05:00.000Z",
  }),
  candidate({
    adapterKey: "blocked.rollout",
    versionId: "adapter-version-blocked-rollout",
    bindingRef: "binding-blocked-rollout",
    rolloutMode: "shadow",
  }),
  candidate({
    adapterKey: "blocked.connection",
    versionId: "adapter-version-blocked-connection",
    bindingRef: "binding-blocked-connection",
    connectionReady: false,
  }),
  candidate({
    adapterKey: "blocked.scope",
    versionId: "adapter-version-blocked-scope",
    bindingRef: "binding-blocked-scope",
    scope: { tenantId: "tenant-other-01" },
  }),
];
const blocked = resolveGrowthControlProviderAdapter({ registryCandidates: blockedCandidates, context });
assert.equal(blocked.status, "blocked");
assert.equal(blocked.ready, false);
assert.equal(blocked.blocker, "ADAPTER_NOT_READY");
assert.equal(blocked.selection, null);
assert.equal(blocked.ready_candidate_count, 0);
const blockerCodes = new Set(blocked.candidates.flatMap((item) => item.blockers.map((entry) => entry.code)));
[
  "ADAPTER_METHOD_REQUIRED",
  "ADAPTER_HEALTH_EVIDENCE_STALE",
  "ADAPTER_CERTIFICATION_EXPIRED",
  "ADAPTER_SHADOW_EFFECT_FORBIDDEN",
  "ADAPTER_CONNECTION_NOT_READY",
  "ADAPTER_SCOPE_MISMATCH",
].forEach((code) => assert.equal(blockerCodes.has(code), true, `missing blocker ${code}`));
assert(blocked.candidates.every((item) => item.provider_calls === false));
assert(blocked.candidates.every((item) => item.provider_dispatch_allowed === false));
assert(blocked.candidates.every((item) => item.secrets_included === false));

const shadowPreview = resolveGrowthControlProviderAdapter({
  registryCandidates: [candidate({
    adapterKey: "shadow.preview",
    versionId: "adapter-version-shadow-preview",
    bindingRef: "binding-shadow-preview",
    rolloutMode: "shadow",
  })],
  context: { ...context, dispatchRequested: false, applyRequested: false },
});
assert.equal(shadowPreview.status, "selected", "shadow is selectable for no-effect preview only");

assert.throws(
  () => resolveGrowthControlProviderAdapter({
    registryCandidates: [{ ...generic, api_key: "forbidden" }],
    context,
  }),
  (error) => error?.code === "GROWTH_CONTROL_ADAPTER_SENSITIVE_INPUT",
);
assert.throws(
  () => resolveGrowthControlProviderAdapter({
    registryCandidates: [generic, { ...generic }],
    context,
  }),
  (error) => error?.code === "GROWTH_CONTROL_ADAPTER_REGISTRY_INVALID",
);
assert.throws(
  () => resolveGrowthControlProviderAdapter({
    registryCandidates: [generic],
    context: { ...context, resourceId: "" },
  }),
  (error) => error?.code === "GROWTH_CONTROL_ADAPTER_INPUT_INVALID",
);

assert.deepEqual(growthControlProviderAdapterResolverContract.ranking_order, [
  "explicit_preference",
  "exact_resource_binding",
  "exact_activity_binding",
  "exact_brand_binding",
  "exact_workspace_binding",
  "exact_tenant_binding",
  "preference_weight",
  "binding_priority",
  "health_score",
  "adapter_version",
]);
assert.equal(growthControlProviderAdapterResolverContract.equal_top_rank, "ADAPTER_SELECTION_AMBIGUOUS");
assert.equal(growthControlProviderAdapterResolverContract.stable_identity_only_orders_evidence, true);
assert.equal(growthControlProviderAdapterResolverContract.authority_granted, false);
assert.equal(growthControlProviderAdapterResolverContract.provider_calls, false);
assert.equal(growthControlProviderAdapterResolverContract.provider_dispatch_allowed, false);
assert.equal(growthControlProviderAdapterResolverContract.secrets_included, false);

console.log("growth control provider adapter resolver tests passed");
