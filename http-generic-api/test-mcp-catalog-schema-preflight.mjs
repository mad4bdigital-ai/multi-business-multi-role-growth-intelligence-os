import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MCP_CATALOG_LEVEL_COLUMN,
  MCP_CATALOG_LEVEL_MIGRATION,
  MCP_CATALOG_TABLES,
  buildMcpCatalogSchemaNotReadyResponse,
  getMcpCatalogSchemaStartupPreflight,
  isMcpCatalogSchemaNotReadyError,
  readMcpCatalogSchemaReadinessSafe,
  runMcpCatalogSchemaStartupPreflight,
} from "./mcpCatalogSchemaGuard.js";

function fakePool(columnCounts = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      assert.match(sql, /information_schema\.columns/u);
      const table = String(params?.[0] || "");
      return [[{ column_count: Number(columnCounts[table] || 0) }]];
    },
  };
}

const readyPool = fakePool(Object.fromEntries(MCP_CATALOG_TABLES.map((table) => [table, 1])));
const ready = await readMcpCatalogSchemaReadinessSafe({ pool: readyPool });
assert.equal(ready.ok, true);
assert.equal(ready.database_connection_performed, true);
assert.equal(ready.sql_readback_performed, true);
assert.equal(ready.migration_apply_required, false);
assert.equal(ready.tables.length, 2);
assert.ok(readyPool.calls.length >= 2);

const missingPool = fakePool();
const missing = await readMcpCatalogSchemaReadinessSafe({ pool: missingPool });
assert.equal(missing.ok, false);
assert.equal(missing.migration_apply_required, true);
assert.equal(missing.database_connection_performed, true);
assert.equal(missing.sql_readback_performed, true);
assert.equal(missing.tables.every((table) => table.available === false), true);
assert.equal(missing.secrets_included, false);

const logs = [];
const startup = await runMcpCatalogSchemaStartupPreflight({
  pool: missingPool,
  environment: "production",
  logger: { log: (value) => logs.push(["log", value]), warn: (value) => logs.push(["warn", value]) },
});
assert.equal(startup.contract, "mad4b.mcp-catalog-schema-startup-preflight.v1");
assert.equal(startup.status, "schema_contract_not_ready");
assert.equal(startup.ready, false);
assert.equal(startup.startup_blocked, false);
assert.equal(startup.database_mutation_performed, false);
assert.equal(startup.migration_apply_performed, false);
assert.equal(logs.at(-1)?.[0], "warn");
assert.equal(getMcpCatalogSchemaStartupPreflight().status, "schema_contract_not_ready");

const projected = buildMcpCatalogSchemaNotReadyResponse({
  code: "mcp_catalog_schema_migration_required",
  details: { table: MCP_CATALOG_TABLES[0] },
  message: "raw SQL text and secret=must-not-leak",
});
assert.equal(projected.code, "schema_contract_not_ready");
assert.equal(projected.details.migration, MCP_CATALOG_LEVEL_MIGRATION);
assert.equal(projected.details.column, MCP_CATALOG_LEVEL_COLUMN);
assert.equal(projected.details.migration_apply_required, true);
assert.equal(projected.details.table, MCP_CATALOG_TABLES[0]);
assert.equal(JSON.stringify(projected).includes("must-not-leak"), false);
assert.equal(projected.secrets_included, false);
assert.equal(isMcpCatalogSchemaNotReadyError({ code: "mcp_catalog_schema_migration_required" }), true);
assert.equal(isMcpCatalogSchemaNotReadyError({ code: "ER_BAD_FIELD_ERROR" }), false);

const routeSource = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const legacyRouteSource = fs.readFileSync(new URL("./routes/gptToolsRoutesLegacy.js", import.meta.url), "utf8");
const deploymentInfoSource = fs.readFileSync(new URL("./routes/deploymentInfoRoutes.js", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
assert.match(routeSource, /schema_contract_not_ready/u);
assert.match(routeSource, /buildMcpCatalogSchemaNotReadyResponse/u);
assert.match(legacyRouteSource, /assertMcpCatalogLevelColumn/u);
assert.match(legacyRouteSource, /buildMcpCatalogSchemaNotReadyResponse/u);
assert.match(legacyRouteSource, /schema_contract_not_ready/u);
assert.match(legacyRouteSource, /message: err\.code \? err\.message : "Tool call failed\."/u);
assert.doesNotMatch(legacyRouteSource, /message: err\.message\s*,/u);
assert.match(deploymentInfoSource, /include_mcp_catalog_schema_readiness/u);
assert.match(deploymentInfoSource, /mcp_catalog_schema_startup_preflight/u);
assert.match(serverSource, /runMcpCatalogSchemaStartupPreflight/u);
assert.match(serverSource, /migration_apply_performed: false/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.mcp-catalog-schema-preflight.workflow-test.v1",
  tables: MCP_CATALOG_TABLES,
  readiness_readback_only: true,
  startup_non_blocking: true,
  migration_apply_performed: false,
  database_mutation_performed: false,
  legacy_surface_covered: true,
  secrets_included: false,
}, null, 2));
