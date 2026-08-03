import {
  GrowthControlPlaneError,
  assertNoSecretFields,
  requireCanonicalKey,
  stableSha256,
} from "./growthControlPlane.js";

export const GROWTH_CONTROL_KPI_AGGREGATIONS = Object.freeze([
  "sum", "average", "weighted_average", "minimum", "maximum", "latest",
]);
export const GROWTH_CONTROL_KPI_DIRECTIONS = Object.freeze([
  "higher_is_better", "lower_is_better", "target", "neutral",
]);
export const GROWTH_CONTROL_KPI_VALUE_TYPES = Object.freeze([
  "integer", "number", "ratio", "percentage", "currency", "duration",
]);

const MAX_NATIVE_DEFINITIONS = 100;
const MAX_PORTFOLIO_OBSERVATIONS = 5000;
const MAX_PORTFOLIO_GROUPS = 500;

function clean(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
function requiredText(value, field, maxLength = 191) {
  const normalized = clean(value);
  if (!normalized || normalized.length > maxLength) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_FIELD_INVALID", `${field} is required and must be at most ${maxLength} characters.`, 422, [{ field, issue: "required_or_too_long" }]);
  }
  return normalized;
}
function positiveInteger(value, field) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_FIELD_INVALID", `${field} must be a positive integer.`, 422, [{ field, issue: "positive_integer_required" }]);
  }
  return normalized;
}
function finiteNumber(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_FIELD_INVALID", `${field} must be a finite number.`, 422, [{ field, issue: "finite_number_required" }]);
  }
  return normalized;
}
function confidenceValue(value, field = "confidence") {
  const normalized = finiteNumber(value, field);
  if (normalized < 0 || normalized > 1) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_CONFIDENCE_INVALID", `${field} must be between 0 and 1.`, 422, [{ field, issue: "out_of_range" }]);
  }
  return normalized;
}
function isoDate(value, field) {
  const normalized = requiredText(value, field, 64);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_DATE_INVALID", `${field} must be an ISO-8601 timestamp.`, 422, [{ field, issue: "invalid_iso_date" }]);
  }
  return Object.freeze({ value: new Date(timestamp).toISOString(), timestamp });
}
function exactAllowed(value, allowed, field, code = "GROWTH_CONTROL_KPI_FIELD_INVALID") {
  const normalized = requiredText(value, field, 64);
  if (!allowed.includes(normalized)) {
    throw new GrowthControlPlaneError(code, `${field} is unsupported.`, 422, [{ field, issue: "unsupported", allowed }]);
  }
  return normalized;
}
function parseObject(value, field) {
  if (value == null || value === "") return {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    assertNoSecretFields(value, `$.${field}`);
    return value;
  }
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_object");
    assertNoSecretFields(parsed, `$.${field}`);
    return parsed;
  } catch {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_JSON_INVALID", `${field} must be a JSON object.`, 422, [{ field, issue: "invalid_json_object" }]);
  }
}

export function validateGrowthControlKpiDefinition(input = {}) {
  assertNoSecretFields(input, "$.kpiDefinition");
  const body = {
    kpiDefinitionId: requiredText(input.kpiDefinitionId ?? input.kpi_definition_id, "kpiDefinitionId", 64),
    normalizedKpiKey: requireCanonicalKey(input.normalizedKpiKey ?? input.normalized_kpi_key, "normalizedKpiKey"),
    displayName: requiredText(input.displayName ?? input.display_name, "displayName", 191),
    description: clean(input.description),
    valueType: exactAllowed(input.valueType ?? input.value_type, GROWTH_CONTROL_KPI_VALUE_TYPES, "valueType"),
    unitKey: requireCanonicalKey(input.unitKey ?? input.unit_key, "unitKey"),
    aggregation: exactAllowed(input.aggregation, GROWTH_CONTROL_KPI_AGGREGATIONS, "aggregation"),
    direction: exactAllowed(input.direction ?? "neutral", GROWTH_CONTROL_KPI_DIRECTIONS, "direction"),
    definitionVersion: positiveInteger(input.definitionVersion ?? input.definition_version, "definitionVersion"),
    freshnessSeconds: positiveInteger(input.freshnessSeconds ?? input.freshness_seconds ?? 86400, "freshnessSeconds"),
    status: exactAllowed(input.status ?? "active", ["draft", "ready", "active", "deprecated", "archived", "blocked"], "status"),
    revision: positiveInteger(input.revision ?? 1, "revision"),
    metadata: Object.freeze(parseObject(input.metadata ?? input.metadata_json, "metadata")),
  };
  return Object.freeze({ ...body, checksumSha256: stableSha256(body), secretsIncluded: false });
}

export function validateGrowthControlKpiBinding(input = {}) {
  assertNoSecretFields(input, "$.kpiBinding");
  const nativeUnitKey = requireCanonicalKey(input.nativeUnitKey ?? input.native_unit_key, "nativeUnitKey");
  const normalizedUnitKey = requireCanonicalKey(input.normalizedUnitKey ?? input.normalized_unit_key, "normalizedUnitKey");
  const conversionKind = exactAllowed(input.conversionKind ?? input.conversion_kind ?? "identity", ["identity", "scale"], "conversionKind", "GROWTH_CONTROL_KPI_CONVERSION_UNSUPPORTED");
  const scaleMultiplier = finiteNumber(input.scaleMultiplier ?? input.scale_multiplier ?? 1, "scaleMultiplier");
  if (scaleMultiplier <= 0) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_SCALE_INVALID", "scaleMultiplier must be greater than zero.", 422);
  if (conversionKind === "identity" && nativeUnitKey !== normalizedUnitKey) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_UNIT_MISMATCH", "Identity mappings require matching native and normalized units.", 422);
  }
  const body = {
    activityKpiBindingId: requiredText(input.activityKpiBindingId ?? input.activity_kpi_binding_id, "activityKpiBindingId", 64),
    activityBindingId: requiredText(input.activityBindingId ?? input.activity_binding_id, "activityBindingId", 64),
    activityTypeKey: requireCanonicalKey(input.activityTypeKey ?? input.activity_type_key, "activityTypeKey"),
    activityPackKey: requireCanonicalKey(input.activityPackKey ?? input.activity_pack_key, "activityPackKey"),
    nativeKpiKey: requireCanonicalKey(input.nativeKpiKey ?? input.native_kpi_key, "nativeKpiKey"),
    normalizedKpiKey: requireCanonicalKey(input.normalizedKpiKey ?? input.normalized_kpi_key, "normalizedKpiKey"),
    definitionVersion: positiveInteger(input.definitionVersion ?? input.definition_version, "definitionVersion"),
    nativeUnitKey,
    normalizedUnitKey,
    conversionKind,
    scaleMultiplier,
    mappingConfidence: confidenceValue(input.mappingConfidence ?? input.mapping_confidence ?? 1, "mappingConfidence"),
    status: exactAllowed(input.status ?? "active", ["draft", "ready", "active", "deprecated", "archived", "blocked"], "status"),
    revision: positiveInteger(input.revision ?? 1, "revision"),
  };
  return Object.freeze({ ...body, bindingSha256: stableSha256(body), secretsIncluded: false });
}

export function normalizeGrowthControlMetricObservation(input = {}, { definition, binding, now = new Date() } = {}) {
  const typedDefinition = validateGrowthControlKpiDefinition(definition);
  const typedBinding = validateGrowthControlKpiBinding(binding);
  assertNoSecretFields(input, "$.metricObservation");
  if (typedBinding.normalizedKpiKey !== typedDefinition.normalizedKpiKey || typedBinding.definitionVersion !== typedDefinition.definitionVersion || typedBinding.normalizedUnitKey !== typedDefinition.unitKey) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_BINDING_DEFINITION_MISMATCH", "The KPI binding does not match the selected normalized definition.", 422);
  }
  const activityBindingId = requiredText(input.activityBindingId ?? input.activity_binding_id, "activityBindingId", 64);
  const nativeKpiKey = requireCanonicalKey(input.nativeKpiKey ?? input.native_kpi_key, "nativeKpiKey");
  if (activityBindingId !== typedBinding.activityBindingId) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_ACTIVITY_BINDING_MISMATCH", "The observation does not belong to the selected activity binding.", 422);
  if (nativeKpiKey !== typedBinding.nativeKpiKey) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_NATIVE_KEY_MISMATCH", "The observation native KPI key does not match the selected mapping.", 422);
  const periodStart = isoDate(input.periodStart ?? input.period_start, "periodStart");
  const periodEnd = isoDate(input.periodEnd ?? input.period_end, "periodEnd");
  if (periodEnd.timestamp < periodStart.timestamp) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_PERIOD_INVALID", "periodEnd must be greater than or equal to periodStart.", 422);
  const observedAt = isoDate(input.observedAt ?? input.observed_at ?? periodEnd.value, "observedAt");
  const nowTimestamp = now instanceof Date ? now.getTime() : Date.parse(String(now));
  if (!Number.isFinite(nowTimestamp)) throw new TypeError("now must be a valid date.");
  const nativeValue = finiteNumber(input.nativeValue ?? input.native_value, "nativeValue");
  const normalizedValue = typedBinding.conversionKind === "scale" ? nativeValue * typedBinding.scaleMultiplier : nativeValue;
  const lineage = Object.freeze({
    definitionVersion: typedDefinition.definitionVersion,
    definitionChecksumSha256: typedDefinition.checksumSha256,
    activityKpiBindingId: typedBinding.activityKpiBindingId,
    bindingSha256: typedBinding.bindingSha256,
    source: Object.freeze({
      sourceSystemKey: requireCanonicalKey(input.sourceSystemKey ?? input.source_system_key, "sourceSystemKey"),
      sourceObservationId: requiredText(input.sourceObservationId ?? input.source_observation_id, "sourceObservationId", 191),
      sourceEventId: clean(input.sourceEventId ?? input.source_event_id),
    }),
  });
  const freshnessAgeSeconds = Math.max(0, Math.floor((nowTimestamp - observedAt.timestamp) / 1000));
  const body = {
    observationId: requiredText(input.observationId ?? input.observation_id, "observationId", 64),
    tenantId: requiredText(input.tenantId ?? input.tenant_id, "tenantId", 64),
    workspaceId: requiredText(input.workspaceId ?? input.workspace_id, "workspaceId", 64),
    brandKey: requiredText(input.brandKey ?? input.brand_key, "brandKey", 128),
    activityBindingId,
    activityTypeKey: typedBinding.activityTypeKey,
    normalizedKpiKey: typedDefinition.normalizedKpiKey,
    nativeKpiKey,
    definitionVersion: typedDefinition.definitionVersion,
    nativeUnitKey: typedBinding.nativeUnitKey,
    normalizedUnitKey: typedDefinition.unitKey,
    nativeValue,
    normalizedValue,
    weight: finiteNumber(input.weight ?? 1, "weight"),
    periodStart: periodStart.value,
    periodEnd: periodEnd.value,
    observedAt: observedAt.value,
    confidence: confidenceValue(input.confidence ?? 1),
    freshnessAgeSeconds,
    freshnessStatus: freshnessAgeSeconds > typedDefinition.freshnessSeconds ? "stale" : "fresh",
    lineage,
  };
  if (body.weight <= 0) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_WEIGHT_INVALID", "weight must be greater than zero.", 422);
  return Object.freeze({ ...body, observationSha256: stableSha256(body), secretsIncluded: false });
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
function aggregateValues(observations, aggregation) {
  if (!observations.length) return null;
  const values = observations.map((item) => item.normalizedValue);
  if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "weighted_average") {
    const denominator = observations.reduce((sum, item) => sum + item.weight, 0);
    return observations.reduce((sum, item) => sum + item.normalizedValue * item.weight, 0) / denominator;
  }
  if (aggregation === "minimum") return Math.min(...values);
  if (aggregation === "maximum") return Math.max(...values);
  if (aggregation === "latest") return [...observations].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || b.observationId.localeCompare(a.observationId))[0].normalizedValue;
  throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_AGGREGATION_UNSUPPORTED", `Unsupported KPI aggregation: ${aggregation}.`, 422);
}
function definitionMap(definitions) {
  const map = new Map();
  for (const definition of definitions || []) {
    const typed = validateGrowthControlKpiDefinition(definition);
    const key = `${typed.normalizedKpiKey}@${typed.definitionVersion}`;
    if (map.has(key)) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_DEFINITION_AMBIGUOUS", `Duplicate KPI definition identity: ${key}.`, 409);
    map.set(key, typed);
  }
  return map;
}
function bindingBaseKey(activityBindingId, nativeKpiKey) {
  return `${activityBindingId}:${nativeKpiKey}`;
}
function bindingVersionKey(activityBindingId, nativeKpiKey, definitionVersion) {
  return `${bindingBaseKey(activityBindingId, nativeKpiKey)}@${definitionVersion}`;
}
function bindingMap(bindings) {
  const map = new Map();
  for (const binding of bindings || []) {
    const typed = validateGrowthControlKpiBinding(binding);
    const key = bindingVersionKey(typed.activityBindingId, typed.nativeKpiKey, typed.definitionVersion);
    if (map.has(key)) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_BINDING_AMBIGUOUS", `Duplicate KPI mapping identity: ${key}.`, 409);
    map.set(key, typed);
  }
  return map;
}
function bindingVersionIndex(bindingsByKey) {
  const index = new Map();
  for (const binding of bindingsByKey.values()) {
    const key = bindingBaseKey(binding.activityBindingId, binding.nativeKpiKey);
    index.set(key, [...(index.get(key) || []), binding]);
  }
  return index;
}
function resolveObservationBinding(observation, bindingsByKey, bindingsByBaseKey) {
  const activityBindingId = String(observation.activityBindingId ?? observation.activity_binding_id ?? "");
  const nativeKpiKey = String(observation.nativeKpiKey ?? observation.native_kpi_key ?? "");
  const baseKey = bindingBaseKey(activityBindingId, nativeKpiKey);
  const rawDefinitionVersion = observation.definitionVersion ?? observation.definition_version ?? observation.lineage?.definitionVersion ?? observation.lineage_json?.definitionVersion;
  if (rawDefinitionVersion != null && rawDefinitionVersion !== "") {
    const definitionVersion = positiveInteger(rawDefinitionVersion, "definitionVersion");
    return bindingsByKey.get(bindingVersionKey(activityBindingId, nativeKpiKey, definitionVersion)) || null;
  }
  const candidates = bindingsByBaseKey.get(baseKey) || [];
  if (candidates.length > 1) {
    throw new GrowthControlPlaneError(
      "GROWTH_CONTROL_KPI_BINDING_VERSION_REQUIRED",
      "definitionVersion is required when multiple governed KPI mapping versions exist for an observation.",
      422,
      [{ field: "definitionVersion", issue: "required_for_versioned_mapping" }],
    );
  }
  return candidates[0] || null;
}

export function buildGrowthControlKpiCatalogProjection({ definitions = [], bindings = [], activityBindingIds = null } = {}) {
  const allowedBindings = activityBindingIds == null ? null : new Set(activityBindingIds.map(String));
  const typedDefinitions = [...definitionMap(definitions).values()].filter((item) => ["ready", "active", "deprecated"].includes(item.status)).sort((a, b) => a.normalizedKpiKey.localeCompare(b.normalizedKpiKey) || b.definitionVersion - a.definitionVersion);
  const typedBindings = [...bindingMap(bindings).values()].filter((item) => ["ready", "active", "deprecated"].includes(item.status)).filter((item) => !allowedBindings || allowedBindings.has(item.activityBindingId)).sort((a, b) => a.normalizedKpiKey.localeCompare(b.normalizedKpiKey) || a.activityTypeKey.localeCompare(b.activityTypeKey) || a.nativeKpiKey.localeCompare(b.nativeKpiKey) || b.definitionVersion - a.definitionVersion);
  const body = { contract: "mad4b.growth-control.kpi-catalog-projection.v1", definitions: typedDefinitions, bindings: typedBindings };
  return Object.freeze({ ...body, catalogSha256: stableSha256(body), readOnly: true, providerCalls: false, externalWrites: false, secretsIncluded: false });
}

export function buildGrowthControlPortfolioProjection({ tenantId, workspaceIds = null, brandKeys = null, normalizedKpiKeys = null, definitions = [], bindings = [], observations = [], now = new Date() } = {}) {
  const expectedTenantId = requiredText(tenantId, "tenantId", 64);
  if (!Array.isArray(observations) || observations.length > MAX_PORTFOLIO_OBSERVATIONS) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_OBSERVATION_LIMIT_EXCEEDED", `Portfolio projection is limited to ${MAX_PORTFOLIO_OBSERVATIONS} observations.`, 422);
  const definitionsByKey = definitionMap(definitions);
  const bindingsByKey = bindingMap(bindings);
  const bindingsByBaseKey = bindingVersionIndex(bindingsByKey);
  const workspaceFilter = workspaceIds == null ? null : new Set(workspaceIds.map(String));
  const brandFilter = brandKeys == null ? null : new Set(brandKeys.map(String));
  const kpiFilter = normalizedKpiKeys == null ? null : new Set(normalizedKpiKeys.map(String));
  const normalized = [];
  for (const observation of observations) {
    if (String(observation.tenantId ?? observation.tenant_id ?? "") !== expectedTenantId) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_CROSS_TENANT_OBSERVATION", "Portfolio projection rejected a cross-tenant observation.", 403);
    const binding = resolveObservationBinding(observation, bindingsByKey, bindingsByBaseKey);
    if (!binding) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_BINDING_NOT_FOUND", "No matching governed KPI mapping exists for an observation version.", 422);
    const definition = definitionsByKey.get(`${binding.normalizedKpiKey}@${binding.definitionVersion}`);
    if (!definition) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_DEFINITION_NOT_FOUND", "No matching normalized KPI definition exists for an observation.", 422);
    const item = normalizeGrowthControlMetricObservation(observation, { definition, binding, now });
    if (workspaceFilter && !workspaceFilter.has(item.workspaceId)) continue;
    if (brandFilter && !brandFilter.has(item.brandKey)) continue;
    if (kpiFilter && !kpiFilter.has(item.normalizedKpiKey)) continue;
    normalized.push(item);
  }
  const groups = new Map();
  for (const item of normalized) {
    const key = [item.normalizedKpiKey, item.definitionVersion, item.normalizedUnitKey, item.periodStart, item.periodEnd].join("|");
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  if (groups.size > MAX_PORTFOLIO_GROUPS) throw new GrowthControlPlaneError("GROWTH_CONTROL_KPI_GROUP_LIMIT_EXCEEDED", `Portfolio projection is limited to ${MAX_PORTFOLIO_GROUPS} KPI-period groups.`, 422);
  const series = [...groups.entries()].map(([groupKey, items]) => {
    const [normalizedKpiKey, definitionVersionText, unitKey, periodStart, periodEnd] = groupKey.split("|");
    const definition = definitionsByKey.get(`${normalizedKpiKey}@${definitionVersionText}`);
    const brandPoints = [...new Set(items.map((item) => item.brandKey))].sort().map((brandKey) => {
      const brandItems = items.filter((item) => item.brandKey === brandKey);
      return Object.freeze({
        brandKey,
        value: aggregateValues(brandItems, definition.aggregation),
        confidence: brandItems.reduce((sum, item) => sum + item.confidence, 0) / brandItems.length,
        observationCount: brandItems.length,
        staleObservationCount: brandItems.filter((item) => item.freshnessStatus === "stale").length,
        latestObservedAt: brandItems.map((item) => item.observedAt).sort().at(-1),
        lineageSha256: stableSha256(brandItems.map((item) => ({ observationId: item.observationId, observationSha256: item.observationSha256, nativeKpiKey: item.nativeKpiKey, nativeUnitKey: item.nativeUnitKey, lineage: item.lineage }))),
      });
    });
    const nativeDefinitions = [...new Map(items.map((item) => [`${item.activityTypeKey}:${item.nativeKpiKey}:${item.nativeUnitKey}:${item.definitionVersion}`, { activityTypeKey: item.activityTypeKey, nativeKpiKey: item.nativeKpiKey, nativeUnitKey: item.nativeUnitKey, definitionVersion: item.definitionVersion, sourceSystemKeys: [...new Set(items.filter((candidate) => candidate.activityTypeKey === item.activityTypeKey && candidate.nativeKpiKey === item.nativeKpiKey).map((candidate) => candidate.lineage.source.sourceSystemKey))].sort() }])).values()].slice(0, MAX_NATIVE_DEFINITIONS);
    return Object.freeze({
      normalizedKpiKey,
      definitionVersion: Number(definitionVersionText),
      unitKey,
      aggregation: definition.aggregation,
      direction: definition.direction,
      periodStart,
      periodEnd,
      portfolioValue: aggregateValues(items, definition.aggregation),
      portfolioConfidence: items.reduce((sum, item) => sum + item.confidence, 0) / items.length,
      observationCount: items.length,
      staleObservationCount: items.filter((item) => item.freshnessStatus === "stale").length,
      p95FreshnessAgeSeconds: percentile(items.map((item) => item.freshnessAgeSeconds), 95),
      brandPoints: Object.freeze(brandPoints),
      nativeDefinitions: Object.freeze(nativeDefinitions),
      lineagePreserved: true,
      rawMetricsMergedAcrossTenants: false,
    });
  }).sort((a, b) => a.normalizedKpiKey.localeCompare(b.normalizedKpiKey) || a.periodStart.localeCompare(b.periodStart) || a.periodEnd.localeCompare(b.periodEnd) || a.definitionVersion - b.definitionVersion);
  const body = { contract: "mad4b.growth-control.portfolio-projection.v1", tenantId: expectedTenantId, workspaceIds: Object.freeze(workspaceFilter ? [...workspaceFilter].sort() : []), brandKeys: Object.freeze(brandFilter ? [...brandFilter].sort() : []), normalizedKpiKeys: Object.freeze(kpiFilter ? [...kpiFilter].sort() : []), observationCount: normalized.length, series: Object.freeze(series) };
  return Object.freeze({ ...body, projectionSha256: stableSha256(body), readOnly: true, tenantIsolated: true, lineagePreserved: true, providerCalls: false, externalWrites: false, secretsIncluded: false });
}

export const _testingGrowthControlAnalytics = Object.freeze({ MAX_NATIVE_DEFINITIONS, MAX_PORTFOLIO_OBSERVATIONS, MAX_PORTFOLIO_GROUPS, requiredText, positiveInteger, finiteNumber, confidenceValue, isoDate, exactAllowed, parseObject, percentile, aggregateValues, definitionMap, bindingBaseKey, bindingVersionKey, bindingMap, bindingVersionIndex, resolveObservationBinding });
