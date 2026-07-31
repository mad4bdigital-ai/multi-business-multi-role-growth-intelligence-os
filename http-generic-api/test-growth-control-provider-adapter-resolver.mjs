import assert from "node:assert/strict";

import {
  growthControlProviderAdapterResolverContract,
  resolveGrowthControlProviderAdapter,
} from "./src/domain/growthControlPlane/growthControlProviderAdapterResolver.js";

const REQUIRED_METHODS = [
  "describeCapabilities", "validateRequest", "checkReadiness", "prepareDispatch",
  "dispatch", "inspect", "readback", "normalizeError", "normalizeResult", "cancel",
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
  now: "2030-01-01T00:10:00.000Z",
});

function candidate({
  adapterKey,
  versionId,
  bindingRef,
  version = 1,
  scope = {},
  bindingPriority = 0,
  preferenceWeight = 0,
  healthScore = 90,
  healthObservedAt = "2030-01-01T00:09:00.000Z",
  rolloutMode = "general_availability",
  certificationExpiresAt = "2030-01-02T00:00:00.000Z",
  methods = REQUIRED_METHODS,
  connectionReady = true,
} = {}) {
  return {
    adapterKey,
    adapterVersionId: versionId,
    providerBindingRef: bindingRef,
    connectedSystemId: `system:${adapterKey}`,
    connectionId: `connection:${adapterKey}`,
    endpointKey: "content.publish",
    version,
    definitionStatus: "active",
    versionStatus: "active",
    immutable: true,
    contractMethods: methods,
    capabilityKeys: ["content.publish"],
    activityTypeKeys: ["content.marketing"],
    channels: ["website"],
    environments: ["production"],
    scope,
    bindingPriority,
    preferenceWeight,
    certification: {
      status: "certified",
      environment: "production",
      dispatchCertified: true,
      applyCertified: true,
      expiresAt: certificationExpiresAt,
      evidenceSha256: "a".repeat(64),
    },
    health: {
      status: "healthy",
      score: healthScore,
      observedAt: healthObservedAt,
      maxAgeSeconds: 300,
      evidenceSha256: "b".repeat(64),
    },
    rollout: {
      mode: rolloutMode,
      eligible: true,
      evidenceSha256: "c".repeat(64),
    },
    readiness: {
      providerEnabled: true,
      connectionReady,
      credentialReferenceReady: true,
      quotaReady: true,
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

const selected = resolveGrowthControlProviderAdapter({ registryCandidates: [generic, exact], context });
assert.equal(selected.status, "selected");
assert.equal(selected.ready, true);
assert.equal(selected.selection.adapter_key, "beta.adapter");
assert.deepEqual(selected.selection.rank_vector.slice(0, 6), [0, 1, 1, 1, 1, 1]);
assert.equal(selected.ready_candidate_count, 2);
assert.equal(selected.authority_granted, false);
assert.equal(selected.provider_calls, false);
assert.equal(selected.provider_dispatch_allowed, false);
assert.equal(selected.provider_apply_allowed, false);
assert.equal(selected.external_writes, false);
assert.equal(selected.secrets_included, false);
assert.match(selected.resolution_sha256, /^[a-f0-9]{64}$/);
assert.equal(Object.isFrozen(selected), true);
assert.equal(Object.isFrozen(selected.selection), true);

const preferred = resolveGrowthControlProviderAdapter({
  registryCandidates: [generic, exact],
  context: { ...context, preferredAdapterKey: "alpha.adapter" },
});
assert.equal(preferred.selection.adapter_key, "alpha.adapter");
assert.equal(preferred.selection.rank_vector[0], 1);

const reordered = resolveGrowthControlProviderAdapter({ registryCandidates: [exact, generic], context });
assert.equal(reordered.resolution_sha256, selected.resolution_sha256);
assert.deepEqual(reordered.selection, selected.selection);

const tiedA = candidate({
  adapterKey: "delta.adapter",
  versionId: "adapter-version-delta-01",
  bindingRef: "binding-delta-01",
  version: 3,
  bindingPriority: 50,
  healthScore: 95,
  scope: { tenantId: "tenant-adapter-01" },
});
const tiedB = candidate({
  adapterKey: "gamma.adapter",
  versionId: "adapter-version-gamma-01",
  bindingRef: "binding-gamma-01",
  version: 3,
  bindingPriority: 50,
  healthScore: 95,
  scope: { tenantId: "tenant-adapter-01" },
});
const ambiguous = resolveGrowthControlProviderAdapter({ registryCandidates: [tiedB, tiedA], context });
assert.equal(ambiguous.status, "ambiguous");
assert.equal(ambiguous.ready, false);
assert.equal(ambiguous.blocker, "ADAPTER_SELECTION_AMBIGUOUS");
assert.equal(ambiguous.selection, null);
assert.deepEqual(ambiguous.tied_top_candidates.map((item) => item.adapter_key), ["delta.adapter", "gamma.adapter"]);
const ambiguousReordered = resolveGrowthControlProviderAdapter({ registryCandidates: [tiedA, tiedB], context });
assert.equal(ambiguousReordered.resolution_sha256, ambiguous.resolution_sha256);

const blocked = resolveGrowthControlProviderAdapter({
  registryCandidates: [
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
  ],
  context,
});
assert.equal(blocked.status, "blocked");
assert.equal(blocked.blocker, "ADAPTER_NOT_READY");
assert.equal(blocked.ready_candidate_count, 0);
const codes = new Set(blocked.candidates.flatMap((item) => item.blockers.map((entry) => entry.code)));
[
  "ADAPTER_METHOD_REQUIRED", "ADAPTER_HEALTH_EVIDENCE_STALE", "ADAPTER_CERTIFICATION_EXPIRED",
  "ADAPTER_SHADOW_EFFECT_FORBIDDEN", "ADAPTER_CONNECTION_NOT_READY", "ADAPTER_SCOPE_MISMATCH",
].forEach((code) => assert.equal(codes.has(code), true));

const shadowPreview = resolveGrowthControlProviderAdapter({
  registryCandidates: [candidate({
    adapterKey: "shadow.preview",
    versionId: "adapter-version-shadow-preview",
    bindingRef: "binding-shadow-preview",
    rolloutMode: "shadow",
  })],
  context: { ...context, dispatchRequested: false, applyRequested: false },
});
assert.equal(shadowPreview.status, "selected");

assert.throws(
  () => resolveGrowthControlProviderAdapter({ registryCandidates: [{ ...generic, api_key: "forbidden" }], context }),
  (error) => error?.code === "GROWTH_CONTROL_ADAPTER_SENSITIVE_INPUT",
);
assert.throws(
  () => resolveGrowthControlProviderAdapter({ registryCandidates: [generic, { ...generic }], context }),
  (error) => error?.code === "GROWTH_CONTROL_ADAPTER_REGISTRY_INVALID",
);

assert.equal(growthControlProviderAdapterResolverContract.equal_top_rank, "ADAPTER_SELECTION_AMBIGUOUS");
assert.equal(growthControlProviderAdapterResolverContract.stable_identity_only_orders_evidence, true);
assert.equal(growthControlProviderAdapterResolverContract.authority_granted, false);
assert.equal(growthControlProviderAdapterResolverContract.provider_calls, false);
assert.equal(growthControlProviderAdapterResolverContract.provider_dispatch_allowed, false);
assert.equal(growthControlProviderAdapterResolverContract.secrets_included, false);

console.log("growth control provider adapter resolver tests passed");
