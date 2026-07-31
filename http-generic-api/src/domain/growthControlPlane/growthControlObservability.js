import {
  GrowthControlPlaneError,
  assertNoSecretFields,
  requireCanonicalKey,
  stableSha256,
} from "./growthControlPlane.js";

const MAX_ITEMS = 10000;
const MAX_FINDINGS = 1000;
const MAX_GATES = 50;
const MAX_REASONS = 50;

export const GROWTH_CONTROL_OBSERVABILITY_METRIC_KEYS = Object.freeze([
  "growth_control.read_catalog.availability",
  "growth_control.plan_compile.availability",
  "growth_control.config_resolution.cache_hit_latency_ms",
  "growth_control.config_resolution.cold_latency_ms",
  "growth_control.workflow_compile.latency_ms",
  "growth_control.mutation_readback.coverage",
  "growth_control.invalidation.latency_ms",
  "growth_control.cross_scope_disclosure.count",
  "growth_control.secret_redaction_violation.count",
  "growth_control.unknown_effect_blind_retry.count",
  "growth_control.projection_drift.age_seconds",
  "growth_control.outbox.backlog",
]);

export const GROWTH_CONTROL_SLO_DEFINITIONS = Object.freeze([
  ["read_catalog_availability", "growth_control.read_catalog.availability", "ratio_min", 0.999, "high"],
  ["plan_compile_availability", "growth_control.plan_compile.availability", "ratio_min", 0.995, "high"],
  ["config_resolution_cache_hit_p95", "growth_control.config_resolution.cache_hit_latency_ms", "p95_max", 250, "high"],
  ["config_resolution_cold_p95", "growth_control.config_resolution.cold_latency_ms", "p95_max", 1000, "high"],
  ["workflow_compile_p95", "growth_control.workflow_compile.latency_ms", "p95_max", 2000, "high"],
  ["mutation_readback_coverage", "growth_control.mutation_readback.coverage", "ratio_min", 0.999, "critical"],
  ["invalidation_latency_p95", "growth_control.invalidation.latency_ms", "p95_max", 30000, "high"],
  ["cross_scope_disclosure_zero", "growth_control.cross_scope_disclosure.count", "sum_max", 0, "critical"],
  ["secret_redaction_violation_zero", "growth_control.secret_redaction_violation.count", "sum_max", 0, "critical"],
  ["unknown_effect_blind_retry_zero", "growth_control.unknown_effect_blind_retry.count", "sum_max", 0, "critical"],
].map(([sloKey, metricKey, evaluator, target, severity]) => Object.freeze({ sloKey, metricKey, evaluator, target, severity })));

function text(value, field, max = 191) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max) {
    throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_FIELD_INVALID", `${field} is required and must be at most ${max} characters.`, 422, [{ field, issue: "required_or_too_long" }]);
  }
  return normalized;
}
function optional(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
function number(value, field) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_FIELD_INVALID", `${field} must be a finite number.`, 422);
  return normalized;
}
function date(value, field) {
  const normalized = text(value, field, 64);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_DATE_INVALID", `${field} must be ISO-8601.`, 422);
  return Object.freeze({ value: new Date(timestamp).toISOString(), timestamp });
}
function reason(value, field) {
  const normalized = text(value, field, 120).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,119}$/.test(normalized)) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_REASON_INVALID", `${field} must be an uppercase reason code.`, 422);
  return normalized;
}
function bounded(value, field, limit) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > limit) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_LIMIT_EXCEEDED", `${field} is limited to ${limit} entries.`, 422);
  return value;
}
function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function gateResult(input, index) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_GATE_INVALID", `gateResults[${index}] must be an object.`, 422);
  assertNoSecretFields(input, `$.gateResults[${index}]`);
  const status = text(input.status, `gateResults[${index}].status`, 32);
  if (!["passed", "blocked", "failed", "not_applicable"].includes(status)) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_GATE_INVALID", `gateResults[${index}].status is unsupported.`, 422);
  return Object.freeze({
    gateKey: requireCanonicalKey(input.gateKey ?? input.gate_key, `gateResults[${index}].gateKey`),
    status,
    reasonCode: input.reasonCode == null ? null : reason(input.reasonCode, `gateResults[${index}].reasonCode`),
    evidenceRef: optional(input.evidenceRef ?? input.evidence_ref),
  });
}

export function buildGrowthControlDecisionEvidence(input = {}) {
  assertNoSecretFields(input, "$.decisionEvidence");
  const gateResults = bounded(input.gateResults ?? input.gate_results, "gateResults", MAX_GATES).map(gateResult).sort((a, b) => a.gateKey.localeCompare(b.gateKey));
  const reasonCodes = [...new Set(bounded(input.reasonCodes ?? input.reason_codes, "reasonCodes", MAX_REASONS).map((item, index) => reason(item, `reasonCodes[${index}]`)))].sort();
  const durationMs = number(input.durationMs ?? input.duration_ms ?? 0, "durationMs");
  if (durationMs < 0) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_DURATION_INVALID", "durationMs cannot be negative.", 422);
  const body = {
    contract: "mad4b.growth-control.decision-evidence.v1",
    requestId: text(input.requestId ?? input.request_id, "requestId"),
    traceId: text(input.traceId ?? input.trace_id, "traceId"),
    tenantId: optional(input.tenantId ?? input.tenant_id),
    workspaceId: optional(input.workspaceId ?? input.workspace_id),
    brandKey: optional(input.brandKey ?? input.brand_key),
    activityBindingId: optional(input.activityBindingId ?? input.activity_binding_id),
    planId: optional(input.planId ?? input.plan_id),
    runId: optional(input.runId ?? input.run_id),
    capabilityKey: input.capabilityKey == null ? null : requireCanonicalKey(input.capabilityKey, "capabilityKey"),
    workflowVersion: input.workflowVersion == null ? null : Number(input.workflowVersion),
    configSnapshotId: optional(input.configSnapshotId ?? input.config_snapshot_id),
    policySnapshotId: optional(input.policySnapshotId ?? input.policy_snapshot_id),
    selectedAdapterKey: input.selectedAdapterKey == null ? null : requireCanonicalKey(input.selectedAdapterKey, "selectedAdapterKey"),
    gateResults: Object.freeze(gateResults),
    reasonCodes: Object.freeze(reasonCodes),
    durationMs,
    resultClassification: text(input.resultClassification ?? input.result_classification, "resultClassification", 64),
    readbackStatus: text(input.readbackStatus ?? input.readback_status ?? "not_applicable", "readbackStatus", 64),
  };
  return Object.freeze({ ...body, evidenceSha256: stableSha256(body), bounded: true, providerPayloadIncluded: false, credentialsIncluded: false, secretsIncluded: false });
}

export function buildGrowthControlTelemetrySpan(input = {}) {
  const evidence = buildGrowthControlDecisionEvidence(input);
  const attributes = Object.freeze({
    contract: evidence.contract,
    activity_binding_id: evidence.activityBindingId,
    plan_id: evidence.planId,
    capability_key: evidence.capabilityKey,
    workflow_version: evidence.workflowVersion,
    config_snapshot_id: evidence.configSnapshotId,
    policy_snapshot_id: evidence.policySnapshotId,
    selected_adapter_key: evidence.selectedAdapterKey,
    gate_results: evidence.gateResults,
    reason_codes: evidence.reasonCodes,
    result_classification: evidence.resultClassification,
    readback_status: evidence.readbackStatus,
    evidence_sha256: evidence.evidenceSha256,
    secrets_included: false,
  });
  return Object.freeze({
    trace_id: evidence.traceId,
    request_id: evidence.requestId,
    tenant_id: evidence.tenantId,
    workspace_id: evidence.workspaceId,
    brand_key: evidence.brandKey,
    run_id: evidence.runId,
    span_name: "growth_control.decision",
    span_type: "internal",
    status: ["blocked", "failed"].includes(evidence.resultClassification) ? "error" : "ok",
    duration_ms: evidence.durationMs,
    attributes_json: attributes,
    providerHeadersIncluded: false,
    providerBodiesIncluded: false,
    secretsIncluded: false,
  });
}

export function validateGrowthControlObservabilitySample(input = {}, index = 0) {
  assertNoSecretFields(input, `$.samples[${index}]`);
  const metricKey = requireCanonicalKey(input.metricKey ?? input.metric_key, `samples[${index}].metricKey`);
  if (!GROWTH_CONTROL_OBSERVABILITY_METRIC_KEYS.includes(metricKey)) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_METRIC_UNSUPPORTED", `Unsupported metric: ${metricKey}.`, 422);
  const body = {
    sampleId: text(input.sampleId ?? input.sample_id, `samples[${index}].sampleId`, 64),
    metricKey,
    tenantId: optional(input.tenantId ?? input.tenant_id),
    workspaceId: optional(input.workspaceId ?? input.workspace_id),
    brandKey: optional(input.brandKey ?? input.brand_key),
    environment: text(input.environment ?? "development", `samples[${index}].environment`, 32),
    value: number(input.value, `samples[${index}].value`),
    weight: number(input.weight ?? 1, `samples[${index}].weight`),
    observedAt: date(input.observedAt ?? input.observed_at, `samples[${index}].observedAt`).value,
    sourceEvidenceSha256: text(input.sourceEvidenceSha256 ?? input.source_evidence_sha256, `samples[${index}].sourceEvidenceSha256`, 64).toLowerCase(),
  };
  if (body.weight <= 0 || !/^[0-9a-f]{64}$/.test(body.sourceEvidenceSha256)) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_SAMPLE_INVALID", "Sample weight and evidence hash are invalid.", 422);
  return Object.freeze({ ...body, sampleSha256: stableSha256(body), secretsIncluded: false });
}

function evaluateDefinition(definition, samples) {
  const values = samples.map((sample) => sample.value);
  let actual = null;
  if (values.length) {
    if (definition.evaluator === "ratio_min") actual = samples.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / samples.reduce((sum, sample) => sum + sample.weight, 0);
    else if (definition.evaluator === "p95_max") actual = p95(values);
    else if (definition.evaluator === "sum_max") actual = values.reduce((sum, value) => sum + value, 0);
  }
  const breached = actual == null ? false : definition.evaluator === "ratio_min" ? actual < definition.target : actual > definition.target;
  return Object.freeze({ ...definition, actual, sampleCount: samples.length, status: actual == null ? "insufficient_data" : breached ? "breached" : "met", breached });
}

export function evaluateGrowthControlSloSnapshot({ samples = [], tenantId = null, brandKeys = null, environment = null, windowStart, windowEnd } = {}) {
  if (!Array.isArray(samples) || samples.length > MAX_ITEMS) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_SAMPLE_LIMIT_EXCEEDED", `SLO evaluation is limited to ${MAX_ITEMS} samples.`, 422);
  const start = date(windowStart, "windowStart");
  const end = date(windowEnd, "windowEnd");
  if (end.timestamp < start.timestamp) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_WINDOW_INVALID", "windowEnd must not precede windowStart.", 422);
  const expectedTenant = tenantId == null ? null : String(tenantId);
  const brands = brandKeys == null ? null : new Set(brandKeys.map(String));
  const typed = samples.map(validateGrowthControlObservabilitySample);
  if (expectedTenant && typed.some((sample) => sample.tenantId && sample.tenantId !== expectedTenant)) throw new GrowthControlPlaneError("GROWTH_CONTROL_OBSERVABILITY_CROSS_TENANT_SAMPLE", "SLO evaluation rejected a cross-tenant sample.", 403);
  const selected = typed.filter((sample) => {
    const observed = Date.parse(sample.observedAt);
    return observed >= start.timestamp && observed <= end.timestamp
      && (!expectedTenant || sample.tenantId === expectedTenant)
      && (!brands || brands.has(sample.brandKey))
      && (environment == null || sample.environment === String(environment));
  });
  const results = GROWTH_CONTROL_SLO_DEFINITIONS.map((definition) => evaluateDefinition(definition, selected.filter((sample) => sample.metricKey === definition.metricKey)));
  const alerts = results.filter((item) => item.breached).map((item) => Object.freeze({
    alertKey: `growth_control.slo.${item.sloKey}`,
    severity: item.severity,
    status: "firing",
    reasonCode: `GROWTH_CONTROL_SLO_${item.sloKey.toUpperCase()}_BREACHED`,
    metricKey: item.metricKey,
    target: item.target,
    actual: item.actual,
    evidenceSha256: stableSha256({ sloKey: item.sloKey, target: item.target, actual: item.actual, sampleCount: item.sampleCount, windowStart: start.value, windowEnd: end.value }),
    autoRemediationAllowed: false,
    secretsIncluded: false,
  })).sort((a, b) => a.severity.localeCompare(b.severity) || a.alertKey.localeCompare(b.alertKey));
  const body = { contract: "mad4b.growth-control.slo-snapshot.v1", tenantId: expectedTenant, brandKeys: Object.freeze(brands ? [...brands].sort() : []), environment: environment == null ? null : String(environment), windowStart: start.value, windowEnd: end.value, sampleCount: selected.length, results: Object.freeze(results), alerts: Object.freeze(alerts) };
  const status = alerts.some((alert) => alert.severity === "critical") ? "critical" : alerts.length ? "degraded" : results.some((item) => item.status === "insufficient_data") ? "insufficient_data" : "healthy";
  return Object.freeze({ ...body, status, snapshotSha256: stableSha256(body), externalNotificationsSent: false, autoRemediationPerformed: false, providerCalls: false, externalWrites: false, secretsIncluded: false });
}

function finding(input, index) {
  assertNoSecretFields(input, `$.findings[${index}]`);
  const severity = text(input.severity, `findings[${index}].severity`, 32);
  const status = text(input.status, `findings[${index}].status`, 32);
  if (!["info", "low", "medium", "high", "critical"].includes(severity) || !["open", "acknowledged", "resolved", "blocked"].includes(status)) throw new GrowthControlPlaneError("GROWTH_CONTROL_RECONCILIATION_FINDING_INVALID", `findings[${index}] has unsupported severity or status.`, 422);
  return Object.freeze({
    findingId: text(input.findingId ?? input.finding_id, `findings[${index}].findingId`, 64),
    findingType: requireCanonicalKey(input.findingType ?? input.finding_type, `findings[${index}].findingType`),
    tenantId: optional(input.tenantId ?? input.tenant_id),
    workspaceId: optional(input.workspaceId ?? input.workspace_id),
    brandKey: optional(input.brandKey ?? input.brand_key),
    severity,
    status,
    reasonCode: reason(input.reasonCode ?? input.reason_code, `findings[${index}].reasonCode`),
    authorityRef: optional(input.authorityRef ?? input.authority_ref),
    evidenceRef: optional(input.evidenceRef ?? input.evidence_ref),
    detectedAt: date(input.detectedAt ?? input.detected_at, `findings[${index}].detectedAt`).value,
    highRisk: ["high", "critical"].includes(severity),
  });
}

export function buildGrowthControlReconciliationProjection({ findings = [], tenantId = null, brandKeys = null } = {}) {
  if (!Array.isArray(findings) || findings.length > MAX_FINDINGS) throw new GrowthControlPlaneError("GROWTH_CONTROL_RECONCILIATION_FINDING_LIMIT_EXCEEDED", `Reconciliation projection is limited to ${MAX_FINDINGS} findings.`, 422);
  const expectedTenant = tenantId == null ? null : String(tenantId);
  const brands = brandKeys == null ? null : new Set(brandKeys.map(String));
  const typed = findings.map(finding);
  if (expectedTenant && typed.some((item) => item.tenantId && item.tenantId !== expectedTenant)) throw new GrowthControlPlaneError("GROWTH_CONTROL_RECONCILIATION_CROSS_TENANT_FINDING", "Reconciliation rejected a cross-tenant finding.", 403);
  const selected = typed.filter((item) => (!expectedTenant || item.tenantId === expectedTenant) && (!brands || brands.has(item.brandKey))).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.findingId.localeCompare(b.findingId));
  const open = selected.filter((item) => item.status !== "resolved");
  const body = { contract: "mad4b.growth-control.reconciliation-projection.v1", tenantId: expectedTenant, brandKeys: Object.freeze(brands ? [...brands].sort() : []), findingCount: selected.length, openFindingCount: open.length, criticalOpenCount: open.filter((item) => item.severity === "critical").length, findings: Object.freeze(selected) };
  return Object.freeze({ ...body, projectionSha256: stableSha256(body), highRiskAutoRepairAllowed: false, silentRepairPerformed: false, readOnly: true, providerCalls: false, externalWrites: false, secretsIncluded: false });
}

function tenantFinding(item) {
  return Object.freeze({ findingId: item.findingId, findingType: item.findingType, brandKey: item.brandKey, severity: item.severity, status: item.status, reasonCode: item.reasonCode, detectedAt: item.detectedAt, secretsIncluded: false });
}

export function buildGrowthControlOperationalDashboard({ audience, scope = {}, sloSnapshot, reconciliation, portfolioSummary = null } = {}) {
  const normalizedAudience = text(audience, "audience", 32);
  if (!["admin", "tenant"].includes(normalizedAudience) || !sloSnapshot || !reconciliation) throw new GrowthControlPlaneError("GROWTH_CONTROL_DASHBOARD_INPUT_INVALID", "A valid audience, SLO snapshot and reconciliation projection are required.", 422);
  assertNoSecretFields({ scope, sloSnapshot, reconciliation, portfolioSummary }, "$.dashboard");
  const findings = normalizedAudience === "admin" ? reconciliation.findings : Object.freeze(reconciliation.findings.map(tenantFinding));
  const body = {
    contract: "mad4b.growth-control.operational-dashboard.v1",
    audience: normalizedAudience,
    scope: Object.freeze({ tenantId: optional(scope.tenantId ?? scope.tenant_id), workspaceId: optional(scope.workspaceId ?? scope.workspace_id), brandKeys: Object.freeze([...(scope.brandKeys || [])].map(String).sort()) }),
    health: sloSnapshot.status,
    sloResults: sloSnapshot.results,
    alerts: sloSnapshot.alerts,
    reconciliation: Object.freeze({ findingCount: reconciliation.findingCount, openFindingCount: reconciliation.openFindingCount, criticalOpenCount: reconciliation.criticalOpenCount, findings }),
    portfolioSummary: portfolioSummary == null ? null : Object.freeze({ observationCount: Number(portfolioSummary.observationCount || 0), seriesCount: Array.isArray(portfolioSummary.series) ? portfolioSummary.series.length : 0, staleObservationCount: Array.isArray(portfolioSummary.series) ? portfolioSummary.series.reduce((sum, item) => sum + Number(item.staleObservationCount || 0), 0) : 0, projectionSha256: portfolioSummary.projectionSha256 || null }),
  };
  return Object.freeze({ ...body, dashboardSha256: stableSha256(body), readOnly: true, tenantSafe: normalizedAudience === "tenant", platformInternalPolicyPayloadsIncluded: false, otherTenantsIncluded: false, providerCalls: false, externalWrites: false, secretsIncluded: false });
}

export const _testingGrowthControlObservability = Object.freeze({ MAX_ITEMS, MAX_FINDINGS, MAX_GATES, MAX_REASONS, text, number, date, reason, bounded, p95, gateResult, evaluateDefinition, finding, tenantFinding });
