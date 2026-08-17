import assert from "node:assert/strict";
import {
  MCP_CATALOG_LEVEL_MIGRATION,
  MCP_CATALOG_LEVEL_MIGRATION_SHA256,
  MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT,
  assertMcpCatalogLevelColumn,
  readMcpCatalogSchemaReadiness,
  readMcpCatalogSchemaReadinessSafe,
  readMcpCatalogLevelSchemaStatus,
} from "./mcpCatalogSchemaGuard.js";

const presentPool = {
  async query(sql, params) {
    if (/SELECT DATABASE\(\)/u.test(String(sql))) {
      return [[{ current_database: "catalog_runtime", current_account: "runtime_user@localhost" }]];
    }
    assert.match(String(sql), /information_schema\.columns/);
    assert.deepEqual(params?.[1], "mcp_catalog_level");
    return [[{ column_count: 1 }]];
  },
};
const ready = await readMcpCatalogSchemaReadiness({ pool: presentPool });
assert.equal(ready.ok, true);
assert.equal(ready.migration, MCP_CATALOG_LEVEL_MIGRATION);
assert.equal(ready.tables.length, 2);
const safeReady = await readMcpCatalogSchemaReadinessSafe({
  pool: presentPool,
  env: { DB_NAME: "catalog_runtime", DB_USER: "runtime_user" },
});
assert.equal(safeReady.ok, true);
assert.equal(safeReady.identity.ok, true);
assert.equal(safeReady.database_role, MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_role);
assert.equal(safeReady.migration_checksum_sha256, MCP_CATALOG_LEVEL_MIGRATION_SHA256);
assert.equal((await assertMcpCatalogLevelColumn({ pool: presentPool, table: "admin_platform_endpoint_tools" })).available, true);

const missingPool = {
  async query() {
    return [[{ column_count: 0 }]];
  },
};
const missing = await readMcpCatalogLevelSchemaStatus({ pool: missingPool, table: "tenant_platform_endpoint_tools" });
assert.equal(missing.available, false);
await assert.rejects(
  () => assertMcpCatalogLevelColumn({ pool: missingPool, table: "tenant_platform_endpoint_tools" }),
  (error) => error.code === "mcp_catalog_schema_migration_required"
    && error.status === 503
    && error.details?.migration_apply_required === true
    && error.details?.secrets_included === false,
);

const errorPool = {
  async query() {
    const error = new Error("access denied");
    error.code = "ER_TABLEACCESS_DENIED_ERROR";
    throw error;
  },
};
const degraded = await readMcpCatalogSchemaReadiness({ pool: errorPool });
assert.equal(degraded.ok, false);
assert.equal(degraded.migration_apply_required, true);
assert.equal(degraded.tables.every((item) => item.secrets_included === false), true);

await assert.rejects(
  () => readMcpCatalogLevelSchemaStatus({ pool: presentPool, table: "users" }),
  (error) => error.code === "mcp_catalog_table_invalid" && error.status === 503,
);

console.log("test-mcp-catalog-schema-guard: ok");
