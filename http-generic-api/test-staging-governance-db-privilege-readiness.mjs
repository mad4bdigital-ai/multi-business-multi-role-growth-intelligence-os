import assert from "node:assert/strict";

import {
  GOVERNANCE_DB_PRIVILEGE_MATRIX,
  STAGING_ROLE_GRANT_POLICIES,
} from "./databasePrivilegeContracts.js";
import { evaluateGovernanceDbPrivilegeReadiness } from "./governanceDbPrivilegeContract.js";
import { runGovernanceDbPrivilegeReadiness } from "./governanceDbPrivilegeReadinessService.js";

const database = "growth_governance";
const stagingPrivilegeMatrix = STAGING_ROLE_GRANT_POLICIES.governance.required_operations_by_table;

function privilegeCount(matrix) {
  return Object.values(matrix).reduce((count, operations) => count + operations.length, 0);
}

function completeTablePrivileges(matrix) {
  return Object.entries(matrix).flatMap(([table, operations]) =>
    operations.map((operation) => ({
      TABLE_SCHEMA: database,
      TABLE_NAME: table,
      PRIVILEGE_TYPE: operation,
    })),
  );
}

function completeSchemaRows(matrix) {
  return Object.keys(matrix).map((table) => ({ TABLE_NAME: table }));
}

function createReadinessConnection(matrix) {
  const schemaRows = completeSchemaRows(matrix);
  const tablePrivileges = completeTablePrivileges(matrix);
  return {
    async ping() {},
    async query(sql) {
      if (sql.includes("CURRENT_USER()")) {
        return [[{
          current_account: "governance_writer@localhost",
          current_database: database,
        }]];
      }
      if (sql.includes("information_schema.TABLES")) return [schemaRows];
      if (sql.includes("USER_PRIVILEGES")) return [[{ PRIVILEGE_TYPE: "USAGE" }]];
      if (sql.includes("SCHEMA_PRIVILEGES")) return [[]];
      if (sql.includes("TABLE_PRIVILEGES")) return [tablePrivileges];
      if (sql.includes("COLUMN_PRIVILEGES")) return [[]];
      if (sql.includes("APPLICABLE_ROLES")) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {},
  };
}

function readinessDeps(connection) {
  return {
    runtimePool: { marker: "runtime-reader" },
    governancePool: {
      async getConnection() {
        return connection;
      },
    },
    resolveGovernanceDbConfig: () => ({ database }),
    resolveGovernanceProductionPreflight: async () => ({
      ready: true,
      governance_db: { identity_configured: true },
      environment_authority: {
        production_branch: "Production",
        promotion_target_branch: "Production",
      },
    }),
  };
}

assert.equal(Object.keys(GOVERNANCE_DB_PRIVILEGE_MATRIX).length, 17);
assert.equal(privilegeCount(GOVERNANCE_DB_PRIVILEGE_MATRIX), 39);
assert.equal(Object.keys(stagingPrivilegeMatrix).length, 20);
assert.equal(privilegeCount(stagingPrivilegeMatrix), 46);

for (const [table, operations] of Object.entries(GOVERNANCE_DB_PRIVILEGE_MATRIX)) {
  assert.deepEqual(stagingPrivilegeMatrix[table], operations);
}
assert.deepEqual(stagingPrivilegeMatrix.staging_activation_gateway_execution_artifacts, ["SELECT", "INSERT"]);
assert.deepEqual(stagingPrivilegeMatrix.staging_activation_gateway_execution_plans, ["SELECT", "INSERT", "UPDATE"]);
assert.deepEqual(stagingPrivilegeMatrix.staging_activation_gateway_envelope_plan_bindings, ["SELECT", "INSERT"]);

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    tablePrivileges: completeTablePrivileges(stagingPrivilegeMatrix),
  });
  assert.equal(result.ready, false);
  assert.equal(result.required_privilege_count, 39);
  assert.equal(result.observed_required_privilege_count, 39);
  assert.equal(result.unexpected_table_scope_count, 7);
  assert.equal(result.checks.no_unexpected_table_scopes, false);
}

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    tablePrivileges: completeTablePrivileges(stagingPrivilegeMatrix),
    expectedPrivilegeMatrix: stagingPrivilegeMatrix,
  });
  assert.equal(result.ready, true);
  assert.equal(result.required_privilege_count, 46);
  assert.equal(result.observed_required_privilege_count, 46);
  assert.equal(result.unexpected_table_scope_count, 0);
  assert.deepEqual(result.missing_required, []);
}

{
  const rows = completeTablePrivileges(stagingPrivilegeMatrix).filter(
    (row) => !(row.TABLE_NAME === "staging_activation_gateway_execution_plans" && row.PRIVILEGE_TYPE === "UPDATE"),
  );
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    tablePrivileges: rows,
    expectedPrivilegeMatrix: stagingPrivilegeMatrix,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing_required, ["staging_activation_gateway_execution_plans:UPDATE"]);
}

{
  const result = evaluateGovernanceDbPrivilegeReadiness({
    database,
    tablePrivileges: [
      ...completeTablePrivileges(stagingPrivilegeMatrix),
      { TABLE_SCHEMA: database, TABLE_NAME: "unexpected_governance_surface", PRIVILEGE_TYPE: "SELECT" },
    ],
    expectedPrivilegeMatrix: stagingPrivilegeMatrix,
  });
  assert.equal(result.ready, false);
  assert.equal(result.unexpected_table_scope_count, 1);
  assert.equal(result.checks.no_unexpected_table_scopes, false);
}

{
  const result = await runGovernanceDbPrivilegeReadiness(
    { env: { DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker" } },
    readinessDeps(createReadinessConnection(stagingPrivilegeMatrix)),
  );
  assert.equal(result.ready, true);
  assert.equal(result.status, "ready");
  assert.equal(result.schema_readiness.required_table_count, 20);
  assert.equal(result.schema_readiness.observed_required_table_count, 20);
  assert.equal(result.privilege_readiness.required_privilege_count, 46);
  assert.equal(result.privilege_readiness.observed_required_privilege_count, 46);
  assert.equal(result.privilege_readiness.unexpected_table_scope_count, 0);
  assert.equal(result.sql_mutation_performed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.deployment_performed, false);
}

{
  const result = await runGovernanceDbPrivilegeReadiness(
    { env: {} },
    readinessDeps(createReadinessConnection(GOVERNANCE_DB_PRIVILEGE_MATRIX)),
  );
  assert.equal(result.ready, true);
  assert.equal(result.status, "ready");
  assert.equal(result.schema_readiness.required_table_count, 17);
  assert.equal(result.schema_readiness.observed_required_table_count, 17);
  assert.equal(result.privilege_readiness.required_privilege_count, 39);
  assert.equal(result.privilege_readiness.observed_required_privilege_count, 39);
  assert.equal(result.sql_mutation_performed, false);
}

console.log("staging governance DB privilege readiness overlay: ok");
