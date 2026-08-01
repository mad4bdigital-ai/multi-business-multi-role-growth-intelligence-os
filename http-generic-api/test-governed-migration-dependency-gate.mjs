import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";
import {
  checkGovernedMigrationDependencies,
  loadGovernedMigrationDependencyRegistry,
  resolveGovernedMigrationDependencyPlan,
} from "./scripts/governed-migration-dependency-gate.mjs";

const MIGRATION_1006 = "1006_sprint69_agent_capability_evidence_coverage.sql";
const CHECKSUM_1006 = "995c657922413f9917fd4d93ac1213e76bc66b077c68646e4f5572c62c744374";
const MIGRATION_1007 = "1007_sprint69_agent_capability_coverage_admin_tools.sql";
const CHECKSUM_1007 = "11b93401bbd0ed64e3e564d183c5a5d9775bcabbe3ccd7002d97e38b0d107a40";

function migrationEvidence(migration) {
  const sql = readFileSync(new URL(`./migrations/${migration}`, import.meta.url), "utf8");
  return {
    checksum_sha256: createHash("sha256").update(sql, "utf8").digest("hex"),
    statement_count: splitMigrationSqlStatements(sql).length,
  };
}

assert.deepEqual(migrationEvidence(MIGRATION_1006), {
  checksum_sha256: CHECKSUM_1006,
  statement_count: 5,
});
assert.deepEqual(migrationEvidence(MIGRATION_1007), {
  checksum_sha256: CHECKSUM_1007,
  statement_count: 1,
});

const protectedRegionSql = `
-- A SELECT token inside a comment is not a boundary.
SET @dynamic_sql := 'SELECT 1; SELECT 2; still one string';
/* SELECT 99; remains comment text. */
SELECT JSON_OBJECT('message', 'alpha; SELECT beta', 'enabled', true) AS payload;
SELECT "quoted; SELECT text" AS note;
`;
const protectedStatements = splitMigrationSqlStatements(protectedRegionSql);
assert.equal(protectedStatements.length, 3);
assert.match(protectedStatements[0], /^SET\s+@dynamic_sql/i);
assert.match(protectedStatements[0], /SELECT 1; SELECT 2; still one string/);
assert.match(protectedStatements[1], /^SELECT\s+JSON_OBJECT/i);
assert.match(protectedStatements[1], /alpha; SELECT beta/);
assert.match(protectedStatements[2], /^SELECT\s+"quoted; SELECT text"/i);

const hostingerPolicySql = readFileSync(
  new URL("./migrations/20260730_hostinger_production_resync_policy.sql", import.meta.url),
  "utf8",
);
const hostingerPolicyStatements = splitMigrationSqlStatements(hostingerPolicySql);
assert.equal(hostingerPolicyStatements.length, 10);
assert.match(hostingerPolicyStatements[7], /^INSERT\s+INTO/i);
assert.match(hostingerPolicyStatements[8], /^SELECT\b/i);
assert.match(hostingerPolicyStatements[9], /^SELECT\b/i);

const registry = await loadGovernedMigrationDependencyRegistry();
assert.equal(registry.schema_version, "governed_migration_dependencies.v1");
assert.equal(registry.secrets_included, false);
assert.deepEqual(registry.migrations[MIGRATION_1007], {
  checksum_sha256: CHECKSUM_1007,
  statement_count: 1,
  dependencies: [{
    migration: MIGRATION_1006,
    checksum_sha256: CHECKSUM_1006,
    statement_count: 5,
    required_ledger_mode: "apply",
  }],
});

const plan = await resolveGovernedMigrationDependencyPlan({
  migration: MIGRATION_1007,
  expected_checksum_sha256: CHECKSUM_1007,
  expected_statement_count: 1,
}, { registry });
assert.equal(plan.dependency_contract_declared, true);
assert.equal(plan.dependency_count, 1);
assert.equal(plan.dependencies[0].migration, MIGRATION_1006);
assert.equal(plan.dependencies[0].required_ledger_mode, "apply");
assert.equal(plan.applies_sql, false);
assert.equal(plan.secrets_included, false);

await assert.rejects(
  () => resolveGovernedMigrationDependencyPlan({
    migration: MIGRATION_1007,
    expected_checksum_sha256: "0".repeat(64),
    expected_statement_count: 1,
  }, { registry }),
  (error) => error?.code === "governed_migration_dependency_registry_target_mismatch",
);

let dependencyReadbackCalls = 0;
const passed = await checkGovernedMigrationDependencies({
  migration: MIGRATION_1007,
  expected_checksum_sha256: CHECKSUM_1007,
  expected_statement_count: 1,
}, {
  registry,
  readback: async (dependency) => {
    dependencyReadbackCalls += 1;
    return {
      ok: true,
      readback_status: "pass",
      migration_checksum_sha256: dependency.checksum_sha256,
      statement_count: dependency.statement_count,
      ledger: {
        found: true,
        mode: "apply",
        migration_checksum_sha256: dependency.checksum_sha256,
        statement_count: dependency.statement_count,
      },
      secrets_included: false,
    };
  },
});
assert.equal(dependencyReadbackCalls, 1);
assert.equal(passed.ok, true);
assert.equal(passed.all_dependencies_satisfied, true);
assert.equal(passed.dependencies[0].satisfied, true);
assert.equal(passed.database_mutation_executed, false);
assert.equal(passed.provider_call_executed, false);
assert.equal(passed.external_write_executed, false);
assert.equal(passed.secrets_included, false);

await assert.rejects(
  () => checkGovernedMigrationDependencies({
    migration: MIGRATION_1007,
    expected_checksum_sha256: CHECKSUM_1007,
    expected_statement_count: 1,
  }, {
    registry,
    readback: async (dependency) => ({
      readback_status: "fail",
      migration_checksum_sha256: dependency.checksum_sha256,
      statement_count: dependency.statement_count,
      ledger: { found: false },
    }),
  }),
  (error) =>
    error?.code === "governed_migration_dependency_unsatisfied" &&
    error?.details?.observed_ledger_found === false &&
    error?.details?.applies_sql === false,
);

await assert.rejects(
  () => checkGovernedMigrationDependencies({
    migration: MIGRATION_1007,
    expected_checksum_sha256: CHECKSUM_1007,
    expected_statement_count: 1,
  }, {
    registry,
    readback: async (dependency) => ({
      readback_status: "pass",
      migration_checksum_sha256: dependency.checksum_sha256,
      statement_count: dependency.statement_count,
      ledger: { found: true, mode: "record_only" },
    }),
  }),
  (error) =>
    error?.code === "governed_migration_dependency_unsatisfied" &&
    error?.details?.observed_ledger_mode === "record_only",
);

let noDependencyReadbackCalls = 0;
const noDependencyResult = await checkGovernedMigrationDependencies({
  migration: MIGRATION_1006,
  expected_checksum_sha256: CHECKSUM_1006,
  expected_statement_count: 5,
}, {
  registry,
  readback: async () => {
    noDependencyReadbackCalls += 1;
    throw new Error("readback must not run for an undeclared dependency plan");
  },
});
assert.equal(noDependencyReadbackCalls, 0);
assert.equal(noDependencyResult.dependency_contract_declared, false);
assert.equal(noDependencyResult.dependency_count, 0);
assert.equal(noDependencyResult.all_dependencies_satisfied, true);

const cycleRegistrySource = JSON.stringify({
  schema_version: "governed_migration_dependencies.v1",
  migrations: {
    "a.sql": {
      checksum_sha256: "a".repeat(64),
      statement_count: 1,
      dependencies: [{
        migration: "b.sql",
        checksum_sha256: "b".repeat(64),
        statement_count: 1,
        required_ledger_mode: "apply",
      }],
    },
    "b.sql": {
      checksum_sha256: "b".repeat(64),
      statement_count: 1,
      dependencies: [{
        migration: "a.sql",
        checksum_sha256: "a".repeat(64),
        statement_count: 1,
        required_ledger_mode: "apply",
      }],
    },
  },
});
await assert.rejects(
  () => loadGovernedMigrationDependencyRegistry({
    registryPath: "/virtual/governed-migration-dependencies.json",
    readFile: async () => cycleRegistrySource,
  }),
  (error) => error?.code === "governed_migration_dependency_cycle",
);

console.log("governed migration dependency gate tests passed");
