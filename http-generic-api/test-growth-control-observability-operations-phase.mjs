import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  buildGrowthControlDecisionEvidence,
  buildGrowthControlOperationalDashboard,
  buildGrowthControlReconciliationProjection,
  buildGrowthControlTelemetrySpan,
  evaluateGrowthControlSloSnapshot,
  validateGrowthControlObservabilitySample,
} from "./src/domain/growthControlPlane/growthControlObservability.js";
import { createGrowthControlAnalyticsObservabilityService } from "./src/application/growthControlPlane/growthControlAnalyticsObservabilityService.js";

const decision = {
  requestId: "request-1",
  traceId: "trace-1",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  brandKey: "brand-a",
  activityBindingId: "activity-travel",
  planId: "plan-1",
  runId: "run-1",
  capabilityKey: "analytics.read",
  workflowVersion: 2,
  configSnapshotId: "config-snapshot-1",
  policySnapshotId: "policy-snapshot-1",
  selectedAdapterKey: "provider.analytics.reference",
  gateResults: [
    { gateKey: "resource.authority", status: "passed", evidenceRef: "evidence-resource-1" },
    { gateKey: "provider.certification", status: "passed", evidenceRef: "evidence-cert-1" },
  ],
  reasonCodes: ["GROWTH_CONTROL_DECISION_ALLOWED"],
  durationMs: 125,
  resultClassification: "applied",
  readbackStatus: "confirmed",
};
const evidence = buildGrowthControlDecisionEvidence(decision);
assert.equal(evidence.contract, "mad4b.growth-control.decision-evidence.v1");
assert.equal(evidence.gateResults.length, 2);
assert.match(evidence.evidenceSha256, /^[0-9a-f]{64}$/);
assert.equal(evidence.credentialsIncluded, false);
const span = buildGrowthControlTelemetrySpan(decision);
assert.equal(span.span_name, "growth_control.decision");
assert.equal(span.attributes_json.evidence_sha256, evidence.evidenceSha256);
assert.equal(span.providerBodiesIncluded, false);

const windowStart = "2026-07-31T00:00:00.000Z";
const windowEnd = "2026-07-31T01:00:00.000Z";
const sample = (sampleId, metricKey, value, observedAt = "2026-07-31T00:30:00.000Z") => ({
  sampleId,
  metricKey,
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  brandKey: "brand-a",
  environment: "development",
  value,
  weight: 1,
  observedAt,
  sourceEvidenceSha256: "a".repeat(64),
});
const samples = [
  sample("read-availability", "growth_control.read_catalog.availability", 0.9995),
  sample("compile-availability", "growth_control.plan_compile.availability", 0.998),
  sample("cache-latency-1", "growth_control.config_resolution.cache_hit_latency_ms", 150),
  sample("cache-latency-2", "growth_control.config_resolution.cache_hit_latency_ms", 260),
  sample("cold-latency", "growth_control.config_resolution.cold_latency_ms", 800),
  sample("workflow-latency", "growth_control.workflow_compile.latency_ms", 1700),
  sample("readback-coverage", "growth_control.mutation_readback.coverage", 1),
  sample("invalidation-latency", "growth_control.invalidation.latency_ms", 20000),
  sample("cross-scope", "growth_control.cross_scope_disclosure.count", 0),
  sample("secret-redaction", "growth_control.secret_redaction_violation.count", 0),
  sample("blind-retry", "growth_control.unknown_effect_blind_retry.count", 0),
];
const typedSample = validateGrowthControlObservabilitySample(samples[0]);
assert.match(typedSample.sampleSha256, /^[0-9a-f]{64}$/);
const snapshot = evaluateGrowthControlSloSnapshot({ samples, tenantId: "tenant-1", brandKeys: ["brand-a"], environment: "development", windowStart, windowEnd });
assert.equal(snapshot.status, "degraded");
assert.equal(snapshot.alerts.length, 1);
assert.equal(snapshot.alerts[0].metricKey, "growth_control.config_resolution.cache_hit_latency_ms");
assert.equal(snapshot.alerts[0].autoRemediationAllowed, false);
assert.equal(snapshot.externalNotificationsSent, false);

const findings = [
  {
    findingId: "finding-1",
    findingType: "projection.drift",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    brandKey: "brand-a",
    severity: "high",
    status: "open",
    reasonCode: "GROWTH_CONTROL_PROJECTION_DRIFT",
    authorityRef: "growth_control_config_versions",
    evidenceRef: "evidence-drift-1",
    detectedAt: "2026-07-31T00:25:00.000Z",
  },
  {
    findingId: "finding-2",
    findingType: "authority.duplicate_identity",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    brandKey: "brand-a",
    severity: "critical",
    status: "blocked",
    reasonCode: "GROWTH_CONTROL_DUPLICATE_ACTIVE_IDENTITY",
    authorityRef: "growth_control_kpi_definitions",
    evidenceRef: "evidence-identity-1",
    detectedAt: "2026-07-31T00:20:00.000Z",
  },
];
const reconciliation = buildGrowthControlReconciliationProjection({ findings, tenantId: "tenant-1", brandKeys: ["brand-a"] });
assert.equal(reconciliation.openFindingCount, 2);
assert.equal(reconciliation.criticalOpenCount, 1);
assert.equal(reconciliation.highRiskAutoRepairAllowed, false);
assert.equal(reconciliation.silentRepairPerformed, false);

const adminDashboard = buildGrowthControlOperationalDashboard({ audience: "admin", scope: { tenantId: "tenant-1", brandKeys: ["brand-a"] }, sloSnapshot: snapshot, reconciliation });
assert.equal(adminDashboard.audience, "admin");
assert.equal(adminDashboard.reconciliation.findings[0].authorityRef != null, true);
const tenantDashboard = buildGrowthControlOperationalDashboard({ audience: "tenant", scope: { tenantId: "tenant-1", workspaceId: "workspace-1", brandKeys: ["brand-a"] }, sloSnapshot: snapshot, reconciliation });
assert.equal(tenantDashboard.tenantSafe, true);
assert.equal(Object.hasOwn(tenantDashboard.reconciliation.findings[0], "authorityRef"), false);
assert.equal(tenantDashboard.platformInternalPolicyPayloadsIncluded, false);

assert.throws(
  () => evaluateGrowthControlSloSnapshot({ samples: [...samples, { ...samples[0], sampleId: "cross", tenantId: "tenant-2" }], tenantId: "tenant-1", windowStart, windowEnd }),
  (error) => error?.code === "GROWTH_CONTROL_OBSERVABILITY_CROSS_TENANT_SAMPLE",
);
assert.throws(
  () => buildGrowthControlDecisionEvidence({ ...decision, access_token: "forbidden" }),
  (error) => error?.code === "GROWTH_CONTROL_SECRET_FIELD_FORBIDDEN",
);

let storedSample = null;
let storedEvidence = null;
const repository = {
  async resolveTenantWorkspaceScope(input) { return { tenantId: input.tenantId, tenantRole: "viewer", workspaceId: input.workspaceId, brandKey: input.brandKey, bootstrapStatus: "ready" }; },
  async listKpiDefinitions() { return []; },
  async getKpiDefinition() { return null; },
  async listActivityKpiBindings() { return []; },
  async getActivityKpiBinding() { return null; },
  async listNormalizedMetricObservations() { return []; },
  async listObservabilitySamples() { return samples; },
  async listReconciliationFindings() { return findings; },
  async appendNormalizedMetricObservation(input) { return input.observation; },
  async appendObservabilitySample(input) { storedSample = input.sample; return input.sample; },
  async appendDecisionEvidence(input) { storedEvidence = input.evidence; return input.evidence; },
};
const service = createGrowthControlAnalyticsObservabilityService({ repository });
const tenantHealth = await service.projectTenantOperationalHealth(
  { mode: "user_jwt", user_id: "user-1", tenant_id: "tenant-1", is_admin: false },
  { workspaceId: "workspace-1", brandKey: "brand-a", environment: "development", windowStart, windowEnd },
);
assert.equal(tenantHealth.audience, "tenant");
assert.equal(tenantHealth.otherTenantsIncluded, false);

const sampleWrite = await service.recordObservabilitySample({ ...samples[0], idempotencyKey: "sample-write-1" });
assert.equal(sampleWrite.sameCycleReadback, true);
assert.equal(storedSample.sampleSha256, sampleWrite.sample.sampleSha256);
const evidenceWrite = await service.recordDecisionEvidence({ ...decision, idempotencyKey: "evidence-write-1" });
assert.equal(evidenceWrite.sameCycleReadback, true);
assert.equal(evidenceWrite.telemetrySpanRecorded, true);
assert.equal(storedEvidence.evidenceSha256, evidenceWrite.evidence.evidenceSha256);

const migration = await fs.readFile(new URL("./migrations/20260731_growth_control_analytics_observability_foundation.sql", import.meta.url), "utf8");
for (const table of [
  "growth_control_kpi_definitions",
  "growth_control_activity_kpi_bindings",
  "growth_control_normalized_metric_observations",
  "growth_control_observability_samples",
  "growth_control_decision_evidence",
  "growth_control_reconciliation_findings",
]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS \\`${table}\\``));
assert.doesNotMatch(migration, /\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
assert.match(migration, /migration_applied',FALSE/);
assert.match(migration, /secrets_included/);

const repositorySource = await fs.readFile(new URL("./src/infrastructure/growthControlPlane/growthControlAnalyticsObservabilityRepository.js", import.meta.url), "utf8");
assert.match(repositorySource, /beginTransaction/);
assert.match(repositorySource, /FOR UPDATE/);
assert.match(repositorySource, /commit\(\)/);
assert.match(repositorySource, /rollback\(\)/);
assert.match(repositorySource, /telemetry_spans/);
assert.doesNotMatch(repositorySource, /provider\.dispatch|external send|credential_payload/i);

console.log("Growth Control SLO, trace, dashboard, alert, and reconciliation phase contract passed.");
