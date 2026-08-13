export const GOVERNANCE_DB_PRIVILEGE_MATRIX = Object.freeze({
  capability_resolution_envelope_ledger: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  approval_holds: Object.freeze(["SELECT", "INSERT"]),
  governed_migration_authorization_registry: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  capability_apply_authorization_policy_registry: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  runtime_dispatch_certification_registry: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  governed_migration_ledger: Object.freeze(["SELECT"]),
  platform_resource_authority_bindings: Object.freeze(["SELECT", "INSERT"]),
  platform_resource_recipes: Object.freeze(["SELECT"]),
  platform_resource_recipe_steps: Object.freeze(["SELECT"]),
  repository_operation_leases: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  repository_mutation_plans_v6: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  repository_mutation_runs_v6: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  runtime_break_glass_incidents: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  runtime_break_glass_audit_events: Object.freeze(["SELECT", "INSERT"]),
  runtime_verification_runs: Object.freeze(["SELECT"]),
  runtime_verification_evidence_chunks: Object.freeze(["SELECT", "INSERT"]),
  deployment_attestations: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
});

const ALLOWED_GLOBAL_PRIVILEGES = new Set(["USAGE"]);

function text(value = "") {
  return String(value ?? "").trim();
}

function privilege(value = "") {
  return text(value).toUpperCase();
}

function tableName(value = "") {
  return text(value);
}

function schemaName(value = "") {
  return text(value);
}

function requiredPrivilegeKeys() {
  const keys = [];
  for (const [table, operations] of Object.entries(GOVERNANCE_DB_PRIVILEGE_MATRIX)) {
    for (const operation of operations) keys.push(`${table}:${operation}`);
  }
  return keys;
}

export function evaluateGovernanceDbPrivilegeReadiness({
  database,
  userPrivileges = [],
  schemaPrivileges = [],
  tablePrivileges = [],
  columnPrivileges = [],
  applicableRoles = [],
} = {}) {
  const targetDatabase = schemaName(database);
  if (!targetDatabase) {
    const error = new Error("Governance DB privilege readiness requires a target database name.");
    error.code = "GOVERNANCE_DB_PRIVILEGE_TARGET_DATABASE_MISSING";
    error.details = { secrets_included: false };
    throw error;
  }

  const observedRequired = new Set();
  let unexpectedGlobalPrivilegeCount = 0;
  let unexpectedSchemaPrivilegeCount = 0;
  let unexpectedTableScopeCount = 0;
  let unexpectedTablePrivilegeCount = 0;
  let unexpectedColumnPrivilegeCount = 0;
  let applicableRoleCount = 0;

  for (const row of Array.isArray(userPrivileges) ? userPrivileges : []) {
    const observed = privilege(row?.PRIVILEGE_TYPE ?? row?.privilege_type);
    if (!observed || ALLOWED_GLOBAL_PRIVILEGES.has(observed)) continue;
    unexpectedGlobalPrivilegeCount += 1;
  }

  for (const row of Array.isArray(schemaPrivileges) ? schemaPrivileges : []) {
    const observed = privilege(row?.PRIVILEGE_TYPE ?? row?.privilege_type);
    if (!observed || observed === "USAGE") continue;
    unexpectedSchemaPrivilegeCount += 1;
  }

  for (const row of Array.isArray(tablePrivileges) ? tablePrivileges : []) {
    const observedSchema = schemaName(row?.TABLE_SCHEMA ?? row?.table_schema);
    const observedTable = tableName(row?.TABLE_NAME ?? row?.table_name);
    const observedPrivilege = privilege(row?.PRIVILEGE_TYPE ?? row?.privilege_type);
    if (!observedSchema || !observedTable || !observedPrivilege) continue;

    if (observedSchema !== targetDatabase || !Object.hasOwn(GOVERNANCE_DB_PRIVILEGE_MATRIX, observedTable)) {
      unexpectedTableScopeCount += 1;
      continue;
    }

    const allowed = new Set(GOVERNANCE_DB_PRIVILEGE_MATRIX[observedTable]);
    if (!allowed.has(observedPrivilege)) {
      unexpectedTablePrivilegeCount += 1;
      continue;
    }

    observedRequired.add(`${observedTable}:${observedPrivilege}`);
  }

  for (const row of Array.isArray(columnPrivileges) ? columnPrivileges : []) {
    const observedPrivilege = privilege(row?.PRIVILEGE_TYPE ?? row?.privilege_type);
    if (observedPrivilege) unexpectedColumnPrivilegeCount += 1;
  }

  for (const row of Array.isArray(applicableRoles) ? applicableRoles : []) {
    const observedRole = text(row?.ROLE_NAME ?? row?.role_name ?? row?.ROLE ?? row?.role);
    if (observedRole || Object.keys(row ?? {}).length > 0) applicableRoleCount += 1;
  }

  const missingRequired = requiredPrivilegeKeys().filter((key) => !observedRequired.has(key));
  const checks = {
    required_table_privileges_complete: missingRequired.length === 0,
    no_unexpected_global_privileges: unexpectedGlobalPrivilegeCount === 0,
    no_schema_wide_privileges: unexpectedSchemaPrivilegeCount === 0,
    no_unexpected_table_scopes: unexpectedTableScopeCount === 0,
    no_extra_table_privileges: unexpectedTablePrivilegeCount === 0,
    no_column_level_privileges: unexpectedColumnPrivilegeCount === 0,
    no_applicable_roles: applicableRoleCount === 0,
  };

  return {
    contract: "mad4b.governance-db-privilege-readiness.v1",
    ready: Object.values(checks).every((value) => value === true),
    checks,
    required_privilege_count: requiredPrivilegeKeys().length,
    observed_required_privilege_count: observedRequired.size,
    missing_required: missingRequired,
    unexpected_global_privilege_count: unexpectedGlobalPrivilegeCount,
    unexpected_schema_privilege_count: unexpectedSchemaPrivilegeCount,
    unexpected_table_scope_count: unexpectedTableScopeCount,
    unexpected_table_privilege_count: unexpectedTablePrivilegeCount,
    unexpected_column_privilege_count: unexpectedColumnPrivilegeCount,
    applicable_role_count: applicableRoleCount,
    secrets_included: false,
  };
}

export function assertGovernanceDbPrivilegeReadiness(input = {}) {
  const result = evaluateGovernanceDbPrivilegeReadiness(input);
  if (result.ready) return result;

  const error = new Error("Governance DB writer privilege readiness failed closed.");
  error.code = "GOVERNANCE_DB_PRIVILEGE_READINESS_FAILED";
  error.status = 409;
  error.details = result;
  throw error;
}
