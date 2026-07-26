import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const migration = readFileSync("migrations/197_sprint66_tenant_database_query_readonly_tool.sql", "utf8");

assert(runner.includes('"197_sprint66_tenant_database_query_readonly_tool.sql"'), "governed migration runner must allowlist migration 197");
assert(migration.includes('tenant_database_query_readonly'), "migration 197 must register the tenant database read-only query tool");
assert(migration.includes('no_secrets'), "migration 197 must remain no-secrets");
assert(migration.includes('select_only'), "migration 197 must remain select-only");
assert(migration.includes('no_ddl') && migration.includes('no_dml'), "migration 197 must block DDL/DML expectation");

console.log("Governed migration runner tenant DB query-readonly allowlist guard passed");
