import assert from "node:assert/strict";
import {
  isMissingAppCapabilityMapError,
  isMissingWorkspaceGrantViewError,
  loadAppMap,
  loadWorkspaceGrants,
} from "./scripts/capability-resolution-dry-run.mjs";

assert.equal(isMissingAppCapabilityMapError({
  code: "ER_NO_SUCH_TABLE",
  message: "Table 'growthOS_dev.v_app_integration_capability_map' doesn't exist",
}), true);
assert.equal(isMissingAppCapabilityMapError({
  code: "ER_VIEW_INVALID",
  message: "View v_app_integration_capability_map references invalid objects",
}), true);
assert.equal(isMissingAppCapabilityMapError({
  code: "ER_NO_SUCH_TABLE",
  message: "Table 'growthOS_dev.other_table' doesn't exist",
}), false);
assert.equal(isMissingAppCapabilityMapError({
  code: "ER_ACCESS_DENIED_ERROR",
  message: "Access denied for v_app_integration_capability_map",
}), false);

let emptyQueryCount = 0;
assert.deepEqual(await loadAppMap({
  async query() {
    emptyQueryCount += 1;
    return [[]];
  },
}, ""), []);
assert.equal(emptyQueryCount, 0);

const fallbackCalls = [];
const fallbackPool = {
  async query(sql, params) {
    fallbackCalls.push({ sql, params });
    if (fallbackCalls.length === 1) {
      const error = new Error("Table 'growthOS_dev.v_app_integration_capability_map' doesn't exist");
      error.code = "ER_NO_SUCH_TABLE";
      throw error;
    }
    return [[{
      app_key: "platform_orchestration",
      action_key: "internal_platform_api",
      credential_source: "none",
      active_tool_exports: 1,
    }]];
  },
};
const fallbackRows = await loadAppMap(fallbackPool, "platform_orchestration");
assert.equal(fallbackCalls.length, 2);
assert.match(fallbackCalls[0].sql, /FROM v_app_integration_capability_map/);
assert.match(fallbackCalls[1].sql, /FROM app_integrations ai/);
assert.match(fallbackCalls[1].sql, /LEFT JOIN app_integration_action_bindings b/);
assert.match(fallbackCalls[1].sql, /FROM platform_endpoint_tool_exports/);
assert.deepEqual(fallbackCalls[1].params, ["platform_orchestration"]);
assert.equal(fallbackRows[0].credential_source, "none");

let nonMissingCalls = 0;
const permissionError = new Error("Access denied");
permissionError.code = "ER_ACCESS_DENIED_ERROR";
await assert.rejects(
  () => loadAppMap({
    async query() {
      nonMissingCalls += 1;
      throw permissionError;
    },
  }, "platform_orchestration"),
  (error) => error === permissionError
);
assert.equal(nonMissingCalls, 1);

assert.equal(isMissingWorkspaceGrantViewError({
  code: "ER_NO_SUCH_TABLE",
  message: "Table 'growthOS_dev.v_workspace_resource_grant_effective' doesn't exist",
}), true);
assert.equal(isMissingWorkspaceGrantViewError({
  code: "ER_VIEW_INVALID",
  message: "View v_workspace_resource_grant_effective references invalid objects",
}), true);
assert.equal(isMissingWorkspaceGrantViewError({
  code: "ER_NO_SUCH_TABLE",
  message: "Table 'growthOS_dev.memberships' doesn't exist",
}), false);
assert.equal(isMissingWorkspaceGrantViewError({
  code: "ER_ACCESS_DENIED_ERROR",
  message: "Access denied for v_workspace_resource_grant_effective",
}), false);

let emptyGrantCalls = 0;
assert.deepEqual(await loadWorkspaceGrants({
  async query() {
    emptyGrantCalls += 1;
    return [[]];
  },
}, {
  tenantId: "",
  userId: "user-1",
  workspaceId: "workspace-1",
}), []);
assert.equal(emptyGrantCalls, 0);

const grantFallbackCalls = [];
const grantFallbackRows = await loadWorkspaceGrants({
  async query(sql, params) {
    grantFallbackCalls.push({ sql, params });
    if (grantFallbackCalls.length === 1) {
      const error = new Error("Table 'growthOS_dev.v_workspace_resource_grant_effective' doesn't exist");
      error.code = "ER_NO_SUCH_TABLE";
      throw error;
    }
    return [[{
      grant_id: "grant-1",
      tenant_id: "tenant-1",
      grantee_user_id: "user-1",
      resource_type: "workspace",
      resource_ref: "workspace-1",
      permission: "owner",
      grant_status: "active",
      membership_role: "owner",
      membership_status: "active",
      expires_at: null,
    }]];
  },
}, {
  tenantId: "tenant-1",
  userId: "user-1",
  workspaceId: "workspace-1",
  workspaceKey: "workspace-key",
  brandKey: "brand-1",
  appKey: "platform_orchestration",
});
assert.equal(grantFallbackCalls.length, 2);
assert.match(grantFallbackCalls[0].sql, /FROM v_workspace_resource_grant_effective/);
assert.match(grantFallbackCalls[1].sql, /FROM workspace_resource_grants g/);
assert.match(grantFallbackCalls[1].sql, /JOIN memberships m/);
assert.match(grantFallbackCalls[1].sql, /LEFT JOIN users u/);
assert.deepEqual(grantFallbackCalls[1].params, [
  "tenant-1",
  "user-1",
  "workspace-1",
  "workspace-key",
  "tenant-1",
  "brand-1",
  "platform_orchestration",
]);
assert.equal(grantFallbackRows[0].permission, "owner");

let grantPermissionCalls = 0;
const grantPermissionError = new Error("Access denied");
grantPermissionError.code = "ER_ACCESS_DENIED_ERROR";
await assert.rejects(
  () => loadWorkspaceGrants({
    async query() {
      grantPermissionCalls += 1;
      throw grantPermissionError;
    },
  }, {
    tenantId: "tenant-1",
    userId: "user-1",
    workspaceId: "workspace-1",
  }),
  (error) => error === grantPermissionError
);
assert.equal(grantPermissionCalls, 1);

console.log("capability resolution app-map and workspace-grant fallback tests passed");
