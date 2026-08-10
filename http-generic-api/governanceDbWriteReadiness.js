import { getGovernancePool } from "./governanceDb.js";

export const GOVERNANCE_DB_WRITE_AUTHORITY_DEGRADED = "runtime_db_write_authority_degraded";

export const GOVERNANCE_DB_REQUIRED_PRIVILEGES = Object.freeze({
  capability_resolution_envelope_ledger: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  approval_holds: Object.freeze(["INSERT"]),
  governed_migration_authorization_registry: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  capability_apply_authorization_policy_registry: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  runtime_dispatch_certification_registry: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  governed_migration_ledger: Object.freeze(["SELECT"]),
  platform_resource_authority_bindings: Object.freeze(["SELECT", "INSERT"]),
  governed_tool_response_chunks: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
});

const ADMIN_OR_DDL_PRIVILEGES = new Set([
  "ALL PRIVILEGES",
  "ALTER",
  "ALTER ROUTINE",
  "CREATE",
  "CREATE ROLE",
  "CREATE ROUTINE",
  "CREATE TABLESPACE",
  "CREATE TEMPORARY TABLES",
  "CREATE USER",
  "CREATE VIEW",
  "DROP",
  "DROP ROLE",
  "EVENT",
  "EXECUTE",
  "FILE",
  "GRANT OPTION",
  "PROCESS",
  "PROXY",
  "RELOAD",
  "REPLICATION CLIENT",
  "REPLICATION SLAVE",
  "SHUTDOWN",
  "SUPER",
  "TRIGGER",
]);

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizeIdentifier(value = "") {
  return text(value)
    .replace(/`/g, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function normalizePrivilege(value = "") {
  const privilege = text(value)
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+/g, " ")
    .toUpperCase();
  return privilege === "ALL" ? "ALL PRIVILEGES" : privilege;
}

function splitPrivileges(value = "") {
  return text(value)
    .split(",")
    .map(normalizePrivilege)
    .filter(Boolean);
}

function parseScope(rawScope = "") {
  const scope = text(rawScope).replace(/`/g, "");
  const separator = scope.indexOf(".");
  if (separator < 0) return { database: normalizeIdentifier(scope), table: "" };
  return {
    database: normalizeIdentifier(scope.slice(0, separator)),
    table: normalizeIdentifier(scope.slice(separator + 1)),
  };
}

export function parseGovernanceGrantStatement(statement = "") {
  const raw = text(statement);
  const match = raw.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i);
  if (!match) {
    return {
      recognized: false,
      privileges: [],
      database: null,
      table: null,
      with_grant_option: /\bWITH\s+GRANT\s+OPTION\b/i.test(raw),
    };
  }
  const scope = parseScope(match[2]);
  const privileges = splitPrivileges(match[1]);
  if (/\bWITH\s+GRANT\s+OPTION\b/i.test(raw) && !privileges.includes("GRANT OPTION")) {
    privileges.push("GRANT OPTION");
  }
  return {
    recognized: true,
    privileges,
    database: scope.database,
    table: scope.table,
    with_grant_option: privileges.includes("GRANT OPTION"),
  };
}

function scopeCovers(grant, database, table) {
  const grantDb = normalizeIdentifier(grant.database).toLowerCase();
  const grantTable = normalizeIdentifier(grant.table).toLowerCase();
  const targetDb = normalizeIdentifier(database).toLowerCase();
  const targetTable = normalizeIdentifier(table).toLowerCase();
  return (grantDb === "*" && grantTable === "*")
    || (grantDb === targetDb && grantTable === "*")
    || (grantDb === targetDb && grantTable === targetTable);
}

function privilegeCovers(grant, privilege) {
  return grant.privileges.includes("ALL PRIVILEGES") || grant.privileges.includes(privilege);
}

function grantScopeLabel(grant = {}) {
  return `${grant.database || "?"}.${grant.table || "?"}`;
}

function reviewedPrivilegeAllowed(database, grant, privilege) {
  const grantDb = normalizeIdentifier(grant.database).toLowerCase();
  const grantTable = normalizeIdentifier(grant.table).toLowerCase();
  const targetDb = normalizeIdentifier(database).toLowerCase();
  if (grantDb !== targetDb || !grantTable || grantTable === "*") return false;
  const allowed = GOVERNANCE_DB_REQUIRED_PRIVILEGES[grantTable] || [];
  return allowed.includes(privilege);
}

function classifyProhibitedGrant(database, grant) {
  const findings = [];
  const scope = grantScopeLabel(grant);
  for (const privilege of grant.privileges) {
    if (privilege === "USAGE") continue;
    if (ADMIN_OR_DDL_PRIVILEGES.has(privilege)) {
      findings.push({ privilege, scope, reason: "administrative_or_ddl_privilege_not_allowed" });
      continue;
    }
    if (!reviewedPrivilegeAllowed(database, grant, privilege)) {
      findings.push({ privilege, scope, reason: "privilege_outside_reviewed_table_scope" });
    }
  }
  return findings;
}

export function evaluateGovernanceGrantStatements({ database, grantStatements = [] } = {}) {
  const targetDatabase = normalizeIdentifier(database);
  const parsed = grantStatements.map(parseGovernanceGrantStatement);
  const requiredSurfaces = {};
  const missingPrivileges = [];

  for (const [table, operations] of Object.entries(GOVERNANCE_DB_REQUIRED_PRIVILEGES)) {
    const missing = operations.filter((operation) => !parsed.some(
      (grant) => grant.recognized && scopeCovers(grant, targetDatabase, table) && privilegeCovers(grant, operation),
    ));
    requiredSurfaces[table] = {
      ready: missing.length === 0,
      required: [...operations],
      missing,
    };
    for (const operation of missing) missingPrivileges.push({ table, operation });
  }

  const prohibitedPrivileges = parsed.flatMap((grant) => grant.recognized
    ? classifyProhibitedGrant(targetDatabase, grant)
    : []);
  const ready = missingPrivileges.length === 0 && prohibitedPrivileges.length === 0;

  return {
    status: ready ? "ready" : "degraded",
    error_code: ready ? null : GOVERNANCE_DB_WRITE_AUTHORITY_DEGRADED,
    required_surfaces: requiredSurfaces,
    missing_privileges: missingPrivileges,
    missing_count: missingPrivileges.length,
    prohibited_privileges: prohibitedPrivileges,
    prohibited_grant_count: prohibitedPrivileges.length,
    grant_statement_count: grantStatements.length,
    raw_grants_included: false,
    secrets_included: false,
  };
}

function grantStatementsFromRows(rows = []) {
  return (rows || [])
    .map((row) => Object.values(row || {}).find((value) => typeof value === "string" && /^GRANT\s+/i.test(value)))
    .filter(Boolean);
}

export async function getGovernanceDbWriteReadiness(deps = {}) {
  let writerPool;
  try {
    writerPool = deps.writerPool || getGovernancePool();
  } catch (cause) {
    return {
      status: "degraded",
      error_code: GOVERNANCE_DB_WRITE_AUTHORITY_DEGRADED,
      configured: false,
      connection_ready: false,
      cause_code: cause?.code || "GOVERNANCE_DB_CONFIG_MISSING",
      required_surfaces: {},
      missing_privileges: [],
      missing_count: null,
      prohibited_privileges: [],
      prohibited_grant_count: null,
      raw_grants_included: false,
      secrets_included: false,
    };
  }

  try {
    const [[identity]] = await writerPool.query(
      "SELECT CURRENT_USER() AS current_user, DATABASE() AS database_name",
    );
    const [grantRows] = await writerPool.query("SHOW GRANTS FOR CURRENT_USER");
    const database = text(identity?.database_name);
    const evaluated = evaluateGovernanceGrantStatements({
      database,
      grantStatements: grantStatementsFromRows(grantRows),
    });
    return {
      ...evaluated,
      configured: true,
      connection_ready: true,
      principal: text(identity?.current_user) || null,
      database: database || null,
      secrets_included: false,
    };
  } catch (cause) {
    return {
      status: "degraded",
      error_code: GOVERNANCE_DB_WRITE_AUTHORITY_DEGRADED,
      configured: true,
      connection_ready: false,
      cause_code: cause?.code || "governance_db_privilege_probe_failed",
      required_surfaces: {},
      missing_privileges: [],
      missing_count: null,
      prohibited_privileges: [],
      prohibited_grant_count: null,
      raw_grants_included: false,
      secrets_included: false,
    };
  }
}
