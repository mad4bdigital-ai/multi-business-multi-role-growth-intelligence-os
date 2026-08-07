import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildOperationObservabilityDashboard,
  getOperationObservabilityDashboard,
} from "../operationObservabilityService.js";

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

const dashboard = buildOperationObservabilityDashboard(rows, {
  principalScope: "tenant",
  hours: 24,
  sampleLimit: 100,
  generatedAt: new Date("2026-07-15T12:00:00Z"),
});
assert.equal(dashboard.summary.total_events, 2);
assert.equal(dashboard.summary.failed_events, 1);
assert.equal(dashboard.summary.average_latency_ms, 300);
assert.equal(dashboard.summary.p95_latency_ms, 500);
assert.equal(dashboard.summary.internal_call_count, 2);
assert.equal(dashboard.summary.discovery_call_count, 1);
assert.equal(dashboard.summary.retry_count, 1);
assert.equal(dashboard.source.raw_payloads_included, false);
assert.equal(dashboard.secrets_included, false);

const calls = [];
const pool = {
  async query(sql, params) {
    calls.push({ sql, params });
    return [rows];
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
assert.match(openapi, /secrets_included/);

console.log("operation observability service tests passed");