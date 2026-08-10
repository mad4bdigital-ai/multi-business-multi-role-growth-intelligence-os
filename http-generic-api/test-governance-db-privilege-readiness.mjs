import assert from "node:assert/strict";

import {
  GOVERNANCE_DB_PRIVILEGE_MATRIX,
  assertGovernanceDbPrivilegeReadiness,
  evaluateGovernanceDbPrivilegeReadiness,
} from "./governanceDbPrivilegeContract.js";

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

console.log("governance DB privilege readiness contract: ok");
