const normalizeOperationsByTable = (value) => Object.freeze(Object.fromEntries(
  Object.entries(value || {}).map(([table, operations]) => [
    table,
    Object.freeze([...new Set((operations || []).map((operation) => String(operation).toUpperCase()))]),
  ]),
));

const buildGrantSpec = (required_tables, required_operations, apply_when = "always", required_operations_by_table = null) => Object.freeze({
  required_tables: Object.freeze([...required_tables]),
  required_operations: Object.freeze([...required_operations]),
  ...(required_operations_by_table ? { required_operations_by_table: normalizeOperationsByTable(required_operations_by_table) } : {}),
  apply_when,
});

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

export const BOOTSTRAP_ROLE_GRANT_POLICIES = Object.freeze({
  runtime: buildGrantSpec(
    ["customer_sessions", "gpt_session_turns", "actions", "dynamic_audit_scheduler_runs", "execution_log", "json_assets"],
    ["SELECT", "INSERT", "UPDATE"],
  ),
  governance: buildGrantSpec(Object.keys(GOVERNANCE_DB_PRIVILEGE_MATRIX), ["SELECT"], "always", GOVERNANCE_DB_PRIVILEGE_MATRIX),
  runtime_persistence: buildGrantSpec(["governed_tool_response_chunks"], ["SELECT", "INSERT", "UPDATE", "DELETE"], "always"),
});

// Local Staging keeps the production bootstrap grant surface unchanged while
// adding only bounded read-only runtime authority surfaces that the running
// Staging app must inspect: the two MCP catalog tables and the MySQL-primary
// SQL-cache runtime policy. No broad schema grant or write authority is added.
export const STAGING_ROLE_GRANT_POLICIES = Object.freeze({
  runtime: buildGrantSpec(
    [
      "customer_sessions",
      "gpt_session_turns",
      "actions",
      "dynamic_audit_scheduler_runs",
      "execution_log",
      "json_assets",
      "admin_platform_endpoint_tools",
      "tenant_platform_endpoint_tools",
      "sql_cache_runtime_policies",
    ],
    ["SELECT", "INSERT", "UPDATE"],
    "always",
    {
      admin_platform_endpoint_tools: ["SELECT"],
      tenant_platform_endpoint_tools: ["SELECT"],
      sql_cache_runtime_policies: ["SELECT"],
    },
  ),
  governance: BOOTSTRAP_ROLE_GRANT_POLICIES.governance,
  runtime_persistence: BOOTSTRAP_ROLE_GRANT_POLICIES.runtime_persistence,
});

export const ROLE_GRANT_PRIVILEGE_ALLOWLIST = Object.freeze({
  runtime: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  governance: Object.freeze(["SELECT", "INSERT", "UPDATE"]),
  runtime_persistence: Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]),
});

export function allowedGrantPrivilegesForRole(role) {
  const values = ROLE_GRANT_PRIVILEGE_ALLOWLIST[role];
  if (!values) throw new Error(`Unknown database grant role: ${role}`);
  return new Set(values);
}
