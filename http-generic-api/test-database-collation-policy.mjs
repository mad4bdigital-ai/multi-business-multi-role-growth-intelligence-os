import assert from "node:assert/strict";
import fs from "node:fs";
import {
  detectDatabaseEngine,
  inspectLiveJoinCollations,
  inspectMigrationCollationSql,
  loadDatabaseCollationPolicy,
  normalizeDatabaseEngine,
  resolveDatabaseCollationPolicy,
  runDatabaseCollationPreflight,
} from "./databaseCollationPolicyGuard.js";

const policy = loadDatabaseCollationPolicy();
assert.equal(policy.schema_version, 2);
assert.equal(policy.secrets_included, false);
assert.equal(normalizeDatabaseEngine("11.8.0-MariaDB"), "mariadb");
assert.equal(normalizeDatabaseEngine("8.0.36 MySQL Community Server"), "mysql");
assert.equal(normalizeDatabaseEngine("16.2 PostgreSQL"), "postgresql");
assert.equal(normalizeDatabaseEngine("SQLite 3"), "unknown");
assert.equal(resolveDatabaseCollationPolicy("mariadb", policy, { version: "11.8.0-MariaDB" }).rules.required_default_collation, "utf8mb4_uca1400_ai_ci");
assert.equal(resolveDatabaseCollationPolicy("mysql", policy, { version: "8.0.36" }).rules.required_default_collation, "utf8mb4_0900_ai_ci");
assert.equal(resolveDatabaseCollationPolicy("postgresql", policy, { version: "16.2" }).rules.provider, "icu");

const mariadbSql = `CREATE TABLE governed_example (
  id BIGINT NOT NULL
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;`;
const valid = inspectMigrationCollationSql(mariadbSql, { engine: "mariadb", version: "11.8.0", policy });
assert.equal(valid.ok, true, JSON.stringify(valid));
assert.equal(valid.ready, true);
assert.equal(valid.engine_profile, "mariadb-10-10-uca1400");

const mysqlSql = "CREATE TABLE governed_example (id BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;";
assert.equal(inspectMigrationCollationSql(mysqlSql, { engine: "mysql", version: "8.0.36", policy }).ok, true);
assert.equal(inspectMigrationCollationSql("CREATE TABLE governed_example (id BIGINT NOT NULL);", { engine: "postgresql", version: "16.2", policy }).ok, true);

const implicit = inspectMigrationCollationSql("CREATE TABLE governed_example (id BIGINT NOT NULL);", { engine: "mariadb", version: "11.8", policy });
assert.equal(implicit.ok, false);
assert.equal(implicit.blocked_reason, "collation_policy_violation");
assert(implicit.issues.some((issue) => issue.code === "migration_table_collation_not_explicit"));

const wrongDefault = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (id BIGINT NOT NULL) DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;",
  { engine: "mysql", version: "8.0", policy },
);
assert.equal(wrongDefault.ok, false);
assert(wrongDefault.issues.some((issue) => issue.code === "migration_default_charset_not_allowed"));

const crossEngine = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (id BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;",
  { engine: "mysql", version: "8.0", policy },
);
assert.equal(crossEngine.ok, false);
assert(crossEngine.issues.some((issue) => issue.code === "migration_default_collation_not_allowed"));

const legacy = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (id BIGINT NOT NULL) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;",
  { engine: "mariadb", version: "11.8", policy },
);
assert.equal(legacy.ok, true, JSON.stringify(legacy));
assert(legacy.warnings.some((issue) => issue.code === "legacy_collation_default_warning"));

const binaryJsonColumn = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (payload_json LONGTEXT COLLATE=utf8mb4_bin) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;",
  { engine: "mariadb", version: "11.8", policy },
);
assert.equal(binaryJsonColumn.ok, true, JSON.stringify(binaryJsonColumn));

const binaryRelationalColumn = inspectMigrationCollationSql(
  "CREATE TABLE governed_example (owner_id VARCHAR(64) COLLATE=utf8mb4_bin) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;",
  { engine: "mariadb", version: "11.8", policy },
);
assert.equal(binaryRelationalColumn.ok, false);
assert(binaryRelationalColumn.issues.some((issue) => issue.code === "migration_column_collation_not_allowed"));

const joinMismatchSql = `
CREATE TABLE agent_skill_grants (agent_id VARCHAR(64)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
CREATE TABLE agent_skill_grant_requests (agent_id VARCHAR(64)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
UPDATE agent_skill_grants g
JOIN agent_skill_grant_requests r ON r.agent_id = g.agent_id
SET g.updated_at = g.updated_at;`;
const joinMismatch = inspectMigrationCollationSql(joinMismatchSql, { engine: "mariadb", version: "11.8", policy });
assert.equal(joinMismatch.ok, false, JSON.stringify(joinMismatch));
assert(joinMismatch.issues.some((issue) => issue.code === "join_collation_incompatible"));

const joinPassSql = joinMismatchSql.replaceAll("utf8mb4_unicode_ci", "utf8mb4_uca1400_ai_ci");
const joinPass = inspectMigrationCollationSql(joinPassSql, { engine: "mariadb", version: "11.8", policy });
assert.equal(joinPass.ok, true, JSON.stringify(joinPass));

const livePool = {
  async query(sql, params = []) {
    if (/VERSION\(\)/u.test(sql)) return [[{ version: "11.8.0-MariaDB", version_comment: "MariaDB Server" }]];
    assert.match(sql, /information_schema\.columns/u);
    const [table, column] = params;
    const rows = {
      "agent_skill_grants.agent_id": { TABLE_NAME: "agent_skill_grants", COLUMN_NAME: "agent_id", CHARACTER_SET_NAME: "utf8mb4", COLLATION_NAME: "utf8mb4_uca1400_ai_ci" },
      "agent_skill_grant_requests.agent_id": { TABLE_NAME: "agent_skill_grant_requests", COLUMN_NAME: "agent_id", CHARACTER_SET_NAME: "utf8mb4", COLLATION_NAME: "utf8mb4_unicode_ci" },
    };
    return [[rows[`${table}.${column}`]].filter(Boolean)];
  },
};
const liveJoin = await inspectLiveJoinCollations(livePool, "UPDATE agent_skill_grants g JOIN agent_skill_grant_requests r ON r.agent_id = g.agent_id SET g.updated_at = g.updated_at;", {
  rules: resolveDatabaseCollationPolicy("mariadb", policy, { version: "11.8" }).rules,
});
assert.equal(liveJoin.live_schema_inspected, true);
assert(liveJoin.findings.some((issue) => issue.code === "join_collation_incompatible"));

const detected = await detectDatabaseEngine(livePool);
assert.equal(detected.ok, true);
assert.equal(detected.engine, "mariadb");

const preflight = await runDatabaseCollationPreflight({ pool: livePool, sql: mariadbSql, migration: "test.sql", policy });
assert.equal(preflight.ok, true, JSON.stringify(preflight));
assert.equal(preflight.ready, true);
assert.equal(preflight.migration, "test.sql");
assert.equal(preflight.applies_sql, false);

const blockedPreflight = await runDatabaseCollationPreflight({
  pool: { async query() { return [[{ version: "SQLite 3", version_comment: "" }]]; } },
  sql: mariadbSql,
  migration: "test.sql",
  policy,
});
assert.equal(blockedPreflight.ok, false);
assert.equal(blockedPreflight.blocked_reason, "database_engine_unknown");
assert.equal(blockedPreflight.applies_sql, false);

const runner = fs.readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
assert.match(runner, /runDatabaseCollationPreflight/u);
assert.match(runner, /collation_policy_not_pass/u);

console.log(JSON.stringify({ ok: true, policy: policy.policy_key, tests: 25, join_live_schema: true, secrets_included: false }));
