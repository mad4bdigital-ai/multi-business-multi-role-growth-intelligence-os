import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import {
  TenantGrowthControlProjectionError,
  assertTenantGrowthControlAuth,
  encodeTenantGrowthControlCursor,
  normalizeTenantGrowthControlListQuery,
  projectTenantActivityBinding,
  projectTenantConfigurationVersion
} from "./src/domain/growthControlPlane/tenantGrowthControlProjection.js";
import { createTenantGrowthControlProjectionService } from "./src/application/growthControlPlane/tenantGrowthControlProjectionService.js";
import { createTenantGrowthControlProjectionRepository } from "./src/infrastructure/growthControlPlane/tenantGrowthControlProjectionRepository.js";
import { _testingTenantGrowthControlPlaneRoutes } from "./routes/tenantGrowthControlPlaneRoutes.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const BRAND_KEY = "example-brand";
const VALID_AUTH = Object.freeze({
  mode: "user_jwt",
  user_id: USER_ID,
  tenant_id: TENANT_ID,
  tenant_role: "member",
  is_admin: false
});

assert.deepEqual(assertTenantGrowthControlAuth(VALID_AUTH), {
  userId: USER_ID,
  tenantId: TENANT_ID,
  tenantRole: "member"
});
assert.throws(
  () => assertTenantGrowthControlAuth({ ...VALID_AUTH, is_admin: true }),
  (error) => error instanceof TenantGrowthControlProjectionError && error.code === "TENANT_USER_JWT_REQUIRED"
);
assert.throws(
  () => assertTenantGrowthControlAuth({ mode: "backend_api_key", user_id: USER_ID, tenant_id: TENANT_ID }),
  (error) => error.code === "TENANT_USER_JWT_REQUIRED"
);

const cursor = encodeTenantGrowthControlCursor(25);
assert.deepEqual(normalizeTenantGrowthControlListQuery({
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  limit: "25",
  cursor
}), {
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  limit: 25,
  offset: 25
});
assert.throws(
  () => normalizeTenantGrowthControlListQuery({ workspaceId: WORKSPACE_ID, brandKey: BRAND_KEY, limit: 101 }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_LIMIT_INVALID"
);
assert.throws(
  () => normalizeTenantGrowthControlListQuery({ workspaceId: WORKSPACE_ID, brandKey: BRAND_KEY, cursor: "not-a-cursor" }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_CURSOR_INVALID"
);
assert.throws(
  () => _testingTenantGrowthControlPlaneRoutes.assertAllowedQuery({ workspaceId: WORKSPACE_ID, brandKey: BRAND_KEY, tenantId: TENANT_ID }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_QUERY_INVALID"
);

const projectedVersion = projectTenantConfigurationVersion({
  configVersionId: "44444444-4444-4444-8444-444444444444",
  configKey: "growth.execution.policy",
  versionNumber: 2,
  scopeType: "brand",
  scopeKey: `tenant:${TENANT_ID}:workspace:${WORKSPACE_ID}:brand:${BRAND_KEY}`,
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  lifecycle: "active",
  versionRevision: 3,
  checksumSha256: "a".repeat(64),
  values: { secret: "must-not-project" },
  schema: { type: "object" },
  createdBy: "admin"
});
assert.equal(projectedVersion.metadataOnly, true);
assert.equal(projectedVersion.secretsIncluded, false);
for (const forbidden of ["values", "schema", "createdBy", "approvedBy", "idempotencyKey"]) {
  assert.equal(Object.hasOwn(projectedVersion, forbidden), false);
}

const projectedBinding = projectTenantActivityBinding({
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
  executionContext: { hidden: true }
});
assert.equal(projectedBinding.metadataOnly, true);
assert.equal(Object.hasOwn(projectedBinding, "executionContext"), false);

const fakeRepository = {
  authorized: true,
  async resolveTenantWorkspaceScope(input) {
    const authorizedScope = this.authorized
      && input.tenantId === TENANT_ID
      && input.userId === USER_ID
      && input.workspaceId === WORKSPACE_ID
      && input.brandKey === BRAND_KEY;
    if (!authorizedScope) return null;
    assert.deepEqual(input, {
      tenantId: TENANT_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      brandKey: BRAND_KEY
    });
    return {
      tenantId: TENANT_ID,
      workspaceId: WORKSPACE_ID,
      brandKey: BRAND_KEY,
      bootstrapStatus: "ready"
    };
  },
  async listConfigurationVersions(input) {
    assert.equal(input.tenantId, TENANT_ID);
    assert.equal(input.workspaceId, WORKSPACE_ID);
    assert.equal(input.brandKey, BRAND_KEY);
    assert.equal(input.limit, 2);
    return [
      { ...projectedVersion, configVersionId: "44444444-4444-4444-8444-444444444444" },
      { ...projectedVersion, configVersionId: "66666666-6666-4666-8666-666666666666", versionNumber: 1 }
    ];
  },
  async listActivityBindings(input) {
    assert.equal(input.limit, 2);
    return [
      projectedBinding,
      { ...projectedBinding, activityBindingId: "77777777-7777-4777-8777-777777777777" }
    ];
  }
};

const service = createTenantGrowthControlProjectionService({ repository: fakeRepository });
const versionPage = await service.listConfigurationVersions(VALID_AUTH, {
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  limit: 1
});
assert.equal(versionPage.items.length, 1);
assert.equal(versionPage.page.hasMore, true);
assert.equal(versionPage.page.nextCursor, encodeTenantGrowthControlCursor(1));
assert.equal(versionPage.scope.tenantId, TENANT_ID);
assert.equal(versionPage.metadataOnly, true);
assert.equal(versionPage.providerCalls, false);
assert.equal(versionPage.externalWrites, false);
assert.equal(versionPage.secretsIncluded, false);

const bindingPage = await service.listActivityBindings(VALID_AUTH, {
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  limit: 1
});
assert.equal(bindingPage.items.length, 1);
assert.equal(bindingPage.page.hasMore, true);
assert.equal(bindingPage.tenantFacing, true);

fakeRepository.authorized = false;
await assert.rejects(
  () => service.listConfigurationVersions(VALID_AUTH, {
    workspaceId: WORKSPACE_ID,
    brandKey: BRAND_KEY
  }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_SCOPE_FORBIDDEN" && error.status === 403
);
await assert.rejects(
  () => service.listActivityBindings({ ...VALID_AUTH, tenant_id: "88888888-8888-4888-8888-888888888888" }, {
    workspaceId: WORKSPACE_ID,
    brandKey: BRAND_KEY
  }),
  (error) => error.code === "TENANT_GROWTH_CONTROL_SCOPE_FORBIDDEN"
);

const sqlCalls = [];
const repository = createTenantGrowthControlProjectionRepository({
  pool: {
    async query(statement, params) {
      sqlCalls.push({ statement, params });
      if (statement.includes("FROM memberships")) {
        return [[{
          tenant_id: TENANT_ID,
          tenant_role: "member",
          workspace_id: WORKSPACE_ID,
          workspace_key: "workspace-a",
          workspace_type: "project",
          bootstrap_status: "ready",
          linked_brand_key: BRAND_KEY
        }]];
      }
      return [[]];
    }
  }
});
const repositoryScope = await repository.resolveTenantWorkspaceScope({
  tenantId: TENANT_ID,
  userId: USER_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY
});
assert.equal(repositoryScope.brandKey, BRAND_KEY);
assert.match(sqlCalls[0].statement, /m\.status = 'active'/);
assert.match(sqlCalls[0].statement, /t\.status = 'active'/);
assert.match(sqlCalls[0].statement, /wr\.linked_brand_key = \?/);
assert.match(sqlCalls[0].statement, /wr\.bootstrap_status IN \('ready','degraded'\)/);

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

console.log("tenant growth control plane projection tests passed");
