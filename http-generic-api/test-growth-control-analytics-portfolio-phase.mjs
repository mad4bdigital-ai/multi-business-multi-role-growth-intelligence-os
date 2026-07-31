import assert from "node:assert/strict";

import {
  buildGrowthControlKpiCatalogProjection,
  buildGrowthControlPortfolioProjection,
  normalizeGrowthControlMetricObservation,
  validateGrowthControlKpiBinding,
  validateGrowthControlKpiDefinition,
} from "./src/domain/growthControlPlane/growthControlAnalytics.js";
import { createGrowthControlAnalyticsObservabilityService } from "./src/application/growthControlPlane/growthControlAnalyticsObservabilityService.js";

const now = "2026-07-31T00:00:00.000Z";
const definition = Object.freeze({
  kpiDefinitionId: "kpi-def-1",
  normalizedKpiKey: "portfolio.revenue",
  displayName: "Revenue",
  description: "Normalized portfolio revenue.",
  valueType: "currency",
  unitKey: "currency.usd",
  aggregation: "sum",
  direction: "higher_is_better",
  definitionVersion: 1,
  freshnessSeconds: 3600,
  status: "active",
  revision: 1,
  metadata: { owner: "growth_control_plane" },
});
const bindings = Object.freeze([
  Object.freeze({
    activityKpiBindingId: "binding-kpi-travel",
    activityBindingId: "activity-travel",
    activityTypeKey: "travel",
    activityPackKey: "travel.reference",
    nativeKpiKey: "travel.booking_revenue_usd",
    normalizedKpiKey: "portfolio.revenue",
    definitionVersion: 1,
    nativeUnitKey: "currency.usd",
    normalizedUnitKey: "currency.usd",
    conversionKind: "identity",
    scaleMultiplier: 1,
    mappingConfidence: 0.99,
    status: "active",
    revision: 1,
  }),
  Object.freeze({
    activityKpiBindingId: "binding-kpi-commerce",
    activityBindingId: "activity-commerce",
    activityTypeKey: "commerce",
    activityPackKey: "commerce.baseline",
    nativeKpiKey: "commerce.net_revenue_cents",
    normalizedKpiKey: "portfolio.revenue",
    definitionVersion: 1,
    nativeUnitKey: "currency.usd_cents",
    normalizedUnitKey: "currency.usd",
    conversionKind: "scale",
    scaleMultiplier: 0.01,
    mappingConfidence: 0.95,
    status: "active",
    revision: 1,
  }),
]);
const observations = Object.freeze([
  Object.freeze({
    observationId: "observation-travel",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    brandKey: "brand-a",
    activityBindingId: "activity-travel",
    nativeKpiKey: "travel.booking_revenue_usd",
    nativeValue: 100,
    weight: 1,
    periodStart: "2026-07-30T00:00:00.000Z",
    periodEnd: "2026-07-30T23:59:59.000Z",
    observedAt: "2026-07-30T23:59:59.000Z",
    confidence: 0.9,
    sourceSystemKey: "travel.analytics",
    sourceObservationId: "travel-row-1",
  }),
  Object.freeze({
    observationId: "observation-commerce",
    tenantId: "tenant-1",
    workspaceId: "workspace-2",
    brandKey: "brand-b",
    activityBindingId: "activity-commerce",
    nativeKpiKey: "commerce.net_revenue_cents",
    nativeValue: 25000,
    weight: 1,
    periodStart: "2026-07-30T00:00:00.000Z",
    periodEnd: "2026-07-30T23:59:59.000Z",
    observedAt: "2026-07-30T23:50:00.000Z",
    confidence: 0.8,
    sourceSystemKey: "commerce.analytics",
    sourceObservationId: "commerce-row-1",
  }),
]);
const persistedObservations = observations.map(({ sourceSystemKey, sourceObservationId, sourceEventId = null, ...item }) => Object.freeze({
  ...item,
  lineage: Object.freeze({
    source: Object.freeze({ sourceSystemKey, sourceObservationId, sourceEventId }),
  }),
}));

const typedDefinition = validateGrowthControlKpiDefinition(definition);
assert.match(typedDefinition.checksumSha256, /^[0-9a-f]{64}$/);
assert.equal(Object.isFrozen(typedDefinition), true);
const typedBinding = validateGrowthControlKpiBinding(bindings[1]);
assert.equal(typedBinding.conversionKind, "scale");
const normalized = normalizeGrowthControlMetricObservation(observations[1], { definition, binding: bindings[1], now });
assert.equal(normalized.normalizedValue, 250);
assert.equal(normalized.lineage.source.sourceSystemKey, "commerce.analytics");
assert.match(normalized.observationSha256, /^[0-9a-f]{64}$/);

const catalog = buildGrowthControlKpiCatalogProjection({ definitions: [definition], bindings });
assert.equal(catalog.definitions.length, 1);
assert.equal(catalog.bindings.length, 2);
assert.equal(catalog.readOnly, true);
assert.equal(catalog.externalWrites, false);

const projection = buildGrowthControlPortfolioProjection({ tenantId: "tenant-1", definitions: [definition], bindings, observations, now });
assert.equal(projection.observationCount, 2);
assert.equal(projection.series.length, 1);
assert.equal(projection.series[0].portfolioValue, 350);
assert.equal(projection.series[0].nativeDefinitions.length, 2);
assert.equal(projection.lineagePreserved, true);
assert.equal(projection.tenantIsolated, true);
assert.deepEqual(projection, buildGrowthControlPortfolioProjection({ tenantId: "tenant-1", definitions: [definition], bindings, observations, now }));

assert.throws(
  () => buildGrowthControlPortfolioProjection({
    tenantId: "tenant-1",
    definitions: [definition],
    bindings,
    observations: [...observations, { ...observations[0], observationId: "cross", tenantId: "tenant-2" }],
    now,
  }),
  (error) => error?.code === "GROWTH_CONTROL_KPI_CROSS_TENANT_OBSERVATION",
);
assert.throws(
  () => validateGrowthControlKpiBinding({ ...bindings[0], nativeUnitKey: "count.items", normalizedUnitKey: "percentage.rate", conversionKind: "identity" }),
  (error) => error?.code === "GROWTH_CONTROL_KPI_UNIT_MISMATCH",
);
assert.throws(
  () => validateGrowthControlKpiDefinition({ ...definition, metadata: { access_token: "forbidden" } }),
  (error) => error?.code === "GROWTH_CONTROL_SECRET_FIELD_FORBIDDEN",
);

let appendedObservation = null;
const repository = {
  async resolveTenantWorkspaceScope(input) {
    return Object.freeze({ tenantId: input.tenantId, tenantRole: "manager", workspaceId: input.workspaceId, brandKey: input.brandKey, bootstrapStatus: "ready" });
  },
  async listKpiDefinitions() { return [definition]; },
  async getKpiDefinition() { return definition; },
  async listActivityKpiBindings(input = {}) {
    return bindings.filter((item) => !input.activityBindingIds?.length || input.activityBindingIds.includes(item.activityBindingId));
  },
  async getActivityKpiBinding(input) { return bindings.find((item) => item.activityBindingId === input.activityBindingId && item.nativeKpiKey === input.nativeKpiKey) || null; },
  async listNormalizedMetricObservations(input) {
    return persistedObservations.filter((item) => item.tenantId === input.tenantId && (!input.workspaceIds?.length || input.workspaceIds.includes(item.workspaceId)) && (!input.brandKeys?.length || input.brandKeys.includes(item.brandKey)));
  },
  async listObservabilitySamples() { return []; },
  async listReconciliationFindings() { return []; },
  async appendNormalizedMetricObservation(input) { appendedObservation = input.observation; return input.observation; },
  async appendObservabilitySample(input) { return input.sample; },
  async appendDecisionEvidence(input) { return input.evidence; },
};
const service = createGrowthControlAnalyticsObservabilityService({ repository });
const tenantProjection = await service.projectTenantPortfolio(
  { mode: "user_jwt", user_id: "user-1", tenant_id: "tenant-1", is_admin: false },
  { workspaceId: "workspace-1", brandKey: "brand-a", normalizedKpiKeys: ["portfolio.revenue"], now },
);
assert.equal(tenantProjection.audience, "tenant");
assert.equal(tenantProjection.observationCount, 1);
assert.equal(tenantProjection.series[0].nativeDefinitions[0].sourceSystemKeys[0], "travel.analytics");
assert.equal(tenantProjection.otherTenantsIncluded, false);

const writeResult = await service.recordMetricObservation({ ...observations[0], idempotencyKey: "metric-write-1", now });
assert.equal(writeResult.sameCycleReadback, true);
assert.equal(writeResult.providerCalls, false);
assert.equal(appendedObservation.observationSha256, writeResult.observation.observationSha256);

const scopedBinding = Object.freeze({
  ...bindings[0],
  activityKpiBindingId: "binding-kpi-scoped",
  tenantId: "tenant-2",
  workspaceId: "workspace-2",
  brandKey: "brand-b",
});
const scopedRepository = {
  ...repository,
  async listActivityKpiBindings() { return [scopedBinding]; },
};
const scopedService = createGrowthControlAnalyticsObservabilityService({ repository: scopedRepository });
await assert.rejects(
  () => scopedService.recordMetricObservation({ ...observations[0], idempotencyKey: "metric-write-cross-scope", now }),
  (error) => error?.code === "GROWTH_CONTROL_KPI_BINDING_SCOPE_MISMATCH" && error?.status === 403,
);

const inactiveRepository = {
  ...repository,
  async getKpiDefinition() { return { ...definition, status: "draft" }; },
};
const inactiveService = createGrowthControlAnalyticsObservabilityService({ repository: inactiveRepository });
await assert.rejects(
  () => inactiveService.recordMetricObservation({ ...observations[0], idempotencyKey: "metric-write-inactive-definition", now }),
  (error) => error?.code === "GROWTH_CONTROL_KPI_DEFINITION_NOT_ACTIVE" && error?.status === 409,
);

const mismatchingRepository = { ...repository, async appendNormalizedMetricObservation() { return { observationSha256: "0".repeat(64) }; } };
const mismatchingService = createGrowthControlAnalyticsObservabilityService({ repository: mismatchingRepository });
await assert.rejects(
  () => mismatchingService.recordMetricObservation({ ...observations[0], idempotencyKey: "metric-write-2", now }),
  (error) => error?.code === "GROWTH_CONTROL_KPI_READBACK_MISMATCH",
);

console.log("Growth Control KPI analytics and portfolio phase contract passed.");
