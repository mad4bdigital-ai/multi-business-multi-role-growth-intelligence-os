import assert from "node:assert/strict";
import {
  assessDatabaseCollationPolicy,
  detectDatabaseEngineFamily,
  extractSqlJoinComparisons,
  loadDatabaseEngineCollationPolicy,
  resolveDatabaseEngineProfile,
} from "./databaseCollationPolicyGuard.js";

const policy = loadDatabaseEngineCollationPolicy();
assert.equal(policy.contract, "mad4b.database-engine-collation-policy.v1");
assert.equal(detectDatabaseEngineFamily("11.8.8-MariaDB"), "mariadb");
assert.equal(detectDatabaseEngineFamily("8.0.42 MySQL Community Server"), "mysql");
assert.equal(detectDatabaseEngineFamily("PostgreSQL 16.4"), "postgresql");
assert.equal(detectDatabaseEngineFamily("future-db"), "unknown");
assert.equal(resolveDatabaseEngineProfile({ version: "11.8.8-MariaDB" }, policy).profile.profile_key, "mariadb_10_10_plus");
assert.equal(resolveDatabaseEngineProfile({ version: "8.0.42 MySQL Community Server" }, policy).profile.profile_key, "mysql_8_plus");
assert.equal(resolveDatabaseEngineProfile({ version: "PostgreSQL 16.4" }, policy).profile.profile_key, "postgresql_16_plus");

const joins = extractSqlJoinComparisons("UPDATE agent_skill_grants g JOIN agent_skill_grant_requests r ON r.agent_id = g.agent_id SET g.updated_at=NOW();");
assert.equal(joins.length, 1);
assert.equal(joins[0].left.table, "agent_skill_grant_requests");
assert.equal(joins[0].right.table, "agent_skill_grants");

const mariadbObservation = async () => ({ version: "11.8.8-MariaDB", character_set_server: "utf8mb4", collation_server: "utf8mb4_uca1400_ai_ci" });
const mysqlObservation = async () => ({ version: "8.0.42 MySQL Community Server", character_set_server: "utf8mb4", collation_server: "utf8mb4_0900_ai_ci" });
const postgresObservation = async () => ({ version: "PostgreSQL 16.4" });

const mariaWrongEngine = await assessDatabaseCollationPolicy("CREATE TABLE x (name VARCHAR(20)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;", { observeDatabase: mariadbObservation });
assert.equal(mariaWrongEngine.status, "block");
assert.ok(mariaWrongEngine.findings.some((finding) => finding.code === "database_engine_collation_forbidden"));

const mysqlWrongEngine = await assessDatabaseCollationPolicy("CREATE TABLE x (name VARCHAR(20)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;", { observeDatabase: mysqlObservation });
assert.equal(mysqlWrongEngine.status, "block");

const postgresMysqlCollation = await assessDatabaseCollationPolicy("CREATE TABLE x (name VARCHAR(20)) COLLATE=utf8mb4_unicode_ci;", { observeDatabase: postgresObservation });
assert.equal(postgresMysqlCollation.status, "block");

const legacy = await assessDatabaseCollationPolicy("CREATE TABLE x (name VARCHAR(20)) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;", { observeDatabase: mariadbObservation });
assert.equal(legacy.status, "warn");

const mismatchedJoin = await assessDatabaseCollationPolicy(
  "UPDATE agent_skill_grants g JOIN agent_skill_grant_requests r ON r.agent_id = g.agent_id SET g.updated_at=NOW();",
  {
    observeDatabase: mariadbObservation,
    readColumnContracts: async () => [
      { table: "agent_skill_grants", column: "agent_id", charset: "utf8mb4", collation: "utf8mb4_uca1400_ai_ci" },
      { table: "agent_skill_grant_requests", column: "agent_id", charset: "utf8mb4", collation: "utf8mb4_unicode_ci" },
    ],
  },
);
assert.equal(mismatchedJoin.status, "block");
assert.ok(mismatchedJoin.findings.some((finding) => finding.code === "join_collation_incompatible"));

const matchedJoin = await assessDatabaseCollationPolicy(
  "UPDATE agent_skill_grants g JOIN agent_skill_grant_requests r ON r.agent_id = g.agent_id SET g.updated_at=NOW();",
  {
    observeDatabase: mariadbObservation,
    readColumnContracts: async () => [
      { table: "agent_skill_grants", column: "agent_id", charset: "utf8mb4", collation: "utf8mb4_uca1400_ai_ci" },
      { table: "agent_skill_grant_requests", column: "agent_id", charset: "utf8mb4", collation: "utf8mb4_uca1400_ai_ci" },
    ],
  },
);
assert.equal(matchedJoin.status, "pass");

const unknown = await assessDatabaseCollationPolicy("SELECT 1;", { observeDatabase: async () => ({ version: "FutureDB 1.0" }) });
assert.equal(unknown.status, "block");
assert.equal(unknown.findings[0].code, "database_engine_profile_unresolved");

console.log("database collation policy tests passed");
