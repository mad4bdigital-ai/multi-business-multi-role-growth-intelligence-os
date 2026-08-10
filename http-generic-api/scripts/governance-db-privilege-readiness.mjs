import { getPool } from "../db.js";
import { closeGovernancePool, getGovernancePool, resolveGovernanceDbConfig } from "../governanceDb.js";
import { assertGovernanceDbPrivilegeReadiness } from "../governanceDbPrivilegeContract.js";
import { resolveGovernanceProductionPreflight } from "../governanceProductionPreflight.js";

const CONTRACT = "mad4b.governance-db-privilege-readiness-probe.v1";

function text(value = "") {
  return String(value ?? "").trim();
}

function currentAccountToGrantee(value) {
  const account = text(value);
  const separator = account.lastIndexOf("@");
  if (separator <= 0 || separator === account.length - 1) {
    const error = new Error("Unable to normalize current MariaDB account for privilege readback.");
    error.code = "GOVERNANCE_DB_CURRENT_ACCOUNT_INVALID";
    error.details = { secrets_included: false };
    throw error;
  }
  const quote = (part) => `'${String(part).replaceAll("'", "''")}'`;
  return `${quote(account.slice(0, separator))}@${quote(account.slice(separator + 1))}`;
}

function safeFailure(error) {
  const details = error?.details?.secrets_included === false
    ? error.details
    : { secrets_included: false };
  return {
    contract: CONTRACT,
    status: "blocked",
    ready: false,
    code: text(error?.code).slice(0, 100) || "GOVERNANCE_DB_PRIVILEGE_PROBE_FAILED",
    details,
    database_connection_performed: false,
    sql_readback_performed: false,
    sql_mutation_performed: false,
    secret_value_returned: false,
    secrets_included: false,
  };
}

async function main() {
  const runtimePool = getPool();
  let governanceConnection = null;
  let databaseConnectionPerformed = false;
  let sqlReadbackPerformed = false;

  try {
    const preflight = await resolveGovernanceProductionPreflight(
      { env: process.env },
      { environmentAuthorityDeps: { pool: runtimePool } },
    );
    const governanceConfig = resolveGovernanceDbConfig(process.env);
    const governancePool = getGovernancePool();
    governanceConnection = await governancePool.getConnection();
    databaseConnectionPerformed = true;
    await governanceConnection.ping();

    const [identityRows] = await governanceConnection.query(
      "SELECT CURRENT_USER() AS current_account, DATABASE() AS current_database",
    );
    sqlReadbackPerformed = true;
    const currentAccount = text(identityRows?.[0]?.current_account);
    const currentDatabase = text(identityRows?.[0]?.current_database);
    if (!currentDatabase || currentDatabase !== governanceConfig.database) {
      const error = new Error("Governance DB privilege probe is connected to an unexpected database.");
      error.code = "GOVERNANCE_DB_PRIVILEGE_DATABASE_MISMATCH";
      error.details = {
        expected_database_configured: Boolean(governanceConfig.database),
        observed_database_present: Boolean(currentDatabase),
        database_matches: false,
        secrets_included: false,
      };
      throw error;
    }

    const grantee = currentAccountToGrantee(currentAccount);
    const [userPrivileges] = await governanceConnection.query(
      "SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?",
      [grantee],
    );
    const [schemaPrivileges] = await governanceConnection.query(
      "SELECT TABLE_SCHEMA, PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ?",
      [grantee],
    );
    const [tablePrivileges] = await governanceConnection.query(
      "SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ?",
      [grantee],
    );
    sqlReadbackPerformed = true;

    const privilegeReadiness = assertGovernanceDbPrivilegeReadiness({
      database: governanceConfig.database,
      userPrivileges,
      schemaPrivileges,
      tablePrivileges,
    });

    console.log(JSON.stringify({
      contract: CONTRACT,
      status: "ready",
      ready: true,
      production_preflight_ready: preflight.ready === true,
      production_branch_exact: preflight.environment_authority?.production_branch === "Production",
      promotion_target_branch_exact: preflight.environment_authority?.promotion_target_branch === "Production",
      governance_identity_configured: preflight.governance_db?.identity_configured === true,
      privilege_readiness: privilegeReadiness,
      database_connection_performed: databaseConnectionPerformed,
      sql_readback_performed: sqlReadbackPerformed,
      sql_mutation_performed: false,
      migration_apply_performed: false,
      provider_mutation_performed: false,
      deployment_performed: false,
      secret_value_returned: false,
      secrets_included: false,
    }));
  } finally {
    if (governanceConnection) governanceConnection.release();
    await Promise.allSettled([
      closeGovernancePool(),
      runtimePool.end(),
    ]);
  }
}

main().catch((error) => {
  console.error(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
});
