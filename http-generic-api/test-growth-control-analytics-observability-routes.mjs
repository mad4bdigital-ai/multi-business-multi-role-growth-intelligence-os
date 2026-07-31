import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import express from "express";
import YAML from "yaml";

import {
  buildDynamicGrowthControlPlaneRoutes,
  _testingDynamicGrowthControlPlaneRoutes,
} from "./routes/dynamicGrowthControlPlaneRoutes.js";

assert.equal(_testingDynamicGrowthControlPlaneRoutes.booleanQuery("true"), true);
assert.equal(_testingDynamicGrowthControlPlaneRoutes.booleanQuery("false"), false);

const calls = [];
const controlPlaneService = Object.freeze({
  async listConfigurationDefinitions() { return { items: [], page: { nextCursor: null, hasMore: false }, secretsIncluded: false }; },
  async createConfigurationDefinition() { return {}; },
  async createConfigurationVersion() { return {}; },
  async resolveConfiguration() { return {}; },
  async validateConfigurationVersion() { return {}; },
  async createConfigurationLifecycleApprovalHold() { return {}; },
  async activateConfigurationVersion() { return {}; },
  async rollbackConfigurationVersion() { return {}; },
  async listActivityPacks() { return { items: [], page: { nextCursor: null, hasMore: false }, secretsIncluded: false }; },
  async createActivityPackDefinition() { return {}; },
  async createActivityPackVersion() { return {}; },
  async createBrandActivityBinding() { return {}; },
});
const uiProjectionService = Object.freeze({ async projectConfiguration() { return { secretsIncluded: false }; } });
const analyticsObservabilityService = Object.freeze({
  async projectKpiCatalog(input) {
    calls.push(["projectKpiCatalog", input]);
    return { contract: "mad4b.growth-control.kpi-catalog-projection.v1", definitions: [], bindings: [], catalogSha256: "a".repeat(64), readOnly: true, providerCalls: false, externalWrites: false, secretsIncluded: false };
  },
  async projectAdminPortfolio(input) {
    calls.push(["projectAdminPortfolio", input]);
    return { contract: "mad4b.growth-control.portfolio-projection.v1", tenantId: input.tenantId, workspaceIds: [], brandKeys: [], normalizedKpiKeys: [], observationCount: 0, series: [], projectionSha256: "b".repeat(64), readOnly: true, tenantIsolated: true, lineagePreserved: true, providerCalls: false, externalWrites: false, secretsIncluded: false };
  },
  async projectTenantPortfolio(auth, input) {
    calls.push(["projectTenantPortfolio", auth, input]);
    return { contract: "mad4b.growth-control.portfolio-projection.v1", tenantId: auth.tenant_id, workspaceIds: [input.workspaceId], brandKeys: [input.brandKey], normalizedKpiKeys: [], observationCount: 0, series: [], projectionSha256: "c".repeat(64), readOnly: true, tenantIsolated: true, lineagePreserved: true, providerCalls: false, externalWrites: false, secretsIncluded: false, audience: "tenant", tenantRole: "viewer", tenantSafe: true, otherTenantsIncluded: false };
  },
  async projectAdminOperationalHealth(input) {
    calls.push(["projectAdminOperationalHealth", input]);
    return { contract: "mad4b.growth-control.operational-dashboard.v1", audience: "admin", scope: { tenantId: input.tenantId || null, workspaceId: null, brandKeys: [] }, health: "healthy", sloResults: [], alerts: [], reconciliation: { findingCount: 0, openFindingCount: 0, criticalOpenCount: 0, findings: [] }, portfolioSummary: null, dashboardSha256: "d".repeat(64), readOnly: true, tenantSafe: false, platformInternalPolicyPayloadsIncluded: false, otherTenantsIncluded: false, providerCalls: false, externalWrites: false, secretsIncluded: false };
  },
  async projectTenantOperationalHealth(auth, input) {
    calls.push(["projectTenantOperationalHealth", auth, input]);
    return { contract: "mad4b.growth-control.operational-dashboard.v1", audience: "tenant", scope: { tenantId: auth.tenant_id, workspaceId: input.workspaceId, brandKeys: [input.brandKey] }, health: "healthy", sloResults: [], alerts: [], reconciliation: { findingCount: 0, openFindingCount: 0, criticalOpenCount: 0, findings: [] }, portfolioSummary: null, dashboardSha256: "e".repeat(64), readOnly: true, tenantSafe: true, platformInternalPolicyPayloadsIncluded: false, otherTenantsIncluded: false, providerCalls: false, externalWrites: false, secretsIncluded: false };
  },
  async recordMetricObservation(input) {
    calls.push(["recordMetricObservation", input]);
    return { observation: { observationId: input.observationId, observationSha256: "f".repeat(64), secretsIncluded: false }, idempotentReplay: false, sameCycleReadback: true, providerCalls: false, externalWrites: false, secretsIncluded: false };
  },
  async recordObservabilitySample(input) {
    calls.push(["recordObservabilitySample", input]);
    return { sample: { sampleId: input.sampleId, sampleSha256: "1".repeat(64), secretsIncluded: false }, sameCycleReadback: true, providerCalls: false, externalWrites: false, secretsIncluded: false };
  },
  async recordDecisionEvidence(input) {
    calls.push(["recordDecisionEvidence", input]);
    return { evidence: { requestId: input.requestId, evidenceSha256: "2".repeat(64), secretsIncluded: false }, telemetrySpanRecorded: true, sameCycleReadback: true, providerCalls: false, externalWrites: false, secretsIncluded: false };
  },
});

let backendChecks = 0;
let adminChecks = 0;
function requireBackendApiKey(req, res, next) {
  backendChecks += 1;
  if (req.headers["x-api-key"] !== "test-backend") return res.status(401).json({ error: { code: "missing_backend_api_key", message: "Missing backend key.", details: [], requestId: "test" }, secretsIncluded: false });
  return next();
}
function requireAdminPrincipal(req, res, next) {
  adminChecks += 1;
  if (req.auth?.is_admin !== true) return res.status(403).json({ error: { code: "admin_required", message: "Admin required.", details: [], requestId: "test" }, secretsIncluded: false });
  return next();
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  if (req.path.startsWith("/tenant/")) req.auth = { mode: "user_jwt", user_id: "user-1", tenant_id: "tenant-1", is_admin: false };
  else req.auth = { mode: "backend_api_key", principal_id: "admin-1", is_admin: true };
  next();
});
app.use(buildDynamicGrowthControlPlaneRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  service: controlPlaneService,
  uiProjectionService,
  analyticsObservabilityService,
  resolvePool: () => { throw new Error("SQL must not be resolved by route contract tests."); },
}));

const server = createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!path.startsWith("/tenant/")) headers["x-api-key"] = headers["x-api-key"] || "test-backend";
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  return fetch(`${base}${path}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
}

try {
  let response = await request("/admin/control-plane/analytics/kpis?normalizedKpiKeys=portfolio.revenue");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).contract, "mad4b.growth-control.kpi-catalog-projection.v1");
  assert.equal(backendChecks > 0, true);
  assert.equal(adminChecks > 0, true);

  response = await request("/admin/control-plane/analytics/portfolio?tenantId=tenant-1&unknown=true");
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "GROWTH_CONTROL_VALIDATION_ERROR");

  response = await request("/tenant/control-plane/analytics/portfolio?workspaceId=workspace-1&brandKey=brand-a");
  assert.equal(response.status, 200);
  const tenantPortfolio = await response.json();
  assert.equal(tenantPortfolio.tenantId, "tenant-1");
  assert.equal(tenantPortfolio.otherTenantsIncluded, false);

  response = await request("/tenant/control-plane/operations/dashboard?workspaceId=workspace-1&brandKey=brand-a&includePortfolio=true");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).tenantSafe, true);
  const tenantHealthCall = calls.find((item) => item[0] === "projectTenantOperationalHealth");
  assert.equal(tenantHealthCall[2].includePortfolio, true);

  response = await request("/internal/control-plane/operations/samples", {
    method: "POST",
    headers: { "idempotency-key": "sample-route-1" },
    body: { sampleId: "sample-1", metricKey: "growth_control.read_catalog.availability", environment: "development", value: 1, observedAt: "2026-07-31T00:00:00.000Z", sourceEvidenceSha256: "a".repeat(64) },
  });
  assert.equal(response.status, 201);
  const sampleCall = calls.find((item) => item[0] === "recordObservabilitySample");
  assert.equal(sampleCall[1].idempotencyKey, "sample-route-1");

  response = await request("/internal/control-plane/operations/decision-evidence", {
    method: "POST",
    headers: { "idempotency-key": "evidence-route-1" },
    body: { requestId: "request-1", traceId: "trace-1", gateResults: [], reasonCodes: [], durationMs: 1, resultClassification: "applied", readbackStatus: "confirmed" },
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).telemetrySpanRecorded, true);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const openApiSource = await fs.readFile(new URL("./openapi/growth-control-analytics-observability.openapi.yaml", import.meta.url), "utf8");
const openApi = YAML.parse(openApiSource);
assert.equal(openApi.openapi, "3.1.0");
for (const path of [
  "/admin/control-plane/analytics/kpis",
  "/admin/control-plane/analytics/portfolio",
  "/tenant/control-plane/analytics/portfolio",
  "/admin/control-plane/operations/dashboard",
  "/tenant/control-plane/operations/dashboard",
  "/internal/control-plane/analytics/observations",
  "/internal/control-plane/operations/samples",
  "/internal/control-plane/operations/decision-evidence",
]) assert.ok(openApi.paths[path], `Missing OpenAPI path ${path}`);
assert.deepEqual(openApi.paths["/admin/control-plane/analytics/kpis"].get.security, [
  { adminBearerAuth: [] },
  { backendApiKeyAuth: [] },
]);
assert.deepEqual(openApi.paths["/tenant/control-plane/analytics/portfolio"].get.security, [{ userJwtAuth: [] }]);
assert.deepEqual(openApi.paths["/internal/control-plane/operations/samples"].post.security, [
  { backendBearerAuth: [] },
  { backendApiKeyAuth: [] },
]);
const operationIds = Object.values(openApi.paths).flatMap((pathItem) => Object.values(pathItem).map((operation) => operation.operationId));
assert.equal(new Set(operationIds).size, operationIds.length);
assert.equal(openApi.components.schemas.AlertProjection.properties.autoRemediationAllowed.const, false);
assert.equal(openApi.components.schemas.PortfolioProjection.properties.tenantIsolated.const, true);

console.log("Growth Control analytics and observability routes/OpenAPI contract passed.");