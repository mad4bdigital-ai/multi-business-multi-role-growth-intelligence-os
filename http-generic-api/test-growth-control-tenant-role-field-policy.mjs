import assert from "node:assert/strict";

import {
  applyTenantGrowthControlFieldPolicy,
  buildTenantGrowthControlFieldPolicy,
  resolveTenantGrowthControlRoleProfile,
} from "./src/domain/growthControlPlane/tenantGrowthControlViewPolicy.js";
import {
  projectTenantActivityBinding,
  projectTenantConfigurationVersion,
} from "./src/domain/growthControlPlane/tenantGrowthControlProjection.js";
import {
  createTenantGrowthControlProjectionService,
} from "./src/application/growthControlPlane/tenantGrowthControlProjectionService.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const BRAND_KEY = "example-brand";

assert.deepEqual(resolveTenantGrowthControlRoleProfile("tenant-owner"), {
  role: "tenant_owner",
  profile: "manager",
  recognized: true,
  fallbackApplied: false,
});
assert.equal(resolveTenantGrowthControlRoleProfile("member").profile, "viewer");
assert.equal(resolveTenantGrowthControlRoleProfile("editor").profile, "operator");
assert.deepEqual(resolveTenantGrowthControlRoleProfile("custom-role"), {
  role: "custom_role",
  profile: "viewer",
  recognized: false,
  fallbackApplied: true,
});
assert.deepEqual(resolveTenantGrowthControlRoleProfile(null), {
  role: null,
  profile: "viewer",
  recognized: false,
  fallbackApplied: true,
});

const versionRow = Object.freeze({
  configVersionId: "44444444-4444-4444-8444-444444444444",
  configKey: "growth.execution.policy",
  versionNumber: 4,
  scopeType: "brand",
  scopeKey: `tenant:${TENANT_ID}:workspace:${WORKSPACE_ID}:brand:${BRAND_KEY}`,
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  activityTypeKey: "travel",
  activityBindingId: "55555555-5555-4555-8555-555555555555",
  profileKey: "default",
  workflowKey: "travel.growth",
  workflowVersion: 2,
  workflowNodeId: "publish",
  planId: "66666666-6666-4666-8666-666666666666",
  executionId: "77777777-7777-4777-8777-777777777777",
  lifecycle: "active",
  versionRevision: 7,
  checksumSha256: "a".repeat(64),
  effectiveFrom: "2026-07-31T00:00:00.000Z",
  effectiveTo: null,
  createdAt: "2026-07-30T00:00:00.000Z",
  values: { mustNotLeak: true },
  idempotencyKey: "must-not-leak",
  createdBy: "must-not-leak",
});

const viewerVersion = projectTenantConfigurationVersion(versionRow, "member");
assert.deepEqual(Object.keys(viewerVersion), [
  "configVersionId",
  "configKey",
  "versionNumber",
  "scopeType",
  "lifecycle",
  "checksumSha256",
  "effectiveFrom",
  "effectiveTo",
  "metadataOnly",
  "secretsIncluded",
]);
assert.equal(Object.hasOwn(viewerVersion, "tenantId"), false);
assert.equal(Object.hasOwn(viewerVersion, "versionRevision"), false);
assert.equal(Object.hasOwn(viewerVersion, "values"), false);
assert.equal(Object.hasOwn(viewerVersion, "idempotencyKey"), false);

const operatorVersion = projectTenantConfigurationVersion(versionRow, "operator");
assert.equal(operatorVersion.tenantId, TENANT_ID);
assert.equal(operatorVersion.versionRevision, 7);
assert.equal(Object.hasOwn(operatorVersion, "planId"), false);
assert.equal(Object.hasOwn(operatorVersion, "executionId"), false);

const managerVersion = projectTenantConfigurationVersion(versionRow, "owner");
assert.equal(managerVersion.planId, versionRow.planId);
assert.equal(managerVersion.executionId, versionRow.executionId);
assert.equal(managerVersion.workflowNodeId, versionRow.workflowNodeId);
assert.equal(Object.hasOwn(managerVersion, "values"), false);
assert.equal(Object.hasOwn(managerVersion, "createdBy"), false);

const unknownRoleVersion = projectTenantConfigurationVersion(versionRow, "brand-specialist");
assert.deepEqual(unknownRoleVersion, viewerVersion);

const bindingRow = Object.freeze({
  activityBindingId: "55555555-5555-4555-8555-555555555555",
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  activityTypeKey: "travel",
  activityPackKey: "travel.organic-growth",
  activityPackVersion: 3,
  markets: ["EG"],
  locales: ["ar-EG"],
  channels: ["organic-search"],
  objectives: ["qualified-leads"],
  allowedCapabilities: ["intent_map_generate"],
  status: "active",
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  secret: "must-not-leak",
});

const viewerBinding = projectTenantActivityBinding(bindingRow, "member");
assert.equal(Object.hasOwn(viewerBinding, "tenantId"), false);
assert.equal(Object.hasOwn(viewerBinding, "allowedCapabilities"), false);
assert.equal(Object.hasOwn(viewerBinding, "createdAt"), false);
assert.deepEqual(viewerBinding.markets, ["EG"]);

const operatorBinding = projectTenantActivityBinding(bindingRow, "editor");
assert.equal(operatorBinding.tenantId, TENANT_ID);
assert.deepEqual(operatorBinding.allowedCapabilities, ["intent_map_generate"]);
assert.equal(Object.hasOwn(operatorBinding, "createdAt"), false);
assert.equal(operatorBinding.updatedAt, bindingRow.updatedAt);

const managerBinding = projectTenantActivityBinding(bindingRow, "manager");
assert.equal(managerBinding.createdAt, bindingRow.createdAt);
assert.equal(managerBinding.updatedAt, bindingRow.updatedAt);

const viewerPolicy = buildTenantGrowthControlFieldPolicy("configuration_version", "unknown-role");
assert.equal(viewerPolicy.contract, "mad4b.growth-control.tenant-field-policy.v1");
assert.equal(viewerPolicy.profile, "viewer");
assert.equal(viewerPolicy.fallbackApplied, true);
assert.equal(viewerPolicy.defaultDeny, true);
assert.equal(viewerPolicy.secretsIncluded, false);
assert.throws(() => viewerPolicy.allowedFields.push("values"), TypeError);

const applied = applyTenantGrowthControlFieldPolicy(
  "activity_binding",
  { activityBindingId: "binding", values: { blocked: true }, status: "active", metadataOnly: true, secretsIncluded: false },
  "member",
);
assert.deepEqual(applied.record, {
  activityBindingId: "binding",
  status: "active",
  metadataOnly: true,
  secretsIncluded: false,
});
assert.equal(Object.hasOwn(applied.record, "values"), false);

const repository = {
  async resolveTenantWorkspaceScope() {
    return {
      tenantId: TENANT_ID,
      tenantRole: "member",
      workspaceId: WORKSPACE_ID,
      workspaceKey: "example-workspace",
      workspaceType: "company",
      bootstrapStatus: "ready",
      brandKey: BRAND_KEY,
    };
  },
  async listConfigurationVersions() {
    return [versionRow];
  },
  async listActivityBindings() {
    return [bindingRow];
  },
};
const service = createTenantGrowthControlProjectionService({ repository });
const memberAuth = {
  mode: "user_jwt",
  user_id: USER_ID,
  tenant_id: TENANT_ID,
  tenant_role: "member",
  is_admin: false,
};
const memberResponse = await service.listConfigurationVersions(memberAuth, {
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
});
assert.equal(memberResponse.fieldPolicy.profile, "viewer");
assert.equal(memberResponse.fieldPolicy.role, "member");
assert.equal(memberResponse.fieldPolicy.defaultDeny, true);
assert.equal(Object.hasOwn(memberResponse.items[0], "tenantId"), false);
assert.equal(memberResponse.scope.tenantId, TENANT_ID);
assert.equal(memberResponse.scope.workspaceId, WORKSPACE_ID);
assert.equal(memberResponse.scope.brandKey, BRAND_KEY);

const managerResponse = await service.listActivityBindings({ ...memberAuth, tenant_role: "owner" }, {
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
});
assert.equal(managerResponse.fieldPolicy.profile, "manager");
assert.equal(managerResponse.items[0].tenantId, TENANT_ID);
assert.equal(managerResponse.items[0].createdAt, bindingRow.createdAt);
assert.equal(managerResponse.providerCalls, false);
assert.equal(managerResponse.externalWrites, false);
assert.equal(managerResponse.secretsIncluded, false);

console.log("growth control tenant role field policy tests passed");
