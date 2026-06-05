import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const migration = readFileSync("migrations/197_sprint66_tenant_database_query_readonly_tool.sql", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(routes.includes('/me/infrastructure/database/connections/:connection_id/query-readonly'), "explicit tenant database read-only query route must exist");
assert(routes.includes('requireUserJwt'), "query route must require tenant user JWT");
assert(routes.includes('loadTenantConnection(pool, req, connectionId, "remote_database")'), "query route must load a tenant-scoped remote database connection");
assert(routes.includes('readinessFor(row, "remote_database")'), "query route must enforce readiness before execution");
assert(routes.includes('validateReadonlySql'), "query route must validate SQL before execution");
assert(routes.includes('Only SELECT statements are allowed'), "query guard must be SELECT-only");
assert(routes.includes('readonly_sql_blocked_token'), "query guard must block DDL/DML/admin tokens");
assert(routes.includes('readonly_sql_explicit_columns_required'), "query guard must block SELECT *");
assert(routes.includes('readonly_sql_secret_like_reference_blocked'), "query guard must block secret-like SQL references");
assert(routes.includes('readonly_query_secret_like_column_blocked'), "query guard must block secret-like selected columns");
assert(routes.includes('multipleStatements: false'), "query connection must disable multiple statements");
assert(routes.includes('SET SESSION TRANSACTION READ ONLY'), "query connection should request read-only transaction mode");
assert(routes.includes('SET SESSION MAX_EXECUTION_TIME=5000'), "query connection should request bounded execution time");
assert(routes.includes('LIMIT ?'), "query execution must add a bound outer limit");
assert(routes.includes('clampInt(options.limit, 25, 1, 100)'), "query limit must be clamped to 100 rows max");
assert(routes.includes('secrets_included: false'), "query route must never return secrets");
assert(!routes.includes('/query-write'), "write query route must not exist");
assert(!routes.includes('tenant_database_query_write'), "write query tool must not exist");

assert(migration.includes('tenant_database_query_readonly'), "migration must register tenant_database_query_readonly");
assert(migration.includes('/me/infrastructure/database/connections/{connection_id}/query-readonly'), "migration must use explicit query-readonly path");
assert(migration.includes('select_only'), "migration tags must include select_only");
assert(migration.includes('no_ddl') && migration.includes('no_dml'), "migration tags must block write/admin expectation");
assert(migration.includes('no_multiple_statements'), "migration tags must disclose single statement restriction");
assert(migration.includes('no_select_star'), "migration tags must disclose SELECT * restriction");
assert(migration.includes('no_secret_columns'), "migration tags must disclose secret-like column restriction");
assert(migration.includes('no_secrets'), "migration tags must include no_secrets");

console.log("Tenant database read-only query guard passed");
