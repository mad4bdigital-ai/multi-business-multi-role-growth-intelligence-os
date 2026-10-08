// Read-only, three-identity Staging database privilege drift diagnostic.
// Does not execute GRANT/REVOKE, schema writes, or read credential values.
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { getPool, getRuntimePersistencePool } from "../db.js";
import { getGovernancePool } from "../governanceDb.js";
import {
  STAGING_ROLE_GRANT_POLICIES,
  LOCAL_MANAGER_WRITE_DB_PRIVILEGE_MATRIX,
} from "../databasePrivilegeContracts.js";

const ROLES = ["runtime", "governance", "runtime_persistence"];
const normalized = (value) => String(value ?? "").trim();
const ordered = (values) => [...new Set(values)].sort();
const normalizeGrantAccount = (account) => {
  const value = normalized(account);
  const split = value.lastIndexOf("@");
  if (split <= 0 || split === value.length - 1) {
    throw Object.assign(new Error("Invalid effective MariaDB principal"), { code: "STAGING_PRIVILEGE_IDENTITY_INVALID" });
  }
  const quote = (part) => "'" + part.replaceAll("'", "''") + "'";
  return quote(value.slice(0, split)) + "@" + quote(value.slice(split + 1));
};

export function compareRolePrivilegeEvidence({
  role, expectedDatabase, identityRows = [], tableRows = [], tablePrivilegeRows = [],
  userPrivilegeRows = [], schemaPrivilegeRows = [], columnPrivilegeRows = [], applicableRoleRows = [],
} = {}) {
  const spec = STAGING_ROLE_GRANT_POLICIES[role];
  if (!spec || !expectedDatabase) throw new Error("Unknown role or missing configured database");
  const currentDatabase = normalized(identityRows[0]?.current_database);
  const currentAccount = normalized(identityRows[0]?.current_account);
  // No plaintext identity is emitted, only a cross-role discriminator used by the orchestrator.
  const principal = normalizeGrantAccount(currentAccount);
  const visible = new Set(tableRows.map((row) => normalized(row.TABLE_NAME)));
  const optional = new Set(spec.optional_tables || []);
  const tables = [...spec.required_tables, ...spec.optional_tables];
  const operationsByTable = spec.required_operations_by_table || {};
  const expected = new Set();
  const invisibleRequired = [];
  const invisibleOptional = [];
  for (const table of tables) {
    if (!visible.has(table)) {
      (optional.has(table) ? invisibleOptional : invisibleRequired).push(table);
      continue;
    }
    for (const op of (operationsByTable[table] || spec.required_operations)) {
      expected.add(table + ":" + normalized(op).toUpperCase());
    }
  }
  const actual = new Set();
  const otherDatabaseGrants = [];
  const grantOptionTables = [];
  for (const row of tablePrivilegeRows) {
    const schema = normalized(row.TABLE_SCHEMA);
    const table = normalized(row.TABLE_NAME);
    const privilege = normalized(row.PRIVILEGE_TYPE).toUpperCase();
    if (normalized(row.IS_GRANTABLE).toUpperCase() === "YES") {
      grantOptionTables.push(schema + "." + table);
    }
    if (schema === currentDatabase) actual.add(table + ":" + privilege);
    else otherDatabaseGrants.push(schema + "." + table + ":" + privilege);
  }
  const missing = ordered([...expected].filter((key) => !actual.has(key)));
  const excessive = ordered([...actual].filter((key) => !expected.has(key)));
  const unexpectedGlobal = ordered(userPrivilegeRows.map((row) => normalized(row.PRIVILEGE_TYPE).toUpperCase()).filter((x) => x && x !== "USAGE"));
  const unexpectedSchemas = ordered(schemaPrivilegeRows.filter((row) => normalized(row.PRIVILEGE_TYPE).toUpperCase() !== "USAGE").map((row) => normalized(row.TABLE_SCHEMA) + ":" + normalized(row.PRIVILEGE_TYPE).toUpperCase()));
  const unexpectedColumns = ordered(columnPrivilegeRows.map((row) => normalized(row.TABLE_SCHEMA) + "." + normalized(row.TABLE_NAME) + "." + normalized(row.COLUMN_NAME) + ":" + normalized(row.PRIVILEGE_TYPE).toUpperCase()));
  const applicableRoleCount = applicableRoleRows.length;
  const databaseMatches = currentDatabase === expectedDatabase;
  const issues = [];
  if (!databaseMatches) issues.push("DATABASE_IDENTITY_MISMATCH");
  if (invisibleRequired.length) issues.push("REQUIRED_TABLE_MISSING_OR_INVISIBLE");
  if (missing.length) issues.push("REQUIRED_TABLE_PRIVILEGES_MISSING");
  if (excessive.length) issues.push("UNEXPECTED_TABLE_PRIVILEGES");
  if (otherDatabaseGrants.length) issues.push("CROSS_DATABASE_TABLE_PRIVILEGES");
  if (unexpectedGlobal.length) issues.push("UNEXPECTED_GLOBAL_PRIVILEGES");
  if (unexpectedSchemas.length) issues.push("UNEXPECTED_SCHEMA_PRIVILEGES");
  if (unexpectedColumns.length) issues.push("UNEXPECTED_COLUMN_PRIVILEGES");
  if (grantOptionTables.length) issues.push("GRANT_OPTION_PRESENT");
  if (applicableRoleCount) issues.push("APPLICABLE_ROLES_PRESENT");
  const localManagerObservations = role !== "runtime" ? [] : Object.entries(LOCAL_MANAGER_WRITE_DB_PRIVILEGE_MATRIX)
    .filter(([table]) => tables.includes(table))
    .map(([table, requested]) => ({
      table,
      local_manager_required: [...requested],
      staging_policy_required: [...(operationsByTable[table] || spec.required_operations)],
      policy_delta: requested.filter((operation) => !(operationsByTable[table] || spec.required_operations).includes(operation)),
    }))
    .filter((entry) => entry.policy_delta.length);
  return {
    role, database_matches: databaseMatches,
    // These names are safe structural metadata; no grantee, passwords, or hashes.
    expected_database: expectedDatabase, observed_database: currentDatabase || null,
    principal_verified: Boolean(principal), required_tables: spec.required_tables.length,
    optional_tables: spec.optional_tables.length, visible_tables: visible.size,
    expected_direct_grants_on_visible_surfaces: expected.size,
    observed_direct_grants: actual.size,
    missing_required_grants: missing, excessive_table_grants: excessive,
    required_tables_missing_or_invisible: ordered(invisibleRequired),
    optional_tables_missing_or_invisible: ordered(invisibleOptional),
    other_database_table_grants: ordered(otherDatabaseGrants),
    unexpected_global_privileges: unexpectedGlobal, unexpected_schema_privileges: unexpectedSchemas,
    unexpected_column_privileges: unexpectedColumns,
    grant_option_tables: ordered(grantOptionTables), applicable_role_count: applicableRoleCount,
    local_manager_contract_differences: localManagerObservations,
    issues, ready: issues.length === 0,
    _principal: principal,
  };
}

export async function inspectStagingPrivilegeDrift({ pools, env = process.env } = {}) {
  if ((normalized(env.NODE_ENV).toLowerCase() !== "staging" || normalized(env.DEPLOYMENT_ENVIRONMENT) !== "staging_local_windows_docker")) {
    return { contract: "mad4b.staging-three-db-privilege-drift-audit.v1", read_only: true,
      writes_performed: false, secrets_included: false, ready: false, all_roles_read: false,
      errors: [{ code: "NON_STAGING_ENVIRONMENT_BLOCKED" }], results: [] };
  }
  const factories = pools || {
    runtime: getPool,
    governance: getGovernancePool,
    runtime_persistence: getRuntimePersistencePool,
  };
  const names = {
    runtime: normalized(env.DB_NAME),
    governance: normalized(env.GOVERNANCE_DB_NAME),
    runtime_persistence: normalized(env.RUNTIME_PERSISTENCE_DB_NAME),
  };
  const results = [];
  const errors = [];
  for (const role of ROLES) {
    let connection = null;
    try {
      if (!names[role]) throw Object.assign(new Error("Database name absent"), { code: "DB_NAME_NOT_CONFIGURED" });
      const pool = typeof factories[role] === "function" ? factories[role]() : factories[role];
      connection = await pool.getConnection();
      const [identityRows] = await connection.query("SELECT CURRENT_USER() AS current_account, DATABASE() AS current_database");
      const principal = normalizeGrantAccount(identityRows?.[0]?.current_account);
      const [tableRows] = await connection.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
        [names[role]],
      );
      const [tablePrivilegeRows] = await connection.query(
        "SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ?",
        [principal],
      );
      const [userPrivilegeRows] = await connection.query(
        "SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?",
        [principal],
      );
      const [schemaPrivilegeRows] = await connection.query(
        "SELECT TABLE_SCHEMA, PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ?",
        [principal],
      );
      const [columnPrivilegeRows] = await connection.query(
        "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, PRIVILEGE_TYPE FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE = ?",
        [principal],
      );
      const [applicableRoleRows] = await connection.query(
        "SELECT ROLE_NAME FROM information_schema.APPLICABLE_ROLES WHERE GRANTEE = ?",
        [principal],
      );
      results.push(compareRolePrivilegeEvidence({
        role, expectedDatabase: names[role], identityRows, tableRows, tablePrivilegeRows,
        userPrivilegeRows, schemaPrivilegeRows, columnPrivilegeRows, applicableRoleRows,
      }));
    } catch (err) {
      errors.push({ role, code: normalized(err?.code || err?.name || "PROBE_FAILED").slice(0,100) });
    } finally {
      if (connection) connection.release();
    }
  }
  const identities = results.map((r) => r._principal);
  const databaseIdentitiesDistinct = new Set(results.map((r) => r.observed_database)).size === ROLES.length;
  const accountsDistinct = new Set(identities).size === ROLES.length;
  // Do not disclose current user names, hostnames, hashes, or other credentials.
  for (const result of results) delete result._principal;
  const allRolesRead = results.length === ROLES.length && errors.length === 0;
  const ready = allRolesRead && databaseIdentitiesDistinct && accountsDistinct && results.every((r) => r.ready);
  return {
    contract: "mad4b.staging-three-db-privilege-drift-audit.v1",
    read_only: true, writes_performed: false, secrets_included: false,
    all_roles_read: allRolesRead, database_identities_distinct: databaseIdentitiesDistinct && allRolesRead,
    database_accounts_distinct: accountsDistinct && allRolesRead,
    ready, results, errors,
  };
}

async function run() {
  const pools = {};
  let output;
  try {
    if (normalized(process.env.NODE_ENV).toLowerCase() === "staging" && normalized(process.env.DEPLOYMENT_ENVIRONMENT) === "staging_local_windows_docker") {
      // Only instantiate pools for a verified Staging app. Never fall back to Production.
      pools.runtime = getPool();
      pools.governance = getGovernancePool();
      pools.runtime_persistence = getRuntimePersistencePool();
    }
    output = await inspectStagingPrivilegeDrift({ pools });
  } catch (error) {
    output = { contract: "mad4b.staging-three-db-privilege-drift-audit.v1",
      ready: false, read_only: true, writes_performed: false, secrets_included: false,
      errors: [{ code: normalized(error?.code || error?.name || "PROBE_FAILED").slice(0, 100) }] };
  } finally {
    for (const pool of Object.values(pools)) {
      try { await pool.end(); } catch {}
    }
  }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  if (!output.ready) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await run();
}
