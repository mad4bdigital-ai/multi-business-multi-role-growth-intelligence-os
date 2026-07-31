import {
  GrowthControlPlaneError,
} from "../../domain/growthControlPlane/growthControlPlane.js";
import {
  buildGrowthControlKpiCatalogProjection,
  buildGrowthControlPortfolioProjection,
  normalizeGrowthControlMetricObservation,
} from "../../domain/growthControlPlane/growthControlAnalytics.js";
import {
  buildGrowthControlDecisionEvidence,
  buildGrowthControlOperationalDashboard,
  buildGrowthControlReconciliationProjection,
  buildGrowthControlTelemetrySpan,
  evaluateGrowthControlSloSnapshot,
  validateGrowthControlObservabilitySample,
} from "../../domain/growthControlPlane/growthControlObservability.js";

function text(value, field, max = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_ANALYTICS_QUERY_INVALID", `${field} is required and must be at most ${max} characters.`, 400, [{ field, issue: "required_or_too_long" }]);
  }
  return normalized;
}
function list(value, field, { canonical = false } = {}) {
  if (value == null || value === "") return [];
  const source = Array.isArray(value) ? value : String(value).split(",");
  const normalized = [...new Set(source.map((item) => String(item).trim()).filter(Boolean))];
  if (normalized.length > 100) throw new GrowthControlPlaneError("GROWTH_CONTROL_ANALYTICS_QUERY_LIMIT_EXCEEDED", `${field} is limited to 100 entries.`, 400);
  if (canonical && normalized.some((item) => !/^[a-z][a-z0-9_.-]{2,127}$/.test(item))) throw new GrowthControlPlaneError("GROWTH_CONTROL_ANALYTICS_QUERY_INVALID", `${field} contains a non-canonical key.`, 400);
  return normalized.sort();
}
function limit(value, fallback = 1000) {
  const normalized = Number(value ?? fallback);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5000) throw new GrowthControlPlaneError("GROWTH_CONTROL_ANALYTICS_QUERY_INVALID", "limit must be an integer from 1 to 5000.", 400);
  return normalized;
}
function window(input = {}) {
  const end = new Date(input.windowEnd ?? input.window_end ?? Date.now());
  const start = new Date(input.windowStart ?? input.window_start ?? end.getTime() - 60 * 60 * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) throw new GrowthControlPlaneError("GROWTH_CONTROL_ANALYTICS_WINDOW_INVALID", "A valid ordered observation window is required.", 400);
  return Object.freeze({ windowStart: start.toISOString(), windowEnd: end.toISOString() });
}
function repositoryContract(repository) {
  const methods = [
    "resolveTenantWorkspaceScope",
    "listKpiDefinitions",
    "getKpiDefinition",
    "listActivityKpiBindings",
    "getActivityKpiBinding",
    "listNormalizedMetricObservations",
    "listObservabilitySamples",
    "listReconciliationFindings",
    "appendNormalizedMetricObservation",
    "appendObservabilitySample",
    "appendDecisionEvidence",
  ];
  if (!repository) throw new TypeError("Growth Control analytics repository is required.");
  for (const method of methods) if (typeof repository[method] !== "function") throw new TypeError(`Growth Control analytics repository must implement ${method}().`);
  return repository;
}
function tenantPrincipal(auth = {}) {
  if (auth.mode !== "user_jwt" || !auth.user_id || !auth.tenant_id || auth.is_admin === true) throw new GrowthControlPlaneError("TENANT_USER_JWT_REQUIRED", "A signed non-admin tenant user JWT is required.", 401);
  return Object.freeze({ userId: String(auth.user_id), tenantId: String(auth.tenant_id) });
}
async function tenantScope(repository, auth, input) {
  const principal = tenantPrincipal(auth);
  const workspaceId = text(input.workspaceId ?? input.workspace_id, "workspaceId", 64);
  const brandKey = text(input.brandKey ?? input.brand_key, "brandKey", 128);
  const scope = await repository.resolveTenantWorkspaceScope({ tenantId: principal.tenantId, userId: principal.userId, workspaceId, brandKey });
  if (!scope) throw new GrowthControlPlaneError("TENANT_GROWTH_CONTROL_SCOPE_FORBIDDEN", "The tenant workspace and brand scope is not available to this principal.", 403);
  return Object.freeze({ principal, scope });
}

export function createGrowthControlAnalyticsObservabilityService({ repository } = {}) {
  const store = repositoryContract(repository);

  async function projectPortfolio(input = {}, fixedScope = null) {
    const tenantId = fixedScope?.tenantId || text(input.tenantId ?? input.tenant_id, "tenantId", 64);
    const workspaceIds = fixedScope ? [fixedScope.workspaceId] : list(input.workspaceIds ?? input.workspace_ids, "workspaceIds");
    const brandKeys = fixedScope ? [fixedScope.brandKey] : list(input.brandKeys ?? input.brand_keys, "brandKeys");
    const normalizedKpiKeys = list(input.normalizedKpiKeys ?? input.normalized_kpi_keys, "normalizedKpiKeys", { canonical: true });
    const rowLimit = limit(input.limit, 5000);
    const definitions = await store.listKpiDefinitions({ normalizedKpiKeys, statuses: ["ready", "active", "deprecated"], limit: 1000 });
    const bindings = await store.listActivityKpiBindings({ tenantId, workspaceIds, brandKeys, normalizedKpiKeys, statuses: ["ready", "active", "deprecated"], limit: 5000 });
    const observations = await store.listNormalizedMetricObservations({ tenantId, workspaceIds, brandKeys, normalizedKpiKeys, periodStart: input.periodStart ?? input.period_start ?? null, periodEnd: input.periodEnd ?? input.period_end ?? null, limit: rowLimit });
    return buildGrowthControlPortfolioProjection({ tenantId, workspaceIds, brandKeys, normalizedKpiKeys, definitions, bindings, observations, now: input.now || new Date() });
  }

  async function projectAdminPortfolio(input = {}) {
    return projectPortfolio(input);
  }

  async function projectTenantPortfolio(auth, input = {}) {
    const { principal, scope } = await tenantScope(store, auth, input);
    const projection = await projectPortfolio(input, { tenantId: principal.tenantId, workspaceId: scope.workspaceId, brandKey: scope.brandKey });
    return Object.freeze({ ...projection, audience: "tenant", tenantRole: scope.tenantRole || null, tenantSafe: true, otherTenantsIncluded: false });
  }

  async function projectKpiCatalog(input = {}) {
    const normalizedKpiKeys = list(input.normalizedKpiKeys ?? input.normalized_kpi_keys, "normalizedKpiKeys", { canonical: true });
    const activityBindingIds = list(input.activityBindingIds ?? input.activity_binding_ids, "activityBindingIds");
    const definitions = await store.listKpiDefinitions({ normalizedKpiKeys, statuses: ["ready", "active", "deprecated"], limit: 1000 });
    const bindings = await store.listActivityKpiBindings({ tenantId: input.tenantId ?? input.tenant_id ?? null, workspaceIds: list(input.workspaceIds ?? input.workspace_ids, "workspaceIds"), brandKeys: list(input.brandKeys ?? input.brand_keys, "brandKeys"), activityBindingIds, normalizedKpiKeys, statuses: ["ready", "active", "deprecated"], limit: 5000 });
    return buildGrowthControlKpiCatalogProjection({ definitions, bindings, activityBindingIds: activityBindingIds.length ? activityBindingIds : null });
  }

  async function operationalHealth(input = {}, fixedScope = null, audience = "admin") {
    const observationWindow = window(input);
    const tenantId = fixedScope?.tenantId ?? input.tenantId ?? input.tenant_id ?? null;
    const workspaceIds = fixedScope ? [fixedScope.workspaceId] : list(input.workspaceIds ?? input.workspace_ids, "workspaceIds");
    const brandKeys = fixedScope ? [fixedScope.brandKey] : list(input.brandKeys ?? input.brand_keys, "brandKeys");
    const environment = input.environment == null ? null : String(input.environment);
    const samples = await store.listObservabilitySamples({ tenantId, workspaceIds, brandKeys, environment, windowStart: observationWindow.windowStart, windowEnd: observationWindow.windowEnd, limit: limit(input.sampleLimit ?? input.sample_limit, 5000) });
    const findings = await store.listReconciliationFindings({ tenantId, workspaceIds, brandKeys, statuses: ["open", "acknowledged", "blocked"], limit: limit(input.findingLimit ?? input.finding_limit, 1000) });
    const sloSnapshot = evaluateGrowthControlSloSnapshot({ samples, tenantId, brandKeys, environment, ...observationWindow });
    const reconciliation = buildGrowthControlReconciliationProjection({ findings, tenantId, brandKeys });
    let portfolioSummary = null;
    if (input.includePortfolio === true || input.include_portfolio === true) portfolioSummary = await projectPortfolio({ ...input, tenantId, workspaceIds, brandKeys }, fixedScope);
    return buildGrowthControlOperationalDashboard({ audience, scope: { tenantId, workspaceId: fixedScope?.workspaceId || null, brandKeys }, sloSnapshot, reconciliation, portfolioSummary });
  }

  async function projectAdminOperationalHealth(input = {}) {
    return operationalHealth(input, null, "admin");
  }

  async function projectTenantOperationalHealth(auth, input = {}) {
    const { principal, scope } = await tenantScope(store, auth, input);
    return operationalHealth(input, { tenantId: principal.tenantId, workspaceId: scope.workspaceId, brandKey: scope.brandKey }, "tenant");
  }

  async function recordMetricObservation(input = {}) {
    const idempotencyKey = text(input.idempotencyKey ?? input.idempotency_key, "idempotencyKey");
    const activityBindingId = text(input.activityBindingId ?? input.activity_binding_id, "activityBindingId", 64);
    const nativeKpiKey = text(input.nativeKpiKey ?? input.native_kpi_key, "nativeKpiKey", 128);
    const binding = await store.getActivityKpiBinding({ activityBindingId, nativeKpiKey });
    if (!binding) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_BINDING_NOT_FOUND", "No governed KPI binding exists for the observation.", 404);
    const definition = await store.getKpiDefinition({ normalizedKpiKey: binding.normalizedKpiKey, definitionVersion: binding.definitionVersion });
    if (!definition) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_DEFINITION_NOT_FOUND", "The governed KPI definition was not found.", 404);
    const observation = normalizeGrowthControlMetricObservation(input, { definition, binding, now: input.now || new Date() });
    const readback = await store.appendNormalizedMetricObservation({ observation, idempotencyKey });
    if (!readback || readback.observationSha256 !== observation.observationSha256) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_READBACK_MISMATCH", "Metric observation readback did not match the normalized observation.", 500);
    return Object.freeze({ observation: readback, idempotentReplay: Boolean(readback.idempotentReplay), sameCycleReadback: true, providerCalls: false, externalWrites: false, secretsIncluded: false });
  }

  async function recordDecisionEvidence(input = {}) {
    const idempotencyKey = text(input.idempotencyKey ?? input.idempotency_key, "idempotencyKey");
    const evidence = buildGrowthControlDecisionEvidence(input);
    const span = buildGrowthControlTelemetrySpan(input);
    const readback = await store.appendDecisionEvidence({ evidence, span, idempotencyKey });
    if (!readback || readback.evidenceSha256 !== evidence.evidenceSha256) throw new GrowthControlPlaneError("GROWTH_CONTROL_DECISION_EVIDENCE_READBACK_MISMATCH", "Decision evidence readback did not match the request.", 500);
    return Object.freeze({ evidence: readback, telemetrySpanRecorded: true, sameCycleReadback: true, providerCalls: false, externalWrites: false, secretsIncluded: false });
  }

  async function recordObservabilitySample(input = {}) {
    const idempotencyKey = text(input.idempotencyKey ?? input.idempotency_key, "idempotencyKey");
    const sample = validateGrowthControlObservabilitySample(input);
    const readback = await store.appendObservabilitySample({ sample, idempotencyKey });
    if (!readback || readback.sampleSha256 !== sample.sampleSha256) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_READBACK_MISMATCH", "Observability sample readback did not match the request.", 500);
    return Object.freeze({ sample: readback, sameCycleReadback: true, providerCalls: false, externalWrites: false, secretsIncluded: false });
  }

  return Object.freeze({ projectAdminPortfolio, projectTenantPortfolio, projectKpiCatalog, projectAdminOperationalHealth, projectTenantOperationalHealth, recordMetricObservation, recordDecisionEvidence, recordObservabilitySample });
}

export const _testingGrowthControlAnalyticsObservabilityService = Object.freeze({ text, list, limit, window, repositoryContract, tenantPrincipal, tenantScope });
