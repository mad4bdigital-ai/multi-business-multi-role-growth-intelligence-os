import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";

import {
  _testingTenantGrowthControlPlaneRoutes
} from "./routes/tenantGrowthControlPlaneRoutes.js";
import { createTenantGrowthControlProjectionService } from "./src/application/growthControlPlane/tenantGrowthControlProjectionService.js";
import {
  _testingTenantGrowthControlProjection,
  buildTenantGrowthControlProjectionScope,
  decodeTenantGrowthControlCursor,
  encodeTenantGrowthControlCursor,
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
  is_admin: false
};

const encoded = encodeTenantGrowthControlCursor(25);
assert.equal(encoded, "MjU");
assert.equal(decodeTenantGrowthControlCursor(encoded), 25);
assert.throws(
  () => decodeTenantGrowthControlCursor("%%%"),
  (error) => error.code === "TENANT_GROWTH_CONTROL_CURSOR_INVALID" && error.status === 400
);

const scope = buildTenantGrowthControlProjectionScope({
  auth,
  membership: { tenantRole: "member" },
  workspace: { linkedBrandKey: BRAND_KEY, bootstrapStatus: "ready" },
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY
});
assert.deepEqual(scope, {
  tenantId: TENANT_ID,
  userId: USER_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  tenantRole: "member",
  workspaceBootstrapStatus: "ready"
});
assert.throws(
  () => buildTenantGrowthControlProjectionScope({
    auth: { ...auth, is_admin: true },
    membership: { tenantRole: "member" },
    workspace: { linkedBrandKey: BRAND_KEY, bootstrapStatus: "ready" },
    workspaceId: WORKSPACE_ID,
    brandKey: BRAND_KEY
  }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_USER_JWT_REQUIRED" && error.status === 401
);
assert.throws(
  () => buildTenantGrowthControlProjectionScope({
    auth,
    membership: null,
    workspace: { linkedBrandKey: BRAND_KEY, bootstrapStatus: "ready" },
    workspaceId: WORKSPACE_ID,
    brandKey: BRAND_KEY
  }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_MEMBERSHIP_REQUIRED" && error.status === 403
);
assert.throws(
  () => buildTenantGrowthControlProjectionScope({
    auth,
    membership: { tenantRole: "member" },
    workspace: { linkedBrandKey: "other-brand", bootstrapStatus: "ready" },
    workspaceId: WORKSPACE_ID,
    brandKey: BRAND_KEY
  }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_BRAND_FORBIDDEN" && error.status === 403
);

const projectedVersion = projectTenantConfigurationVersion({
  config_version_id: "44444444-4444-4444-8444-444444444444",
  config_key: "growth.execution.policy",
  version_number: 2,
  scope_type: "brand",
  scope_key: `tenant:${TENANT_ID}:workspace:${WORKSPACE_ID}:brand:${BRAND_KEY}`,
  tenant_id: TENANT_ID,
  workspace_id: WORKSPACE_ID,
  brand_key: BRAND_KEY,
  activity_type_key: "travel",
  activity_binding_id: null,
  profile_key: null,
  workflow_key: null,
  workflow_version: null,
  workflow_node_id: null,
  plan_id: null,
  execution_id: null,
  lifecycle: "active",
  version_revision: 3,
  checksum_sha256: "a".repeat(64),
  effective_from: "2026-07-24T18:00:00Z",
  effective_to: null,
  created_at: "2026-07-24T17:00:00Z",
  values_json: { secret: "must-not-leak" },
  schema_json: { secret: "must-not-leak" },
  approved_by: "platform-admin"
});
assert.equal(projectedVersion.metadataOnly, true);
assert.equal(projectedVersion.secretsIncluded, false);
assert.equal(Object.hasOwn(projectedVersion, "values_json"), false);
assert.equal(Object.hasOwn(projectedVersion, "schema_json"), false);
assert.equal(Object.hasOwn(projectedVersion, "approved_by"), false);

const projectedBinding = projectTenantActivityBinding({
  activity_binding_id: "55555555-5555-4555-8555-555555555555",
  tenant_id: TENANT_ID,
  workspace_id: WORKSPACE_ID,
  brand_key: BRAND_KEY,
  activity_type_key: "travel",
  activity_pack_key: "travel.organic-growth",
  activity_pack_version: 1,
  markets_json: ["EG"],
  locales_json: ["ar-EG"],
  channels_json: ["organic-search"],
  objectives_json: ["qualified-leads"],
  allowed_capabilities_json: ["intent_map_generate"],
  status: "draft",
  created_at: "2026-07-24T17:00:00Z",
  updated_at: "2026-07-24T17:00:00Z",
  idempotency_key: "hidden",
  created_by: "hidden"
});
assert.equal(projectedBinding.metadataOnly, true);
assert.equal(projectedBinding.secretsIncluded, false);
assert.equal(Object.hasOwn(projectedBinding, "idempotency_key"), false);
assert.equal(Object.hasOwn(projectedBinding, "created_by"), false);

assert.deepEqual(
  _testingTenantGrowthControlProjection.normalizedPage({ limit: "2", cursor: encodeTenantGrowthControlCursor(4) }),
  { limit: 2, offset: 4 }
);
assert.throws(
  () => _testingTenantGrowthControlProjection.normalizedPage({ limit: "101" }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_LIMIT_INVALID" && error.status === 400
);

const repositoryCalls = [];
const repositoryStub = {
  async findActiveMembership(input) {
    repositoryCalls.push(["membership", input]);
    return { tenantRole: "member" };
  },
  async findAuthorizedWorkspace(input) {
    repositoryCalls.push(["workspace", input]);
    return { linkedBrandKey: BRAND_KEY, bootstrapStatus: "ready" };
  },
  async listConfigurationVersions(input) {
    repositoryCalls.push(["configurationVersions", input]);
    return [projectedVersion, { ...projectedVersion, configVersionId: "66666666-6666-4666-8666-666666666666" }];
  },
  async listActivityBindings(input) {
    repositoryCalls.push(["activityBindings", input]);
    return [projectedBinding];
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
assert(repositoryCalls.some(([name]) => name === "membership"));
assert(repositoryCalls.some(([name]) => name === "workspace"));

const sqlCalls = [];
const pool = {
  async query(statement, params) {
    sqlCalls.push({ statement, params });
    if (statement.includes("FROM tenant_memberships")) return [[{ tenant_role: "member" }]];
    if (statement.includes("FROM workspaces")) return [[{ linked_brand_key: BRAND_KEY, workspace_bootstrap_status: "ready" }]];
    return [[]];
  }
};
const repository = createTenantGrowthControlProjectionRepository({ pool });
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
assert(routeSource.includes("requireTenantProjectionPrincipal"));

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

console.log("tenant Growth Control Plane projection tests passed");
