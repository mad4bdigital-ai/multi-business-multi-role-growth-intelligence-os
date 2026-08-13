import assert from "node:assert/strict";
import {
  RUNTIME_PERSISTENCE_IDENTITY_CONTRACT,
  RUNTIME_PERSISTENCE_PRIVILEGE_MATRIX,
  evaluateRuntimePersistencePrivilegeReadiness,
} from "./runtimePersistenceWriteAuthority.js";

const database = "runtime_test";
const table = "governed_tool_response_chunks";
const exactTablePrivileges = RUNTIME_PERSISTENCE_PRIVILEGE_MATRIX[table].map((PRIVILEGE_TYPE) => ({
  TABLE_SCHEMA: database,
  TABLE_NAME: table,
  PRIVILEGE_TYPE,
  IS_GRANTABLE: "NO",
}));

assert.equal(RUNTIME_PERSISTENCE_IDENTITY_CONTRACT.identity_env, "RUNTIME_PERSISTENCE_DB_USER");
assert.equal(RUNTIME_PERSISTENCE_IDENTITY_CONTRACT.mode, "dedicated_runtime_persistence_writer");
assert.equal(RUNTIME_PERSISTENCE_IDENTITY_CONTRACT.separated_identity_required, true);
assert.deepEqual(RUNTIME_PERSISTENCE_PRIVILEGE_MATRIX[table], ["SELECT", "INSERT", "UPDATE", "DELETE"]);

const exact = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  userPrivileges: [{ PRIVILEGE_TYPE: "USAGE" }],
  tablePrivileges: exactTablePrivileges,
});
assert.equal(exact.ready, true);
assert.equal(exact.required_privilege_count, 4);
assert.deepEqual(exact.missing_required, []);

const persistOnly = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  requiredOperations: ["SELECT", "INSERT", "UPDATE"],
  userPrivileges: [{ PRIVILEGE_TYPE: "USAGE" }],
  tablePrivileges: exactTablePrivileges.filter((row) => row.PRIVILEGE_TYPE !== "DELETE"),
});
assert.equal(persistOnly.ready, true, "persist need not require cleanup DELETE on the hot write path");

const missingUpdate = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  requiredOperations: ["SELECT", "INSERT", "UPDATE"],
  userPrivileges: [{ PRIVILEGE_TYPE: "USAGE" }],
  tablePrivileges: exactTablePrivileges.filter((row) => row.PRIVILEGE_TYPE !== "UPDATE"),
});
assert.equal(missingUpdate.ready, false);
assert.deepEqual(missingUpdate.missing_required, ["UPDATE"]);

const missingDelete = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  requiredOperations: ["DELETE"],
  userPrivileges: [{ PRIVILEGE_TYPE: "USAGE" }],
  tablePrivileges: exactTablePrivileges.filter((row) => row.PRIVILEGE_TYPE !== "DELETE"),
});
assert.equal(missingDelete.ready, false);
assert.deepEqual(missingDelete.missing_required, ["DELETE"]);

const broadSchemaWrite = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  requiredOperations: ["INSERT"],
  schemaPrivileges: [{ TABLE_SCHEMA: database, PRIVILEGE_TYPE: "INSERT" }],
  tablePrivileges: exactTablePrivileges,
});
assert.equal(broadSchemaWrite.ready, false);
assert.equal(broadSchemaWrite.checks.no_schema_wide_write_privileges, false);

const broadGlobalWrite = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  requiredOperations: ["UPDATE"],
  userPrivileges: [{ PRIVILEGE_TYPE: "UPDATE" }],
  tablePrivileges: exactTablePrivileges,
});
assert.equal(broadGlobalWrite.ready, false);
assert.equal(broadGlobalWrite.checks.no_global_write_privileges, false);

const extraTargetPrivilege = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  tablePrivileges: [
    ...exactTablePrivileges,
    { TABLE_SCHEMA: database, TABLE_NAME: table, PRIVILEGE_TYPE: "ALTER", IS_GRANTABLE: "NO" },
  ],
});
assert.equal(extraTargetPrivilege.ready, false);
assert.equal(extraTargetPrivilege.extra_target_table_privilege_count, 1);

const columnGrant = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  tablePrivileges: exactTablePrivileges,
  columnPrivileges: [{
    TABLE_SCHEMA: database,
    TABLE_NAME: table,
    COLUMN_NAME: "response_json",
    PRIVILEGE_TYPE: "UPDATE",
  }],
});
assert.equal(columnGrant.ready, false);
assert.equal(columnGrant.target_column_privilege_count, 1);

const grantOption = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  tablePrivileges: exactTablePrivileges.map((row, index) => index === 0 ? { ...row, IS_GRANTABLE: "YES" } : row),
});
assert.equal(grantOption.ready, false);
assert.equal(grantOption.target_grant_option_count, 1);

const roleDerivedAmbiguity = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  tablePrivileges: exactTablePrivileges,
  applicableRoles: [{ ROLE_NAME: "runtime_writer_role" }],
});
assert.equal(roleDerivedAmbiguity.ready, false);
assert.equal(roleDerivedAmbiguity.applicable_role_count, 1);

const unrelatedDirectPrivileges = evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table,
  tablePrivileges: [
    ...exactTablePrivileges,
    { TABLE_SCHEMA: database, TABLE_NAME: "tenant_requests", PRIVILEGE_TYPE: "INSERT", IS_GRANTABLE: "NO" },
    { TABLE_SCHEMA: database, TABLE_NAME: "execution_log", PRIVILEGE_TYPE: "UPDATE", IS_GRANTABLE: "NO" },
  ],
});
assert.equal(unrelatedDirectPrivileges.ready, true, "shared DB_USER may retain unrelated table-scoped runtime grants");
assert.equal(unrelatedDirectPrivileges.unrelated_table_privilege_count, 2);
assert.equal(unrelatedDirectPrivileges.unrelated_table_privileges_ignored, true);

console.log("runtime persistence DB_USER privilege contract tests passed");
