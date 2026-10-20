import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MCP_CATALOG_LEVEL_COLUMN,
  MCP_CATALOG_LEVEL_MIGRATION,
  MCP_CATALOG_LEVEL_MIGRATION_SHA256,
  MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT,
  MCP_CATALOG_TABLES,
  buildMcpCatalogSchemaNotReadyResponse,
  getMcpCatalogSchemaStartupPreflight,
  isMcpCatalogSchemaNotReadyError,
  readMcpCatalogRuntimeIdentity,
  readMcpCatalogSchemaReadinessSafe,
  runMcpCatalogSchemaStartupPreflight,
} from "./mcpCatalogSchemaGuard.js";

function fakePool(columnCounts = {}, identity = { current_database: "catalog_runtime", current_account: "runtime_user@localhost" }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SELECT DATABASE\(\)/u.test(sql)) return [[identity]];
      if (/information_schema\.columns/u.test(sql)) {
        const table = String(params?.[0] || "");
        return [[{ column_count: Number(columnCounts[table] || 0) }]];
      }
      if (/LIMIT 0/u.test(sql)) {
        const table = /FROM `([a-z_]+)` LIMIT 0/u.exec(sql)?.[1] || "";
        if (Number(columnCounts[table] || 0) > 0) return [[], []];
        const error = new Error("Column not present");
        error.code = "ER_BAD_FIELD_ERROR";
        throw error;
      }
      throw new Error("unexpected query");

    },
  };
}

const readinessEnv = { DB_NAME: "catalog_runtime", DB_USER: "runtime_user",
  MCP_RUNTIME_EXPECTED_SQL_ACCOUNT: "runtime_user@localhost" };
const readyPool = fakePool(Object.fromEntries(MCP_CATALOG_TABLES.map((table) => [table, 1])));
const ready = await readMcpCatalogSchemaReadinessSafe({ pool: readyPool, env: readinessEnv });
assert.equal(ready.ok, true);
assert.equal(ready.identity.ok, true);
assert.equal(ready.identity.database_matches, true);
assert.equal(ready.identity.principal_matches, true);
assert.equal(ready.database_role, MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT.database_role);
assert.equal(ready.migration_checksum_sha256, MCP_CATALOG_LEVEL_MIGRATION_SHA256);
assert.equal(ready.database_connection_performed, true);
assert.equal(ready.sql_readback_performed, true);
assert.equal(ready.migration_apply_required, false);
assert.equal(ready.tables.length, 2);
assert.ok(readyPool.calls.length >= 2);

const missingPool = fakePool();
const missing = await readMcpCatalogSchemaReadinessSafe({ pool: missingPool, env: readinessEnv });
assert.equal(missing.ok, false);
assert.equal(missing.migration_apply_required, true);
assert.equal(missing.database_connection_performed, true);
assert.equal(missing.sql_readback_performed, true);
assert.equal(missing.tables.every((table) => table.available === false), true);
assert.equal(missing.secrets_included, false);
assert.equal(missing.identity.ok, true);
assert.equal(missing.tables.every(table => table.migration_apply_required === true), true);

const wrongSchema = await readMcpCatalogSchemaReadinessSafe({
  pool: fakePool(), env: { DB_NAME: "not-the-runtime-db", DB_USER: "runtime_user" },
});
assert.equal(wrongSchema.ok, false);
assert.equal(wrongSchema.identity.database_matches, false);
assert.equal(wrongSchema.migration_apply_required, false, "Wrong database must not recommend migration");

const missingExactAccount = await readMcpCatalogSchemaReadinessSafe({
  pool: readyPool,
  env: { DB_NAME: readinessEnv.DB_NAME, DB_USER: readinessEnv.DB_USER },
});
assert.equal(missingExactAccount.ok, false);
assert.equal(missingExactAccount.identity.exact_sql_account_matches, false);
assert.equal(missingExactAccount.identity.code, "MCP_CATALOG_RUNTIME_SQL_ACCOUNT_CONFIG_MISSING");
assert.equal(missingExactAccount.migration_apply_required, false);

const missingIdentityEnv = await readMcpCatalogRuntimeIdentity({ pool: readyPool, env: {} });
assert.equal(missingIdentityEnv.ok, false);
assert.equal(missingIdentityEnv.code, "MCP_CATALOG_RUNTIME_IDENTITY_CONFIG_MISSING");
assert.equal(missingIdentityEnv.secrets_included, false);

const mismatchPool = fakePool(Object.fromEntries(MCP_CATALOG_TABLES.map((table) => [table, 1])), {
  current_database: "wrong_runtime",
  current_account: "runtime_user@localhost",
});
const mismatch = await readMcpCatalogRuntimeIdentity({ pool: mismatchPool, env: readinessEnv });
assert.equal(mismatch.ok, false);
assert.equal(mismatch.code, "MCP_CATALOG_RUNTIME_DATABASE_MISMATCH");
assert.equal(mismatch.database_matches, false);

const logs = [];
const startup = await runMcpCatalogSchemaStartupPreflight({
  pool: missingPool,
  env: readinessEnv,
  environment: "production",
  logger: { log: (value) => logs.push(["log", value]), warn: (value) => logs.push(["warn", value]) },
});
assert.equal(startup.contract, "mad4b.mcp-catalog-schema-startup-preflight.v1");
assert.equal(startup.environment, "production");
assert.equal(startup.environment_source, "explicit_argument");
assert.equal(startup.status, "schema_contract_not_ready");
assert.equal(startup.ready, false);
assert.equal(startup.startup_blocked, false);
assert.equal(startup.database_mutation_performed, false);
assert.equal(startup.migration_apply_performed, false);
assert.equal(logs.at(-1)?.[0], "warn");
assert.equal(getMcpCatalogSchemaStartupPreflight().status, "schema_contract_not_ready");

const legacyRuntimeStartup = await runMcpCatalogSchemaStartupPreflight({
  pool: missingPool,
  env: { ...readinessEnv, NODE_ENV: "production" },
  logger: { log: () => {}, warn: () => {} },
});
assert.equal(legacyRuntimeStartup.environment, "production");
assert.equal(legacyRuntimeStartup.environment_source, "runtime_environment_resolver");
assert.equal(legacyRuntimeStartup.runtime_environment_reason, "runtime_class_ambiguous");
assert.equal(legacyRuntimeStartup.runtime_class, null);
assert.equal(legacyRuntimeStartup.runtime_class_explicit, false);

const explicitRuntimeStartup = await runMcpCatalogSchemaStartupPreflight({
  pool: missingPool,
  env: { ...readinessEnv, NODE_ENV: "production", DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy" },
  logger: { log: () => {}, warn: () => {} },
});
assert.equal(explicitRuntimeStartup.environment, "production");
assert.equal(explicitRuntimeStartup.environment_source, "runtime_environment_resolver");
assert.equal(explicitRuntimeStartup.runtime_environment_reason, null);
assert.equal(explicitRuntimeStartup.runtime_class, "hostinger_autodeploy");
assert.equal(explicitRuntimeStartup.runtime_class_explicit, true);

const projected = buildMcpCatalogSchemaNotReadyResponse({
  code: "mcp_catalog_schema_migration_required",
  details: { table: MCP_CATALOG_TABLES[0] },
  message: "raw SQL text and secret=must-not-leak",
});
assert.equal(projected.code, "schema_contract_not_ready");
assert.equal(projected.details.migration, MCP_CATALOG_LEVEL_MIGRATION);
assert.equal(projected.details.column, MCP_CATALOG_LEVEL_COLUMN);
assert.equal(projected.details.migration_apply_required, true);
const unverified = buildMcpCatalogSchemaNotReadyResponse({
  code: "mcp_catalog_schema_metadata_unavailable",
  details: { table: "admin_platform_endpoint_tools" },
});
assert.equal(unverified.details.migration_apply_required, false);
assert.equal(unverified.secrets_included, false);
assert.equal(projected.details.table, MCP_CATALOG_TABLES[0]);
assert.equal(JSON.stringify(projected).includes("must-not-leak"), false);
assert.equal(projected.secrets_included, false);
assert.equal(isMcpCatalogSchemaNotReadyError({ code: "mcp_catalog_schema_migration_required" }), true);
assert.equal(isMcpCatalogSchemaNotReadyError({ code: "ER_BAD_FIELD_ERROR" }), false);

const guardSource = fs.readFileSync(new URL("./mcpCatalogSchemaGuard.js", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const legacyRouteSource = fs.readFileSync(new URL("./routes/gptToolsRoutesLegacy.js", import.meta.url), "utf8");
const deploymentInfoSource = fs.readFileSync(new URL("./routes/deploymentInfoRoutes.js", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
assert.match(guardSource, /MCP_CATALOG_LEVEL_MIGRATION_SHA256/u);
assert.match(guardSource, /MCP_CATALOG_RUNTIME_SCHEMA_CONTRACT/u);
assert.match(guardSource, /readMcpCatalogRuntimeIdentity/u);
assert.match(routeSource, /schema_contract_not_ready/u);
assert.match(routeSource, /buildMcpCatalogSchemaNotReadyResponse/u);
assert.match(legacyRouteSource, /assertMcpCatalogLevelColumn/u);
assert.match(legacyRouteSource, /buildMcpCatalogSchemaNotReadyResponse/u);
assert.match(legacyRouteSource, /schema_contract_not_ready/u);
assert.match(legacyRouteSource, /message: err\.code \? err\.message : "Tool call failed\."/u);
assert.doesNotMatch(legacyRouteSource, /message: err\.message\s*,/u);
assert.match(legacyRouteSource, /TOOL_DESCRIPTOR_LOOKUP_AMBIGUOUS/u);
assert.match(legacyRouteSource, /ACTIVE_SESSION_CONTEXT_AMBIGUOUS/u);
assert.match(legacyRouteSource, /LIMIT 2/u);
assert.match(deploymentInfoSource, /include_mcp_catalog_schema_readiness/u);
assert.match(deploymentInfoSource, /mcp_catalog_schema_startup_preflight/u);
assert.match(deploymentInfoSource, /include_production_activation_readiness/u);
assert.match(deploymentInfoSource, /production_activation_readiness/u);
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
