import assert from "node:assert/strict";
import fs from "node:fs";
import {
  detectDatabaseEngine,
  inspectMigrationCollationSql,
  loadDatabaseCollationPolicy,
  normalizeDatabaseEngine,
  resolveDatabaseCollationPolicy,
  runDatabaseCollationPreflight,
} from "./databaseCollationPolicyGuard.js";

const policy = loadDatabaseCollationPolicy();
assert.equal(policy.secrets_included, false);
assert.equal(normalizeDatabaseEngine("10.11.8-MariaDB"), "mariadb");
assert.equal(normalizeDatabaseEngine("8.0.36 MySQL Community Server"), "mysql");
assert.equal(normalizeDatabaseEngine("SQLite 3"), "unknown");
assert.equal(resolveDatabaseCollationPolicy("mariadb", policy).rules.required_default_collation, "utf8mb4_unicode_ci");

const validSql = `CREATE TABLE governed_example (
  id BIGINT NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;
const valid = inspectMigrationCollationSql(validSql, { engine: "mariadb", policy });
assert.equal(valid.ok, true, JSON.stringify(valid));
assert.equal(valid.ready, true);

const implicit = inspectMigrationCollationSql("CREATE TABLE governed_example (id BIGINT NOT NULL);", { engine: "mariadb", policy });
assert.equal(implicit.ok, false);
assert.equal(implicit.blocked_reason, "collation_policy_violation");
assert(implicit.issues.some((issue) => issue.code === "migration_table_collation_not_explicit"));

const wrongDefault = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (id BIGINT NOT NULL) DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;",
  { engine: "mysql", policy },
);
assert.equal(wrongDefault.ok, false);
assert(wrongDefault.issues.some((issue) => issue.code === "migration_default_charset_not_allowed"));

const binaryTableDefault = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (id BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;",
  { engine: "mariadb", policy },
);
assert.equal(binaryTableDefault.ok, false);
assert(binaryTableDefault.issues.some((issue) => issue.code === "migration_default_collation_not_allowed"));

const binaryJsonColumn = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (payload_json LONGTEXT COLLATE=utf8mb4_bin) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;",
  { engine: "mariadb", policy },
);
assert.equal(binaryJsonColumn.ok, true, JSON.stringify(binaryJsonColumn));

const binaryRelationalColumn = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (owner_id VARCHAR(64) COLLATE=utf8mb4_bin) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;",
  { engine: "mariadb", policy },
);
assert.equal(binaryRelationalColumn.ok, false);
assert(binaryRelationalColumn.issues.some((issue) => issue.code === "migration_column_collation_not_allowed"));

const unknown = inspectMigrationCollationSql(validSql, { engine: "sqlite", policy });
assert.equal(unknown.ok, false);
assert.equal(unknown.blocked_reason, "database_engine_unknown");

const enginePool = {
  async query(sql) {
    assert.match(sql, /VERSION\(\)/u);
    return [[{ version: "10.11.8-MariaDB", version_comment: "MariaDB Server" }]];
  },
};
const detected = await detectDatabaseEngine(enginePool);
assert.equal(detected.ok, true);
assert.equal(detected.engine, "mariadb");

const preflight = await runDatabaseCollationPreflight({ pool: enginePool, sql: validSql, migration: "test.sql", policy });
assert.equal(preflight.ok, true);
assert.equal(preflight.ready, true);
assert.equal(preflight.migration, "test.sql");

const blockedPreflight = await runDatabaseCollationPreflight({
  pool: { async query() { return [[{ version: "SQLite 3", version_comment: "" }]]; } },
  sql: validSql,
  migration: "test.sql",
  policy,
});
assert.equal(blockedPreflight.ok, false);
assert.equal(blockedPreflight.blocked_reason, "database_engine_unknown");

const runner = fs.readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
assert.match(runner, /runDatabaseCollationPreflight/u);
assert.match(runner, /collation_policy_not_pass/u);

console.log(JSON.stringify({ ok: true, policy: policy.policy_key, tests: 10, secrets_included: false }));
