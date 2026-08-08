import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildOperationObservabilityDashboard,
  getOperationObservabilityDashboard,
} from "../operationObservabilityService.js";
import { buildCapabilityDriftSignals } from "../capabilityDriftSignalProjection.js";

const rows = [
  {
    duration_seconds: "0.10",
    execution_status: "completed",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_get_git_ref_head",
    tool_key: "runtime_endpoint_call",
    action_key: "repo.change.preview",
    source_layer: "operation_orchestrator",
  },
  {
    duration_seconds: "0.50",
    execution_status: "failed",
    failure_reason: "provider timeout",
    recovery_status: "retrying",
    recovery_action: "retry with backoff",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_create_tree",
    tool_key: "runtime_endpoint_call",
    action_key: "repo.change.execute",
    source_layer: "operation_orchestrator",
  },
];

const capabilityGapRows = [
  {
    capability_key: "tenant_tool.wordpress.publish",
    display_name: "WordPress Publish",
    capability_family: "tenant_tool",
    source_table: "tenant_platform_endpoint_tools",
    source_key: "wordpress.publish",
    operation_class: "tenant_tool_dispatch",
    risk_class: "C",
    runtime_status: "active",
    exposure_scope: "tenant",
    evidence_ref: null,
    gap_key: "authority_evidence_missing",
    gap_severity: "high",
    gap_description: "Capability requires resource authority evidence before mutation or certification.",
    maturity_status: "exported",
    maturity_score: 6,
    gap_flags: "authority_evidence_missing",
  },
  {
    capability_key: "admin_tool.internal.repair",
    display_name: "Internal Repair",
    capability_family: "admin_tool",
    source_table: "admin_platform_endpoint_tools",
    source_key: "internal.repair",
    operation_class: "state_changing",
    risk_class: "D",
    runtime_status: "active",
    exposure_scope: "admin",
    evidence_ref: null,
    gap_key: "active_export_missing",
    gap_severity: "medium",
    gap_description: "Capability has no active export row.",
    maturity_status: "runtime_exists",
    maturity_score: 4,
    gap_flags: "active_export_missing",
  },
];

const tenantSignals = buildCapabilityDriftSignals(capabilityGapRows, {
  principalScope: "tenant",
  tenantId: "tenant-a",
  generatedAt: new Date("2026-07-15T12:00:00Z"),
});
assert.equal(tenantSignals.length, 1, "tenant projection must hide admin/internal capability gaps");
assert.equal(tenantSignals[0].tenant_id, "tenant-a");
assert.equal(tenantSignals[0].resource.key, "tenant_tool.wordpress.publish");
assert.equal(tenantSignals[0].severity, "high");
assert.equal(tenantSignals[0].auto_repair.eligible, false);
assert.equal(tenantSignals[0].auto_repair.repair_class, "platform_admin_required");
assert.equal(tenantSignals[0].persistence.status, "snapshot_only");
assert.equal(tenantSignals[0].admin_evidence, null);
assert.equal(tenantSignals[0].secrets_included, false);
assert.equal(
  tenantSignals[0].dedupe_key,
  buildCapabilityDriftSignals(capabilityGapRows, { principalScope: "tenant", tenantId: "tenant-a", generatedAt: new Date("2026-07-16T12:00:00Z") })[0].dedupe_key,
  "dedupe key must remain stable across observations",
);

const adminSignals = buildCapabilityDriftSignals(capabilityGapRows, {
  principalScope: "admin",
  generatedAt: new Date("2026-07-15T12:00:00Z"),
});
assert.equal(adminSignals.length, 2);
assert.equal(adminSignals[1].admin_evidence.source_table, "admin_platform_endpoint_tools");
assert.equal(adminSignals[1].tenant_id, null);

const dashboard = buildOperationObservabilityDashboard(rows, {
  principalScope: "tenant",
  tenantId: "tenant-a",
  hours: 24,
  sampleLimit: 100,
  generatedAt: new Date("2026-07-15T12:00:00Z"),
  capabilityGapRows,
});
assert.equal(dashboard.summary.total_events, 2);
assert.equal(dashboard.summary.failed_events, 1);
assert.equal(dashboard.summary.average_latency_ms, 300);
assert.equal(dashboard.summary.p95_latency_ms, 500);
assert.equal(dashboard.summary.internal_call_count, 2);
assert.equal(dashboard.summary.discovery_call_count, 1);
assert.equal(dashboard.summary.retry_count, 1);
assert.equal(dashboard.summary.capability_drift_signal_count, 1);
assert.equal(dashboard.signals.capability_drift.length, 1);
assert.equal(dashboard.signal_sources.capability_drift.ok, true);
assert.equal(dashboard.source.raw_payloads_included, false);
assert.equal(dashboard.secrets_included, false);

const calls = [];
const pool = {
  async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("FROM execution_log")) return [rows];
    if (sql.includes("FROM v_platform_capability_gaps")) return [[capabilityGapRows[0]]];
    throw new Error(`Unexpected query: ${sql}`);
  },
};
const tenantDashboard = await getOperationObservabilityDashboard(
  { hours: 48, sample_limit: 250 },
  {
    pool,
    auth: {
      mode: "user_jwt",
      tenant_id: "tenant-a",
      user_id: "user-a",
    },
    now: new Date("2026-07-15T12:00:00Z"),
  },
);
assert.equal(tenantDashboard.principal_scope, "tenant");
assert.deepEqual(calls[0].params, [48, "tenant-a", "user-a", 250]);
assert.match(calls[0].sql, /tenant_id = \? AND user_id = \?/);
assert.match(calls[1].sql, /c\.exposure_scope = 'tenant'/, "tenant drift source must filter to tenant-visible capabilities in SQL");
assert.equal(tenantDashboard.summary.capability_drift_signal_count, 1);
assert.equal(tenantDashboard.signal_sources.capability_drift.degraded, false);
assert.equal(tenantDashboard.signals.capability_drift[0].admin_evidence, null);

const degradedPool = {
  async query(sql) {
    if (sql.includes("FROM execution_log")) return [rows];
    if (sql.includes("FROM v_platform_capability_gaps")) {
      const error = new Error("view unavailable");
      error.code = "ER_NO_SUCH_TABLE";
      throw error;
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
};
const degradedDashboard = await getOperationObservabilityDashboard(
  { hours: 24, sample_limit: 100 },
  {
    pool: degradedPool,
    auth: { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" },
    now: new Date("2026-07-15T12:00:00Z"),
  },
);
assert.equal(degradedDashboard.ok, true, "capability drift source failure must not take down execution observability");
assert.equal(degradedDashboard.summary.capability_drift_signal_count, 0);
assert.equal(degradedDashboard.signal_sources.capability_drift.ok, false);
assert.equal(degradedDashboard.signal_sources.capability_drift.degraded, true);
assert.equal(degradedDashboard.signal_sources.capability_drift.error.code, "ER_NO_SUCH_TABLE");

const route = readFileSync(
  new URL("../routes/operationObservabilityRoutes.js", import.meta.url),
  "utf8",
);
assert.match(route, /"\/admin\/operations\/observability"/);
assert.match(route, /"\/tenant\/operations\/observability"/);
assert.match(route, /ACTIVE_TENANT_MEMBERSHIP_REQUIRED/);
assert.match(
  route,
  /const requireTenant = \[requireBackendApiKey, requireTenantObservabilityPrincipal\]\.filter\(Boolean\)/,
  "Tenant observability must parse and validate the bearer credential before membership scoping.",
);
assert.match(
  route,
  /"\/tenant\/operations\/observability",\s*\.\.\.requireTenant,/,
  "Tenant observability must use the authenticated tenant guard chain.",
);

const mount = readFileSync(
  new URL("../routes/repositoryAutomationRoutes.js", import.meta.url),
  "utf8",
);
assert.match(mount, /router\.use\(buildOperationObservabilityRoutes/);

const openapi = readFileSync(
  new URL("../openapi/operation-observability.yaml", import.meta.url),
  "utf8",
);
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /average_latency_ms/);
assert.match(openapi, /internal_call_count/);
assert.match(openapi, /discovery_call_count/);
assert.match(openapi, /retry_count/);
assert.match(openapi, /failed_events/);
assert.match(openapi, /capability_drift_signal_count/);
assert.match(openapi, /capability_drift/);
assert.match(openapi, /snapshot_only/);
assert.match(openapi, /secrets_included/);

console.log("operation observability service tests passed");
