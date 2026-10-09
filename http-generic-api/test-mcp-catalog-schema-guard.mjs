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
    if (/LIMIT 0/u.test(String(sql))) return [[], []];
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
assert.equal(safeReady.read_only_probe, true);
assert.equal(safeReady.database_connection_performed, true);
assert.equal(safeReady.sql_readback_performed, true);
assert.equal(safeReady.sql_mutation_performed, false);
assert.equal(safeReady.migration_apply_performed, false);
assert.equal(safeReady.provider_mutation_performed, false);
assert.equal(safeReady.deployment_performed, false);
assert.equal((await assertMcpCatalogLevelColumn({ pool: presentPool, table: "admin_platform_endpoint_tools" })).available, true);


const metadataPresentPrivilegeDeniedPool = {
  async query(sql) {
    if (/information_schema\.columns/u.test(sql)) return [[{ column_count: 1 }]];
    if (/LIMIT 0/u.test(sql)) {
      const error = new Error("Runtime role lacks SELECT");
      error.code = "ER_COLUMNACCESS_DENIED_ERROR";
      throw error;
    }
    throw new Error("unexpected query");
  },
};
const deniedWithVisibleColumn = await readMcpCatalogLevelSchemaStatus({
  pool: metadataPresentPrivilegeDeniedPool, table: "admin_platform_endpoint_tools",
});
assert.equal(deniedWithVisibleColumn.available, false);
assert.equal(deniedWithVisibleColumn.code, "MCP_CATALOG_SCHEMA_PRIVILEGE_DENIED");
assert.equal(deniedWithVisibleColumn.migration_apply_required, false);
const inconsistentMetadataPool = {
  async query(sql) {
    if (/information_schema\.columns/u.test(sql)) return [[{ column_count: 1 }]];
    if (/LIMIT 0/u.test(sql)) {
      const error = new Error("metadata and direct projection disagree");
      error.code = "ER_BAD_FIELD_ERROR";
      throw error;
    }
    throw new Error("unexpected query");
  },
};
const metadataConflict = await readMcpCatalogLevelSchemaStatus({
  pool: inconsistentMetadataPool, table: "tenant_platform_endpoint_tools",
});
assert.equal(metadataConflict.available, false);
assert.equal(metadataConflict.code, "MCP_CATALOG_SCHEMA_METADATA_CONFLICT");
assert.equal(metadataConflict.migration_apply_required, false,
  "Contradictory metadata must not authorize an ALTER on Production");

const missingPool = {
  async query(sql) {
    if (/information_schema\.columns/u.test(sql)) return [[{ column_count: 0 }]];
    const error = new Error("confirmed missing column");
    error.code = "ER_BAD_FIELD_ERROR";
    throw error;
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
assert.equal(degraded.migration_apply_required, false);
assert(degraded.tables.every(item => item.code === "mcp_catalog_schema_metadata_unavailable"));
assert.equal(degraded.tables.every((item) => item.secrets_included === false), true);
const unavailableTablePool = {
  async query(sql) {
    if (/information_schema\.columns/u.test(sql)) return [[{ column_count: 0 }]];
    const error = new Error("table is inaccessible");
    error.code = "ER_TABLEACCESS_DENIED_ERROR";
    throw error;
  },
};
const notAuthorized = await readMcpCatalogLevelSchemaStatus({
  pool: unavailableTablePool, table: "admin_platform_endpoint_tools",
});
assert.equal(notAuthorized.available, false);
assert.equal(notAuthorized.migration_apply_required, false);
assert.equal(notAuthorized.code, "MCP_CATALOG_SCHEMA_PRIVILEGE_DENIED");
await assert.rejects(
  () => assertMcpCatalogLevelColumn({ pool: unavailableTablePool, table: "admin_platform_endpoint_tools" }),
  error => error.code === "mcp_catalog_schema_metadata_unavailable"
    && error.details?.migration_apply_required === false,
);
const noTablePool = {
  async query(sql) {
    if (/information_schema\.columns/u.test(sql)) return [[{ column_count: 0 }]];
    const error = new Error("table missing");
    error.code = "ER_NO_SUCH_TABLE";
    throw error;
  },
};
const noTable = await readMcpCatalogLevelSchemaStatus({ pool: noTablePool, table: "admin_platform_endpoint_tools" });
assert.equal(noTable.code, "MCP_CATALOG_TABLE_MISSING");
assert.equal(noTable.migration_apply_required, false);
const hiddenMetadataPool = {
  async query(sql) {
    if (/information_schema\.columns/u.test(sql)) return [[{ column_count: 0 }]];
    return [[], []]; // Direct projection succeeds even though metadata was unavailable.
  },
};
const metadataFalseNegative = await readMcpCatalogLevelSchemaStatus({
  pool: hiddenMetadataPool, table: "tenant_platform_endpoint_tools",
});
assert.equal(metadataFalseNegative.available, true);
assert.equal(metadataFalseNegative.migration_apply_required, false);
const mixedEvidencePool = {
  async query(sql, params) {
    if (/information_schema\.columns/u.test(sql)) return [[{ column_count: 0 }]];
    const error = new Error("mixed schema evidence");
    error.code = sql.includes("admin_platform_endpoint_tools") ? "ER_BAD_FIELD_ERROR" : "ER_TABLEACCESS_DENIED_ERROR";
    throw error;
  },
};
const mixedEvidence = await readMcpCatalogSchemaReadiness({ pool: mixedEvidencePool });
assert.equal(mixedEvidence.ok, false);
assert.equal(mixedEvidence.tables[0].migration_apply_required, true);
assert.equal(mixedEvidence.tables[1].migration_apply_required, false);
assert.equal(mixedEvidence.migration_apply_required, false,
  "Migration must not be recommended when one of the two tables is inaccessible");
const safeDegraded = await readMcpCatalogSchemaReadinessSafe({
  pool: errorPool,
  env: { DB_NAME: "catalog_runtime", DB_USER: "runtime_user" },
});
assert.equal(safeDegraded.ok, false);
assert.equal(safeDegraded.read_only_probe, true);
assert.equal(safeDegraded.sql_mutation_performed, false);
assert.equal(safeDegraded.migration_apply_performed, false);
assert.equal(safeDegraded.provider_mutation_performed, false);
assert.equal(safeDegraded.deployment_performed, false);

await assert.rejects(
  () => readMcpCatalogLevelSchemaStatus({ pool: presentPool, table: "users" }),
  (error) => error.code === "mcp_catalog_table_invalid" && error.status === 503,
);

console.log("test-mcp-catalog-schema-guard: ok");
