import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runGrowthIntelligencePilot } from "./growthIntelligencePilot.js";
import {
  assessGrowthIntelligenceReadiness,
  decideGrowthIntelligenceAction,
  decideGrowthIntelligenceInsight,
  getGrowthIntelligenceMetrics,
  persistGrowthIntelligencePilot,
  persistGrowthIntelligenceReadinessAssessment,
} from "./growthIntelligenceRegistry.js";

const queries = [];
const connection = {
  async beginTransaction() { queries.push({ sql: "BEGIN", params: [] }); },
  async commit() { queries.push({ sql: "COMMIT", params: [] }); },
  async rollback() { queries.push({ sql: "ROLLBACK", params: [] }); },
  release() {},
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    return [{ affectedRows: 1 }];
  },
};
const pool = { async getConnection() { return connection; }, async query(...args) { return connection.query(...args); } };

const pilot = runGrowthIntelligencePilot({
  tenant_id: "tenant-product-001",
  brand_key: "brand_product",
  brand_registry_rows: [{
    brand_key: "brand_product",
    normalized_brand_name: "Product Brand",
    business_type_key: "saas",
    brand_core_required: "false",
    is_readable: "true",
    is_writable: "false",
  }],
  activity_type_registry_rows: [{
    business_activity_type_key: "saas",
    activity_type_name: "SaaS",
    status: "active",
  }],
  evidence: [{ source: "brand_context", summary: "The brand targets an identifiable SaaS audience." }],
});
const registry = await persistGrowthIntelligencePilot(pilot, { pool, requestedBy: "operator-1" });

assert.equal(registry.persistence_mode, "internal_registry");
assert.equal(registry.insight_count, pilot.report.growth_opportunities.length);
assert.equal(registry.action_count, pilot.report.prioritized_backlog.length);
assert.equal(registry.approval_holds.length, pilot.report.approval_queue_view.length);
assert.equal(registry.provider_writes, 0);
assert.equal(registry.external_sends, 0);
assert.equal(registry.secrets_included, false);
for (const table of [
  "workflow_runs",
  "growth_intelligence_reports",
  "growth_intelligence_insights",
  "growth_intelligence_actions",
  "approval_holds",
]) {
  assert(queries.some(({ sql }) => sql.includes(`INSERT INTO ${table}`)), `persistence must write ${table}`);
}
assert.equal(queries[0].sql, "BEGIN");
assert.equal(queries.at(-1).sql, "COMMIT");

const unsafe = structuredClone(pilot);
unsafe.readback.provider_writes = 1;
await assert.rejects(
  () => persistGrowthIntelligencePilot(unsafe, { pool }),
  /Only secret-free, no-provider-write, no-external-send pilots/
);

const decisionQueries = [];
const decisionConnection = {
  async beginTransaction() { decisionQueries.push({ sql: "BEGIN" }); },
  async commit() { decisionQueries.push({ sql: "COMMIT" }); },
  async rollback() { decisionQueries.push({ sql: "ROLLBACK" }); },
  release() {},
  async query(sql, params = []) {
    decisionQueries.push({ sql: String(sql), params });
    if (String(sql).includes("SELECT a.action_record_id")) {
      return [[{
        action_record_id: "record-1",
        action_id: "action-1",
        approval_hold_id: "hold-1",
        workflow_run_id: "run-1",
        approval_state: "held",
        hold_status: "open",
      }]];
    }
    if (String(sql).includes("SUM(approval_state = 'held')")) {
      return [[{ held_count: 0, rejected_count: 0 }]];
    }
    return [{ affectedRows: 1 }];
  },
};
const decisionResult = await decideGrowthIntelligenceAction({
  pool: { async getConnection() { return decisionConnection; }, query: decisionConnection.query.bind(decisionConnection) },
  tenantId: "tenant-product-001",
  reportId: pilot.report.report_id,
  actionId: "action-1",
  decision: "approved",
  decisionBy: "operator-1",
});
assert.equal(decisionResult.report_status, "approved");
assert.equal(decisionResult.workflow_status, "awaiting_review");
assert.equal(decisionResult.execution_dispatched, false);
assert.equal(decisionResult.provider_writes, 0);
assert(decisionQueries.some(({ sql }) => sql.includes("UPDATE approval_holds")));
assert(decisionQueries.some(({ sql }) => sql.includes("UPDATE growth_intelligence_actions")));
assert(decisionQueries.some(({ sql }) => sql.includes("UPDATE growth_intelligence_reports")));

const blockedReadiness = assessGrowthIntelligenceReadiness({
  report: { status: "approval_pending", secrets_included: 0 },
  insights: [{ evidence_status: "assumption", status: "proposed" }],
  actions: [{ approval_state: "held", priority_score: 4, readback_requirements_json: ["confirm"], provider_write: 0, external_send: 0, secrets_included: 0 }],
});
assert.equal(blockedReadiness.assessment_status, "blocked");
assert.equal(blockedReadiness.execution_allowed, false);
assert(blockedReadiness.blocking_gaps.some(({ control }) => control === "report_approved"));
assert(blockedReadiness.blocking_gaps.some(({ control }) => control === "all_insights_accepted"));
assert(blockedReadiness.blocking_gaps.some(({ control }) => control === "all_insights_evidence_backed"));
const malformedReadbackReadiness = assessGrowthIntelligenceReadiness({
  report: { status: "approved", secrets_included: 0 },
  insights: [{ evidence_status: "evidence_backed", status: "accepted" }],
  actions: [{ approval_state: "approved", priority_score: 4, readback_requirements_json: "{invalid", provider_write: 0, external_send: 0, secrets_included: 0 }],
});
assert.equal(malformedReadbackReadiness.assessment_status, "blocked");
assert(malformedReadbackReadiness.blocking_gaps.some(({ control }) => control === "all_actions_have_readback_requirements"));

const readyReadiness = assessGrowthIntelligenceReadiness({
  report: { status: "approved", secrets_included: 0 },
  insights: [{ evidence_status: "evidence_backed", status: "accepted" }],
  actions: [{ approval_state: "approved", priority_score: 4, readback_requirements_json: ["confirm"], provider_write: 0, external_send: 0, secrets_included: 0 }],
});
assert.equal(readyReadiness.assessment_status, "review_ready");
assert.equal(readyReadiness.blocking_gap_count, 0);
assert.equal(readyReadiness.execution_allowed, false);

const readinessQueries = [];
const readinessConnection = {
  async beginTransaction() { readinessQueries.push({ sql: "BEGIN" }); },
  async commit() { readinessQueries.push({ sql: "COMMIT" }); },
  async rollback() { readinessQueries.push({ sql: "ROLLBACK" }); },
  release() {},
  async query(sql, params = []) {
    readinessQueries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM growth_intelligence_reports")) return [[{ report_id: pilot.report.report_id, brand_key: "brand_product", status: "approved", secrets_included: 0 }]];
    if (String(sql).includes("FROM growth_intelligence_insights")) return [[{ evidence_status: "evidence_backed", status: "accepted" }]];
    if (String(sql).includes("FROM growth_intelligence_actions")) return [[{ approval_state: "approved", priority_score: 4, readback_requirements_json: ["confirm"], provider_write: 0, external_send: 0, secrets_included: 0 }]];
    return [{ affectedRows: 1 }];
  },
};
const readinessAssessment = await persistGrowthIntelligenceReadinessAssessment({
  pool: { async getConnection() { return readinessConnection; }, query: readinessConnection.query.bind(readinessConnection) },
  tenantId: "tenant-product-001",
  reportId: pilot.report.report_id,
  assessedBy: "operator-1",
});
assert.equal(readinessAssessment.assessment_status, "review_ready");
assert.equal(readinessAssessment.execution_allowed, false);
assert(readinessQueries.some(({ sql }) => sql.includes("INSERT INTO growth_intelligence_readiness_assessments")));
assert(readinessQueries.some(({ sql }) => sql.includes("UPDATE growth_intelligence_actions")));

const insightDecisionQueries = [];
const insightDecision = await decideGrowthIntelligenceInsight({
  pool: { async query(sql, params) { insightDecisionQueries.push({ sql: String(sql), params }); return [{ affectedRows: 1 }]; } },
  tenantId: "tenant-product-001",
  reportId: pilot.report.report_id,
  insightId: pilot.report.growth_opportunities[0].opportunity_id,
  decision: "accepted",
  decisionBy: "operator-1",
});
assert.equal(insightDecision.status, "accepted");
assert.equal(insightDecision.execution_dispatched, false);

const metricResponses = [
  [{ report_count: 2, approval_pending_report_count: 1, approved_report_count: 1 }],
  [{ insight_count: 6, evidence_backed_count: 5, assumption_count: 1, stale_count: 0, accepted_count: 3, rejected_count: 1, superseded_count: 1 }],
  [{ action_count: 6, held_action_count: 3, approved_action_count: 3, rejected_action_count: 0, provider_write_count: 0, external_send_count: 0, secrets_included_count: 0 }],
  [{ assessment_count: 2, blocked_assessment_count: 1, review_ready_assessment_count: 1 }],
];
const metrics = await getGrowthIntelligenceMetrics({
  pool: { async query() { return [metricResponses.shift()]; } },
  tenantId: "tenant-product-001",
});
assert.equal(metrics.reports.report_count, 2);
assert.equal(metrics.insights.evidence_backed_count, 5);
assert.equal(metrics.actions.held_action_count, 3);
assert.equal(metrics.readiness.review_ready_assessment_count, 1);
assert.deepEqual(metrics.quality, { evidence_coverage: 0.8333, insight_acceptance_rate: 0.5, action_approval_rate: 0.5, report_approval_rate: 0.5 });
assert.deepEqual(metrics.safety, { provider_write_count: 0, external_send_count: 0, secrets_included_count: 0 });

const migration = readFileSync("migrations/243_sprint68_growth_intelligence_product_registry.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const lifecycleSource = readFileSync("databaseTableLifecycle.js", "utf8");
const schema = JSON.parse(readFileSync("schemas/http-generic-api/growth-intelligence-report-v1.schema.json", "utf8"));
const openapi = readFileSync("openapi.yaml", "utf8");
const tenantGpt = readFileSync("openapi.tenant-gpt.auth.yaml", "utf8");
const workflowRoutes = readFileSync("routes/workflowOrchestrationRoutes.js", "utf8");
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
assert.equal((migration.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 4);
assert.match(migration, /ON DUPLICATE KEY UPDATE/);
assert.match(migration, /database_table_lifecycle_registry/);
assert.doesNotMatch(runner, /"243_sprint68_growth_intelligence_product_registry\.sql"/);
assert.match(lifecycleSource, /growth_intelligence_product_family/);
assert.match(lifecycleSource, /tableName === "growth_intelligence_actions" \? "approval_audit"/);
assert.equal(schema.properties.schema_version.const, "1.0.0");
for (const operationId of [
  "runGrowthIntelligencePilot",
  "listGrowthIntelligenceReports",
  "getGrowthIntelligenceReport",
  "getGrowthIntelligenceMetrics",
  "decideGrowthIntelligenceAction",
  "decideGrowthIntelligenceInsight",
  "createGrowthIntelligenceReadinessAssessment",
]) {
  assert.match(openapi, new RegExp(`operationId: ${operationId}`));
}
assert.doesNotMatch(tenantGpt, /growth-intelligence/);
assert.match(workflowRoutes, /growth_intelligence_specialized_decision_required/);
assert.match(workflowRoutes, /holdContext\.source === "growth_intelligence_registry"/);

console.log("growth intelligence product registry tests passed");
