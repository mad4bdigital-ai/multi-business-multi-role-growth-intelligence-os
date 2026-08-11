import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GOVERNANCE_DB_PRIVILEGE_MATRIX,
  assertGovernanceDbPrivilegeReadiness,
  evaluateGovernanceDbPrivilegeReadiness,
} from "./governanceDbPrivilegeContract.js";
import { runGovernanceDbPrivilegeReadiness } from "./governanceDbPrivilegeReadinessService.js";
import {
  getGovernanceDbPrivilegeReadinessSnapshot,
  projectGovernanceDbPrivilegeReadiness,
  resetGovernanceDbPrivilegeReadinessRuntimeCacheForTest,
} from "./governanceDbPrivilegeReadinessRuntime.js";

const database = "growth_os";

function completeTablePrivileges() {
  return Object.entries(GOVERNANCE_DB_PRIVILEGE_MATRIX).flatMap(([table, operations]) =>
    operations.map((operation) => ({
      TABLE_SCHEMA: database,
      TABLE_NAME: table,
      PRIVILEGE_TYPE: operation,
    })),
  );
}

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    userPrivileges: [{ PRIVILEGE_TYPE: "USAGE" }],
    schemaPrivileges: [],
    tablePrivileges: completeTablePrivileges(),
    columnPrivileges: [],
    applicableRoles: [],
  });
  assert.equal(result.ready, true);
  assert.equal(result.required_privilege_count, 14);
  assert.equal(result.observed_required_privilege_count, 14);
  assert.deepEqual(result.missing_required, []);
  assert.equal(result.unexpected_column_privilege_count, 0);
  assert.equal(result.applicable_role_count, 0);
  assert.equal(result.secrets_included, false);
}

{
  const rows = completeTablePrivileges().filter(
    (row) => !(row.TABLE_NAME === "capability_resolution_envelope_ledger" && row.PRIVILEGE_TYPE === "INSERT"),
  );
  const result = evaluateGovernanceDbPrivilegeReadiness({ database, tablePrivileges: rows });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing_required, ["capability_resolution_envelope_ledger:INSERT"]);
}

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    tablePrivileges: [
      ...completeTablePrivileges(),
      { TABLE_SCHEMA: database, TABLE_NAME: "runtime_dispatch_certification_registry", PRIVILEGE_TYPE: "DELETE" },
    ],
  });
  assert.equal(result.ready, false);
  assert.equal(result.unexpected_table_privilege_count, 1);
}

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    tablePrivileges: [
      ...completeTablePrivileges(),
      { TABLE_SCHEMA: database, TABLE_NAME: "users", PRIVILEGE_TYPE: "SELECT" },
      { TABLE_SCHEMA: "another_schema", TABLE_NAME: "audit_log", PRIVILEGE_TYPE: "SELECT" },
    ],
  });
  assert.equal(result.ready, false);
  assert.equal(result.unexpected_table_scope_count, 2);
}

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    userPrivileges: [
      { PRIVILEGE_TYPE: "USAGE" },
      { PRIVILEGE_TYPE: "PROCESS" },
    ],
    schemaPrivileges: [{ TABLE_SCHEMA: database, PRIVILEGE_TYPE: "SELECT" }],
    tablePrivileges: completeTablePrivileges(),
  });
  assert.equal(result.ready, false);
  assert.equal(result.unexpected_global_privilege_count, 1);
  assert.equal(result.unexpected_schema_privilege_count, 1);
}

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    tablePrivileges: completeTablePrivileges(),
    columnPrivileges: [{
      TABLE_SCHEMA: database,
      TABLE_NAME: "approval_holds",
      COLUMN_NAME: "id",
      PRIVILEGE_TYPE: "SELECT",
    }],
  });
  assert.equal(result.ready, false);
  assert.equal(result.unexpected_column_privilege_count, 1);
  assert.equal(result.checks.no_column_level_privileges, false);
}

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    tablePrivileges: completeTablePrivileges(),
    applicableRoles: [{ ROLE_NAME: "governance_admin" }],
  });
  assert.equal(result.ready, false);
  assert.equal(result.applicable_role_count, 1);
  assert.equal(result.checks.no_applicable_roles, false);
}

{
  const secret = "do-not-leak-governance-password";
  let caught = null;
  try {
    assertGovernanceDbPrivilegeReadiness({
      database,
      tablePrivileges: completeTablePrivileges().slice(1),
      password: secret,
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.code, "GOVERNANCE_DB_PRIVILEGE_READINESS_FAILED");
  assert.equal(caught?.details?.secrets_included, false);
  assert.equal(JSON.stringify(caught).includes(secret), false);
  assert.equal(JSON.stringify(caught?.details).includes(secret), false);
}

{
  const queries = [];
  const connection = {
    async ping() {},
    async query(sql) {
      queries.push(sql);
      if (sql.includes("CURRENT_USER()")) {
        return [[{ current_account: "governance_writer@localhost", current_database: database }]];
      }
      if (sql.includes("USER_PRIVILEGES")) return [[{ PRIVILEGE_TYPE: "USAGE" }]];
      if (sql.includes("SCHEMA_PRIVILEGES")) return [[]];
      if (sql.includes("TABLE_PRIVILEGES")) return [completeTablePrivileges()];
      if (sql.includes("COLUMN_PRIVILEGES")) return [[]];
      if (sql.includes("APPLICABLE_ROLES")) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {
      queries.push("release");
    },
  };
  const result = await runGovernanceDbPrivilegeReadiness(
    { env: {} },
    {
      runtimePool: { marker: "runtime-reader" },
      governancePool: { async getConnection() { return connection; } },
      resolveGovernanceDbConfig: () => ({ database }),
      resolveGovernanceProductionPreflight: async () => ({
        ready: true,
        governance_db: { identity_configured: true },
        environment_authority: {
          production_branch: "Production",
          promotion_target_branch: "Production",
        },
      }),
    },
  );
  assert.equal(result.ready, true);
  assert.equal(result.privilege_readiness.ready, true);
  assert.equal(result.database_connection_performed, true);
  assert.equal(result.sql_readback_performed, true);
  assert.equal(result.sql_mutation_performed, false);
  assert.equal(result.secrets_included, false);
  assert.equal(queries.includes("release"), true);
}

{
  const projected = projectGovernanceDbPrivilegeReadiness({
    ready: false,
    code: "GOVERNANCE_DB_PRIVILEGE_READINESS_FAILED",
    details: {
      missing_required: ["capability_resolution_envelope_ledger:INSERT"],
      raw_username: "must-not-be-public",
      secrets_included: false,
    },
    database_connection_performed: true,
    sql_readback_performed: true,
  });
  const serialized = JSON.stringify(projected);
  assert.equal(projected.ready, false);
  assert.equal(projected.code, "GOVERNANCE_DB_PRIVILEGE_READINESS_FAILED");
  assert.equal(serialized.includes("capability_resolution_envelope_ledger:INSERT"), false);
  assert.equal(serialized.includes("must-not-be-public"), false);
  assert.equal(projected.secrets_included, false);
}

{
  resetGovernanceDbPrivilegeReadinessRuntimeCacheForTest();
  let calls = 0;
  const runner = async () => {
    calls += 1;
    return {
      ready: true,
      production_preflight_ready: true,
      production_branch_exact: true,
      promotion_target_branch_exact: true,
      governance_identity_configured: true,
      privilege_readiness: { ready: true },
      database_connection_performed: true,
      sql_readback_performed: true,
      sql_mutation_performed: false,
      secrets_included: false,
    };
  };
  let now = Date.parse("2026-08-10T19:00:00Z");
  const first = await getGovernanceDbPrivilegeReadinessSnapshot(
    { ttlMs: 60_000 },
    { runner, now: () => now },
  );
  now += 1_000;
  const second = await getGovernanceDbPrivilegeReadinessSnapshot(
    { ttlMs: 60_000 },
    { runner, now: () => now },
  );
  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.equal(calls, 1);
  assert.equal(first.privilege_matrix_exact, true);
  assert.equal(first.secrets_included, false);
  resetGovernanceDbPrivilegeReadinessRuntimeCacheForTest();
}

{
  const workflow = readFileSync(
    new URL("../.github/workflows/governance-db-privilege-readiness.yml", import.meta.url),
    "utf8",
  );
  assert.equal(workflow.includes("secrets.DB_HOST"), false);
  assert.equal(workflow.includes("secrets.GOVERNANCE_DB_PASSWORD"), false);
  assert.match(workflow, /include_governance_db_readiness=1/);
  assert.match(workflow, /runtime_commit_exact/);
  assert.match(workflow, /Re-read exact Production head after runtime evidence/);
  assert.match(workflow, /database_connection_performed_by_github_runner: false/);
}

console.log("governance DB privilege readiness contract: ok");
