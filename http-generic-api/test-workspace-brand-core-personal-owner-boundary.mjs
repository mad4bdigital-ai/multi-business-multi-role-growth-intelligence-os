import assert from "node:assert/strict";
import { materializeWorkspaceBrandCoreAsset } from "./workspaceBrandCoreAssetMaterialization.js";

const calls = [];
const connection = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes("FROM workspace_registry wr") && sql.includes("JOIN tenants")) {
      return [[{
        workspace_id: "workspace-personal-a",
        tenant_id: "tenant-a",
        workspace_key: "workspace_personal_a",
        display_name: "Personal Workspace A",
        workspace_type: "workspace",
        workspace_ownership_type: "personal",
        owner_user_id: "user-b",
        ownership_revision: 9,
        bootstrap_status: "ready",
        tenant_status: "active",
      }]];
    }
    throw new Error(`Personal owner mismatch must fail before downstream authority lookup: ${sql}`);
  },
};

await assert.rejects(
  materializeWorkspaceBrandCoreAsset(connection, {
    workspaceId: "workspace-personal-a",
    actorUserId: "user-a",
    brandRef: "brand-a",
    sourceRef: "positioning",
  }),
  (error) => error?.code === "brand_core_materialize_personal_owner_mismatch" && error?.status === 403,
);

assert.equal(calls.length, 1, "personal owner mismatch must stop after the exact Root Workspace lookup");
assert.match(calls[0].sql, /FROM workspace_registry wr/);
assert.equal(calls[0].params[0], "workspace-personal-a");
assert.equal(
  calls.some((call) => call.sql.includes("tenant_brand_links") || call.sql.includes("v_workspace_resource_grant_effective")),
  false,
  "personal owner mismatch must fail before Brand authority lookup",
);
assert.equal(calls.some((call) => call.sql.includes("FROM brand_core")), false, "personal owner mismatch must fail before Brand Core source lookup");
assert.equal(calls.some((call) => call.sql.includes("workspace_assets")), false, "personal owner mismatch must fail before asset persistence or readback");

console.log("workspace Brand Core personal Root owner boundary regression passed");
