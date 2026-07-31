import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";

const migrationSql = await readFile(
  new URL("./migrations/20260730_hostinger_production_resync_policy.sql", import.meta.url),
  "utf8",
);

const statements = splitMigrationSqlStatements(migrationSql);

assert.equal(
  statements.length,
  10,
  "Hostinger Production resync migration must expose both trailing SELECT readbacks as independent statements",
);
assert.match(statements.at(-3), /^INSERT\s+INTO\s+execution_policies\b/i);
assert.match(statements.at(-2), /^SELECT\s+COLUMN_TYPE\b/i);
assert.match(statements.at(-1), /^SELECT\s+policy_key\b/i);
assert.doesNotMatch(
  statements.at(-3), /;\s*SELECT\b/i,
  "INSERT policy upsert must not absorb a trailing SELECT readback",
);

const semicolonInString = splitMigrationSqlStatements(`
  INSERT INTO example_table (payload) VALUES ('alpha;SELECT beta');
  SELECT 1 AS readback;
`);
assert.equal(semicolonInString.length, 2, "SELECT boundary support must not split semicolons inside SQL strings");
assert.match(semicolonInString[0], /alpha;SELECT beta/);
assert.match(semicolonInString[1], /^SELECT\s+1\b/i);

console.log(JSON.stringify({
  ok: true,
  migration: "20260730_hostinger_production_resync_policy.sql",
  statement_count: statements.length,
  trailing_statement_types: statements.slice(-3).map((statement) => statement.split(/\s+/u)[0].toUpperCase()),
  semicolon_in_string_preserved: true,
  secrets_included: false,
}, null, 2));
