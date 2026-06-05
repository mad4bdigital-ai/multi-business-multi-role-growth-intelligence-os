import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const migration = readFileSync("migrations/196_sprint66_tenant_database_schema_read_tool.sql", "utf8");
const pkg = readFileSync("package.json", "utf8");

assert(pkg.includes('"mysql2"'), "schema read must use existing mysql2 dependency, not add a new client");
assert(routes.includes('mysql from "mysql2/promise"'), "route must use mysql2 promise client");
assert(routes.includes('decryptCredentials'), "schema read may decrypt credentials internally to connect");
assert(routes.includes('/me/infrastructure/database/connections/:connection_id/schema'), "explicit tenant database schema route must exist");
assert(routes.includes('information_schema.COLUMNS'), "schema read must query information_schema only");
assert(routes.includes('TABLE_SCHEMA = ?'), "schema read must parameterize database/schema name");
assert(routes.includes('LIMIT ?'), "schema read must enforce a bound limit");
assert(routes.includes('clampInt(options.limit, 100, 1, 500)'), "schema read must clamp result limit");
assert(routes.includes('safeIdentifierLike'), "schema read must validate optional filters");
assert(routes.includes('multipleStatements: false'), "schema read must disable multiple statements");
assert(routes.includes('SET SESSION TRANSACTION READ ONLY'), "schema read should request a read-only session");
assert(!routes.includes('SHOW CREATE TABLE'), "schema read must not expose table DDL in this phase");
assert(!routes.includes('SELECT * FROM ${'), "schema read must not build arbitrary SELECTs");
assert(!routes.includes('tenant_database_query_readonly'), "arbitrary/read-only SQL query tool must remain a future phase");
assert(routes.includes('secrets_included: false'), "schema read must never return secrets");

assert(migration.includes('tenant_database_schema_read'), "migration must register tenant_database_schema_read");
assert(migration.includes('/me/infrastructure/database/connections/{connection_id}/schema'), "migration must use explicit schema path");
assert(migration.includes('information_schema'), "migration tags/description must disclose information_schema scope");
assert(migration.includes('no_arbitrary_sql'), "migration tags must prevent arbitrary SQL expectation");
assert(migration.includes('no_secrets'), "migration tags must include no_secrets");

console.log("Tenant database schema read guard passed");
