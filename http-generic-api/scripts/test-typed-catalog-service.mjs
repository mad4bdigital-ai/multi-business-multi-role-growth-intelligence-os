import assert from "node:assert/strict";
import {
  listTypedCatalogs,
  queryTypedCatalog,
  _testingTypedCatalogService,
} from "../typedCatalogService.js";

const adminAuth = { mode: "backend_api", is_admin: true, admin_id: "admin-1" };
const tenantAuth = { mode: "user_jwt", tenant_id: "tenant-a", user_id: "user-a" };

assert.equal(_testingTypedCatalogService.normalizeCatalogKey("runtime-actions"), "actions");
assert.equal(_testingTypedCatalogService.normalizeCatalogKey("surfaces"), "agent_surfaces");

const adminCatalogs = listTypedCatalogs({ auth: adminAuth });
assert.ok(adminCatalogs.items.some((item) => item.catalog_key === "plugins"));

const tenantCatalogs = listTypedCatalogs({ auth: tenantAuth });
assert.ok(tenantCatalogs.items.some((item) => item.catalog_key === "actions"));
assert.ok(!tenantCatalogs.items.some((item) => item.catalog_key === "plugins"));

await assert.rejects(
  () => queryTypedCatalog({ catalog_key: "plugins" }, { auth: tenantAuth, pool: { query: async () => [[]] } }),
  (error) => error.status === 403 && error.code === "CATALOG_ACCESS_DENIED",
);

{
  const result = await queryTypedCatalog(
    { catalog_key: "operation_contracts", limit: 2 },
    { auth: tenantAuth },
  );
  assert.equal(result.catalog_key, "operation_contracts");
  assert.ok(result.items.length <= 2);
  assert.equal(result.secrets_included, false);
  if (result.page.has_more) {
    const next = await queryTypedCatalog(
      { catalog_key: "operation_contracts", limit: 2, cursor: result.page.next_cursor },
      { auth: tenantAuth },
    );
    assert.notEqual(next.items[0]?.operation_key, result.items[0]?.operation_key);
  }
}

{
  let capturedSql = "";
  const pool = {
    async query(sql) {
      capturedSql = sql;
      return [[
        {
          action_key: "tenant.action.a",
          status: "active",
          runtime_callable: "true",
          admin_only: "false",
          client_allowed: "true",
          allowed_actor_roles: '["tenant"]',
          updated_at: "2026-07-14T00:00:00Z",
        },
        {
          action_key: "tenant.action.b",
          status: "active",
          runtime_callable: "true",
          admin_only: "false",
          client_allowed: "true",
          allowed_actor_roles: '["tenant"]',
          updated_at: "2026-07-14T00:00:00Z",
        },
      ]];
    },
  };
  const result = await queryTypedCatalog(
    { catalog_key: "actions", limit: 1 },
    { auth: tenantAuth, pool },
  );
  assert.match(capturedSql, /admin_only/);
  assert.match(capturedSql, /client_allowed/);
  assert.match(capturedSql, /allowed_actor_roles/);
  assert.equal(result.items.length, 1);
  assert.equal(result.page.has_more, true);
  assert.ok(result.page.next_cursor);
  assert.equal(Object.hasOwn(result.items[0], "api_key_value"), false);
  assert.equal(Object.hasOwn(result.items[0], "schema_json"), false);
}

{
  const pool = {
    async query(sql, params) {
      assert.match(sql, /agent_surface_catalog/);
      assert.equal(params.at(-1), 3);
      return [[
        {
          surface_key: "admin-gpt",
          display_name: "Admin GPT",
          surface_role: "admin",
          description: "Admin surface",
          supported_modes_json: '["managed"]',
          supported_channels_json: '["chat"]',
          capabilities_json: '["catalogs"]',
          platform_runtime_key: "admin",
          status: "active",
          updated_at: "2026-07-14T00:00:00Z",
        },
      ]];
    },
  };
  const result = await queryTypedCatalog(
    { catalog_key: "agent_surfaces", limit: 2 },
    { auth: adminAuth, pool },
  );
  assert.deepEqual(result.items[0].supported_modes, ["managed"]);
  assert.deepEqual(result.items[0].capabilities, ["catalogs"]);
}

assert.throws(
  () => _testingTypedCatalogService.decodeCursor("actions", "not-a-cursor"),
  (error) => error.code === "CATALOG_CURSOR_INVALID",
);

console.log("typed catalog service tests passed");
