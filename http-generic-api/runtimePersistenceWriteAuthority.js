import { getRuntimePersistencePool } from "./db.js";

export const RUNTIME_PERSISTENCE_IDENTITY_CONTRACT = Object.freeze({
  identity_env: "RUNTIME_PERSISTENCE_DB_USER",
  mode: "dedicated_runtime_persistence_writer",
  separated_identity_required: true,
  secrets_included: false,
});

export const RUNTIME_PERSISTENCE_PRIVILEGE_MATRIX = Object.freeze({
  governed_tool_response_chunks: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
});

export const RUNTIME_PERSISTENCE_PRIVILEGE_READINESS_TTL_MS = 60_000;
const runtimePersistencePrivilegeCache = new WeakMap();

const BROAD_WRITE_PRIVILEGES = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "DROP",
  "ALTER",
  "INDEX",
  "TRIGGER",
  "REFERENCES",
  "EXECUTE",
  "EVENT",
  "CREATE ROUTINE",
  "ALTER ROUTINE",
  "CREATE VIEW",
  "CREATE TEMPORARY TABLES",
  "LOCK TABLES",
]);

function text(value = "") {
  return String(value ?? "").trim();
}

function privilege(value = "") {
  return text(value).toUpperCase();
}

function tableName(value = "") {
  return text(value);
}

function nowMs(deps = {}) {
  const value = typeof deps.now === "function" ? deps.now() : (deps.now ?? Date.now());
  return value instanceof Date ? value.getTime() : Number(value);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function authorityError(code, message, status = 503, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details?.secrets_included === false ? details : { secrets_included: false };
  return error;
}

function currentAccountToGrantee(value) {
  const account = text(value);
  const separator = account.lastIndexOf("@");
  if (separator <= 0 || separator === account.length - 1) {
    throw authorityError(
      "RUNTIME_PERSISTENCE_CURRENT_ACCOUNT_INVALID",
      "Unable to normalize the runtime persistence MariaDB account.",
      503,
      { secrets_included: false },
    );
  }
  const quote = (part) => `'${String(part).replaceAll("'", "''")}'`;
  return `${quote(account.slice(0, separator))}@${quote(account.slice(separator + 1))}`;
}

function requiredOperationsFor(table, requested = undefined) {
  const allowed = RUNTIME_PERSISTENCE_PRIVILEGE_MATRIX[table];
  if (!allowed) {
    throw authorityError(
      "RUNTIME_PERSISTENCE_TABLE_NOT_BOUND",
      "The runtime persistence table is not bound to a privilege contract.",
      500,
      { table_name: table, secrets_included: false },
    );
  }
  if (!Array.isArray(requested) || requested.length === 0) return [...allowed];
  const normalized = [...new Set(requested.map(privilege).filter(Boolean))];
  const invalid = normalized.filter((operation) => !allowed.includes(operation));
  if (invalid.length) {
    throw authorityError(
      "RUNTIME_PERSISTENCE_OPERATION_NOT_BOUND",
      "The runtime persistence operation is not bound to the table privilege contract.",
      500,
      { table_name: table, invalid_operations: invalid, secrets_included: false },
    );
  }
  return normalized;
}

export function resolveRuntimePersistenceExecutor(deps = {}) {
  return deps.runtimePersistencePool || deps.pool || deps.connection || getRuntimePersistencePool();
}

function cacheKey(deps = {}) {
  try {
    const target = resolveRuntimePersistenceExecutor(deps);
    return target && (typeof target === "object" || typeof target === "function") ? target : null;
  } catch {
    return null;
  }
}

export function invalidateRuntimePersistencePrivilegeReadiness(deps = {}) {
  const key = cacheKey(deps);
  return key ? runtimePersistencePrivilegeCache.delete(key) : false;
}

export function evaluateRuntimePersistencePrivilegeReadiness({
  database,
  table = "governed_tool_response_chunks",
  requiredOperations = undefined,
  userPrivileges = [],
  schemaPrivileges = [],
  tablePrivileges = [],
  columnPrivileges = [],
  applicableRoles = [],
} = {}) {
  const targetDatabase = text(database);
  const targetTable = tableName(table);
  if (!targetDatabase) {
    throw authorityError(
      "RUNTIME_PERSISTENCE_TARGET_DATABASE_MISSING",
      "Runtime persistence privilege readiness requires the active database name.",
      503,
      { secrets_included: false },
    );
  }

  const allowed = new Set(RUNTIME_PERSISTENCE_PRIVILEGE_MATRIX[targetTable] || []);
  const required = requiredOperationsFor(targetTable, requiredOperations);
  const observedDirect = new Set();
  let broadGlobalWritePrivilegeCount = 0;
  let broadSchemaWritePrivilegeCount = 0;
  let extraTargetTablePrivilegeCount = 0;
  let targetColumnPrivilegeCount = 0;
  let targetGrantOptionCount = 0;
  let applicableRoleCount = 0;
  let unrelatedTablePrivilegeCount = 0;

  for (const row of Array.isArray(userPrivileges) ? userPrivileges : []) {
    if (BROAD_WRITE_PRIVILEGES.has(privilege(row?.PRIVILEGE_TYPE ?? row?.privilege_type))) {
      broadGlobalWritePrivilegeCount += 1;
    }
  }

  for (const row of Array.isArray(schemaPrivileges) ? schemaPrivileges : []) {
    const observedSchema = text(row?.TABLE_SCHEMA ?? row?.table_schema);
    const observedPrivilege = privilege(row?.PRIVILEGE_TYPE ?? row?.privilege_type);
    if (observedSchema === targetDatabase && BROAD_WRITE_PRIVILEGES.has(observedPrivilege)) {
      broadSchemaWritePrivilegeCount += 1;
    }
  }

  for (const row of Array.isArray(tablePrivileges) ? tablePrivileges : []) {
    const observedSchema = text(row?.TABLE_SCHEMA ?? row?.table_schema);
    const observedTable = tableName(row?.TABLE_NAME ?? row?.table_name);
    const observedPrivilege = privilege(row?.PRIVILEGE_TYPE ?? row?.privilege_type);
    if (!observedSchema || !observedTable || !observedPrivilege) continue;
    if (observedSchema !== targetDatabase || observedTable !== targetTable) {
      unrelatedTablePrivilegeCount += 1;
      continue;
    }
    if (String(row?.IS_GRANTABLE ?? row?.is_grantable ?? "NO").toUpperCase() === "YES") {
      targetGrantOptionCount += 1;
    }
    if (!allowed.has(observedPrivilege)) {
      extraTargetTablePrivilegeCount += 1;
      continue;
    }
    observedDirect.add(observedPrivilege);
  }

  for (const row of Array.isArray(columnPrivileges) ? columnPrivileges : []) {
    const observedSchema = text(row?.TABLE_SCHEMA ?? row?.table_schema);
    const observedTable = tableName(row?.TABLE_NAME ?? row?.table_name);
    const observedPrivilege = privilege(row?.PRIVILEGE_TYPE ?? row?.privilege_type);
    if (observedSchema === targetDatabase && observedTable === targetTable && observedPrivilege) {
      targetColumnPrivilegeCount += 1;
    }
  }

  for (const row of Array.isArray(applicableRoles) ? applicableRoles : []) {
    const observedRole = text(row?.ROLE_NAME ?? row?.role_name ?? row?.ROLE ?? row?.role);
    if (observedRole || Object.keys(row || {}).length > 0) applicableRoleCount += 1;
  }

  const missingRequired = required.filter((operation) => !observedDirect.has(operation));
  const checks = {
    required_direct_table_privileges_complete: missingRequired.length === 0,
    no_global_write_privileges: broadGlobalWritePrivilegeCount === 0,
    no_schema_wide_write_privileges: broadSchemaWritePrivilegeCount === 0,
    no_extra_target_table_privileges: extraTargetTablePrivilegeCount === 0,
    no_target_column_privileges: targetColumnPrivilegeCount === 0,
    no_target_grant_option: targetGrantOptionCount === 0,
    no_applicable_roles: applicableRoleCount === 0,
  };

  return {
    contract: "mad4b.runtime-persistence-write-authority.v1",
    identity_mode: RUNTIME_PERSISTENCE_IDENTITY_CONTRACT.mode,
    identity_env: RUNTIME_PERSISTENCE_IDENTITY_CONTRACT.identity_env,
    table_name: targetTable,
    required_operations: required,
    ready: Object.values(checks).every(Boolean),
    checks,
    required_privilege_count: required.length,
    observed_required_privilege_count: required.filter((operation) => observedDirect.has(operation)).length,
    missing_required: missingRequired,
    broad_global_write_privilege_count: broadGlobalWritePrivilegeCount,
    broad_schema_write_privilege_count: broadSchemaWritePrivilegeCount,
    extra_target_table_privilege_count: extraTargetTablePrivilegeCount,
    target_column_privilege_count: targetColumnPrivilegeCount,
    target_grant_option_count: targetGrantOptionCount,
    applicable_role_count: applicableRoleCount,
    unrelated_table_privilege_count: unrelatedTablePrivilegeCount,
    unrelated_table_privileges_ignored: true,
    secret_value_returned: false,
    secrets_included: false,
  };
}

async function collectPrivilegeSnapshot(deps = {}) {
  const target = resolveRuntimePersistenceExecutor(deps);
  const key = cacheKey(deps);
  const checkedAtMs = nowMs(deps);
  const cached = key ? runtimePersistencePrivilegeCache.get(key) : null;
  if (cached && cached.expires_at_ms > checkedAtMs) {
    return { ...cached.snapshot, cached: true };
  }
  if (cached && key) runtimePersistencePrivilegeCache.delete(key);

  try {
    const [identityRows] = await target.query(
      "SELECT CURRENT_USER() AS current_account, DATABASE() AS current_database",
    );
    const currentAccount = text(identityRows?.[0]?.current_account);
    const currentDatabase = text(identityRows?.[0]?.current_database);
    const grantee = currentAccountToGrantee(currentAccount);

    const [userPrivileges] = await target.query(
      "SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ?",
      [grantee],
    );
    const [schemaPrivileges] = await target.query(
      "SELECT TABLE_SCHEMA, PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ?",
      [grantee],
    );
    const [tablePrivileges] = await target.query(
      "SELECT TABLE_SCHEMA, TABLE_NAME, PRIVILEGE_TYPE, IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ?",
      [grantee],
    );
    const [columnPrivileges] = await target.query(
      "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, PRIVILEGE_TYPE FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE = ?",
      [grantee],
    );
    const [applicableRoles] = await target.query(
      "SELECT ROLE_NAME FROM information_schema.APPLICABLE_ROLES WHERE GRANTEE = ?",
      [grantee],
    );

    const snapshot = {
      database: currentDatabase,
      userPrivileges,
      schemaPrivileges,
      tablePrivileges,
      columnPrivileges,
      applicableRoles,
    };
    const ttlMs = Math.min(
      positiveInteger(
        deps.runtimePersistencePrivilegeTtlMs || deps.runtime_persistence_privilege_ttl_ms,
        RUNTIME_PERSISTENCE_PRIVILEGE_READINESS_TTL_MS,
      ),
      5 * 60 * 1000,
    );
    if (key && ttlMs > 0) {
      runtimePersistencePrivilegeCache.set(key, {
        snapshot,
        expires_at_ms: checkedAtMs + ttlMs,
      });
    }
    return { ...snapshot, cached: false };
  } catch (cause) {
    if (key) runtimePersistencePrivilegeCache.delete(key);
    throw authorityError(
      "RUNTIME_PERSISTENCE_PRIVILEGE_READBACK_FAILED",
      "Runtime persistence privilege metadata could not be read.",
      503,
      { cause_code: cause?.code || null, secrets_included: false },
    );
  }
}

export async function inspectRuntimePersistenceWriteAuthority(input = {}, deps = {}) {
  const snapshot = await collectPrivilegeSnapshot(deps);
  return {
    ...evaluateRuntimePersistencePrivilegeReadiness({ ...snapshot, ...input }),
    cached: snapshot.cached === true,
  };
}

export async function assertRuntimePersistenceWriteAuthority(input = {}, deps = {}) {
  const result = await inspectRuntimePersistenceWriteAuthority(input, deps);
  if (result.ready) return result;
  throw authorityError(
    "RUNTIME_PERSISTENCE_WRITE_AUTHORITY_NOT_READY",
    "Runtime persistence DB_USER authority is not ready for the requested operation.",
    503,
    result,
  );
}
