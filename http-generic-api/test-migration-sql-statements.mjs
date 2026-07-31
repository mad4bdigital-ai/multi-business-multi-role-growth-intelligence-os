import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const protectedRegionSql = `
-- A SELECT token inside a comment is not a boundary.
SET @dynamic_sql := 'SELECT 1; SELECT 2; still one string';
/* SELECT 99; remains comment text. */
SELECT JSON_OBJECT('message', 'alpha; SELECT beta', 'enabled', true) AS payload;
SELECT "quoted; SELECT text" AS note;
`;

const protectedStatements = splitMigrationSqlStatements(protectedRegionSql);
assert.equal(protectedStatements.length, 3);
assert.match(protectedStatements[0], /^--[\s\S]*SET\s+@dynamic_sql/i);
assert.match(protectedStatements[1], /^SELECT\s+JSON_OBJECT/i);
assert.match(protectedStatements[2], /^SELECT\s+"quoted; SELECT text"/i);
assert.match(protectedStatements[0], /SELECT 1; SELECT 2; still one string/);
assert.match(protectedStatements[1], /alpha; SELECT beta/);

const migrationSql = readFileSync(
  new URL("./migrations/20260730_hostinger_production_resync_policy.sql", import.meta.url),
  "utf8",
);
const migrationStatements = splitMigrationSqlStatements(migrationSql);
assert.equal(migrationStatements.length, 10);
assert.match(migrationStatements[0], /SET\s+@repository_main_moved_coordination_type/i);
assert.match(migrationStatements[7], /^INSERT\s+INTO\s+execution_policies/i);
assert.match(migrationStatements[8], /^SELECT\s+[\s\S]*production_sync_status_registered/i);
assert.match(migrationStatements[9], /^SELECT\s+[\s\S]*repository_main_moved_trigger_policy_v1/i);
assert.doesNotMatch(migrationStatements[7], /production_sync_status_registered/i);

const migration1006 = readFileSync(
  new URL("./migrations/1006_sprint69_agent_capability_evidence_coverage.sql", import.meta.url),
  "utf8",
);
const migration1007 = readFileSync(
  new URL("./migrations/1007_sprint69_agent_capability_coverage_admin_tools.sql", import.meta.url),
  "utf8",
);
assert.equal(splitMigrationSqlStatements(migration1006).length, 5);
assert.equal(splitMigrationSqlStatements(migration1007).length, 1);

console.log("migration SQL statement splitter tests passed");
