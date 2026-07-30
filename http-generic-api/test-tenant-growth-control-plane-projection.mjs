import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

import {
  _testingTenantGrowthControlPlaneRoutes
} from "./routes/tenantGrowthControlPlaneRoutes.js";
import { createTenantGrowthControlProjectionService } from "./src/application/growthControlPlane/tenantGrowthControlProjectionService.js";
import {
  _testingTenantGrowthControlProjection,
  assertTenantGrowthControlAuth,
  encodeTenantGrowthControlCursor,
  normalizeTenantGrowthControlListQuery,
  projectTenantActivityBinding,
  projectTenantConfigurationVersion
} from "./src/domain/growthControlPlane/tenantGrowthControlProjection.js";
import { createTenantGrowthControlProjectionRepository } from "./src/infrastructure/growthControlPlane/tenantGrowthControlProjectionRepository.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const BRAND_KEY = "example-brand";

const auth = {
  mode: "user_jwt",
  user_id: USER_ID,
  tenant_id: TENANT_ID,
  tenant_role: "member",
  is_admin: false
};

const encoded = encodeTenantGrowthControlCursor(25);
assert.equal(encoded, "MjU");
assert.equal(_testingTenantGrowthControlProjection.decodeCursor(encoded), 25);
assert.throws(
  () => _testingTenantGrowthControlProjection.decodeCursor("%%%"),
  (error) => error.code === "TENANT_GROWTH_CONTROL_CURSOR_INVALID" && error.status === 400
);

assert.deepEqual(assertTenantGrowthControlAuth(auth), {
  userId: USER_ID,
  tenantId: TENANT_ID,
  tenantRole: "member"
});
assert.throws(
  () => assertTenantGrowthControlAuth({ ...auth, is_admin: true }),
  (error) => error.code === "TENANT_USER_JWT_REQUIRED" && error.status === 401
);
assert.deepEqual(
  normalizeTenantGrowthControlListQuery({
    workspaceId: WORKSPACE_ID,
    brandKey: BRAND_KEY,
    limit: "2",
    cursor: encodeTenantGrowthControlCursor(4)
  }),
  { workspaceId: WORKSPACE_ID, brandKey: BRAND_KEY, limit: 2, offset: 4 }
);
assert.throws(
  () => normalizeTenantGrowthControlListQuery({
    workspaceId: WORKSPACE_ID,
    brandKey: BRAND_KEY,
    limit: "101"
  }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_LIMIT_INVALID" && error.status === 400
);

const versionRow = {
  configVersionId: "44444444-4444-4444-8444-444444444444",
  configKey: "growth.execution.policy",
  versionNumber: 2,
  scopeType: "brand",
  scopeKey: `tenant:${TENANT_ID}:workspace:${WORKSPACE_ID}:brand:${BRAND_KEY}`,
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  activityTypeKey: "travel",
  activityBindingId: null,
  profileKey: null,
  workflowKey: null,
  workflowVersion: null,
  workflowNodeId: null,
  planId: null,
  executionId: null,
  lifecycle: "active",
  versionRevision: 3,
  checksumSha256: "a".repeat(64),
  effectiveFrom: "2026-07-24T18:00:00Z",
  effectiveTo: null,
  createdAt: "2026-07-24T17:00:00Z"
};
const projectedVersion = projectTenantConfigurationVersion(versionRow);
assert.equal(projectedVersion.metadataOnly, true);
assert.equal(projectedVersion.secretsIncluded, false);
assert.equal(Object.hasOwn(projectedVersion, "valuesJson"), false);
assert.equal(Object.hasOwn(projectedVersion, "schemaJson"), false);
assert.equal(Object.hasOwn(projectedVersion, "approvedBy"), false);
const projectedVersionWithSensitiveSource = projectTenantConfigurationVersion({
  ...versionRow,
  secret: "must-not-leak"
});
assert.equal(Object.hasOwn(projectedVersionWithSensitiveSource, "secret"), false);
assert.equal(projectedVersionWithSensitiveSource.secretsIncluded, false);

const bindingRow = {
  activityBindingId: "55555555-5555-4555-8555-555555555555",
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  activityTypeKey: "travel",
  activityPackKey: "travel.organic-growth",
  activityPackVersion: 1,
  markets: ["EG"],
  locales: ["ar-EG"],
  channels: ["organic-search"],
  objectives: ["qualified-leads"],
  allowedCapabilities: ["intent_map_generate"],
  status: "draft",
  createdAt: "2026-07-24T17:00:00Z",
  updatedAt: "2026-07-24T17:00:00Z"
};
const projectedBinding = projectTenantActivityBinding(bindingRow);
assert.equal(projectedBinding.metadataOnly, true);
assert.equal(projectedBinding.secretsIncluded, false);
assert.deepEqual(projectedBinding.markets, ["EG"]);
assert.equal(Object.hasOwn(projectedBinding, "idempotencyKey"), false);
assert.equal(Object.hasOwn(projectedBinding, "createdBy"), false);

const repositoryCalls = [];
const repositoryStub = {
  async resolveTenantWorkspaceScope(input) {
    repositoryCalls.push(["scope", input]);
    return {
      tenantId: TENANT_ID,
      tenantRole: "member",
      workspaceId: WORKSPACE_ID,
      workspaceKey: "example-workspace",
      workspaceType: "company",
      bootstrapStatus: "ready",
      brandKey: BRAND_KEY
    };
  },
  async listConfigurationVersions(input) {
    repositoryCalls.push(["configurationVersions", input]);
    return [versionRow, { ...versionRow, configVersionId: "66666666-6666-4666-8666-666666666666" }];
  },
  async listActivityBindings(input) {
    repositoryCalls.push(["activityBindings", input]);
    return [bindingRow];
  }
};

const service = createTenantGrowthControlProjectionService({ repository: repositoryStub });
const versionsResponse = await service.listConfigurationVersions(auth, {
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  limit: 1
});
assert.equal(versionsResponse.items.length, 1);
assert.equal(versionsResponse.page.hasMore, true);
assert.equal(versionsResponse.page.nextCursor, encodeTenantGrowthControlCursor(1));
assert.equal(versionsResponse.scope.tenantRole, "member");
assert.equal(versionsResponse.tenantFacing, true);
assert.equal(versionsResponse.providerCalls, false);
assert.equal(versionsResponse.externalWrites, false);
assert.equal(versionsResponse.secretsIncluded, false);

const bindingsResponse = await service.listActivityBindings(auth, {
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  limit: 25
});
assert.equal(bindingsResponse.items.length, 1);
assert.equal(bindingsResponse.page.hasMore, false);
assert.equal(bindingsResponse.providerCalls, false);
assert.equal(bindingsResponse.externalWrites, false);
assert.equal(bindingsResponse.secretsIncluded, false);
assert(repositoryCalls.some(([name]) => name === "scope"));
assert(repositoryCalls.some(([name]) => name === "configurationVersions"));
assert(repositoryCalls.some(([name]) => name === "activityBindings"));

const forbiddenRepositoryStub = {
  ...repositoryStub,
  async resolveTenantWorkspaceScope() {
    return null;
  }
};
const forbiddenService = createTenantGrowthControlProjectionService({ repository: forbiddenRepositoryStub });
await assert.rejects(
  forbiddenService.listActivityBindings(auth, {
    workspaceId: WORKSPACE_ID,
    brandKey: BRAND_KEY
  }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_SCOPE_FORBIDDEN" && error.status === 403
);

const sqlCalls = [];
const pool = {
  async query(statement, params) {
    sqlCalls.push({ statement, params });
    if (statement.includes("FROM memberships")) {
      return [[{
        tenant_id: TENANT_ID,
        tenant_role: "member",
        workspace_id: WORKSPACE_ID,
        workspace_key: "example-workspace",
        workspace_type: "company",
        bootstrap_status: "ready",
        linked_brand_key: BRAND_KEY
      }]];
    }
    return [[]];
  }
};
const repository = createTenantGrowthControlProjectionRepository({ pool });
const resolvedScope = await repository.resolveTenantWorkspaceScope({
  tenantId: TENANT_ID,
  userId: USER_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY
});
assert.equal(resolvedScope.workspaceId, WORKSPACE_ID);
assert.equal(resolvedScope.brandKey, BRAND_KEY);

await repository.listConfigurationVersions({
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  limit: 26,
  offset: 0
});
const versionSql = sqlCalls.at(-1).statement;
assert.equal(versionSql.includes("values_json"), false);
assert.equal(versionSql.includes("idempotency_key"), false);
assert.equal(versionSql.includes("approved_by"), false);
assert.match(versionSql, /tenant_id = \?/);
assert.match(versionSql, /workspace_id = \?/);
assert.match(versionSql, /brand_key = \?/);

const routesIndex = readFileSync("routes/index.js", "utf8");
assert(routesIndex.includes("buildTenantGrowthControlPlaneRoutes"));
assert(routesIndex.includes("app.use(buildTenantGrowthControlPlaneRoutes({ ...deps }))"));
const routeSource = readFileSync("routes/tenantGrowthControlPlaneRoutes.js", "utf8");
assert(routeSource.includes("/tenant/control-plane/configuration-versions"));
assert(routeSource.includes("/tenant/control-plane/activity-bindings"));
assert(routeSource.includes("requireTenantUserJwt"));

const tenantOpenApiSource = readFileSync("openapi/tenant-growth-control-plane.openapi.yaml", "utf8");
const tenantOpenApi = YAML.parse(tenantOpenApiSource);
assert.equal(tenantOpenApi.openapi, "3.1.0");
assert(tenantOpenApi.components.securitySchemes.userJwtAuth);
assert.deepEqual(tenantOpenApi.security, [{ userJwtAuth: [] }]);

const configurationVersionsOperation = tenantOpenApi.paths["/tenant/control-plane/configuration-versions"].get;
const activityBindingsOperation = tenantOpenApi.paths["/tenant/control-plane/activity-bindings"].get;
assert.equal(configurationVersionsOperation.operationId, "listTenantGrowthControlConfigurationVersions");
assert.equal(activityBindingsOperation.operationId, "listTenantGrowthControlActivityBindings");
for (const operation of [configurationVersionsOperation, activityBindingsOperation]) {
  assert.equal(operation["x-contract-completeness"], "canonical");
  assert.deepEqual(
    operation.parameters.map((parameter) => parameter.$ref),
    [
      "#/components/parameters/WorkspaceId",
      "#/components/parameters/BrandKey",
      "#/components/parameters/Limit",
      "#/components/parameters/Cursor"
    ]
  );
  for (const statusCode of ["200", "400", "401", "403", "500"]) {
    assert(operation.responses[statusCode]);
  }
  assert.equal(operation.responses["404"], undefined);
}

assert.equal(typeof _testingTenantGrowthControlPlaneRoutes.requireTenantProjectionPrincipal, "function");
assert.throws(
  () => _testingTenantGrowthControlPlaneRoutes.assertAllowedQuery({ workspaceId: WORKSPACE_ID, extra: "blocked" }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_QUERY_INVALID" && error.status === 400
);

console.log("tenant Growth Control Plane projection tests passed");
