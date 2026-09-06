const normalizeOperationsByTable = (value) => Object.freeze(Object.fromEntries(
  Object.entries(value || {}).map(([table, operations]) => [
    table,
    Object.freeze([...new Set((operations || []).map((operation) => String(operation).toUpperCase()))]),
  ]),
));

const buildGrantSpec = (required_tables, required_operations, apply_when = "always", required_operations_by_table = null, optional_tables = []) => Object.freeze({
  required_tables: Object.freeze([...required_tables]),
  optional_tables: Object.freeze([...optional_tables]),
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

const STAGING_RUNTIME_READ_ONLY_TABLES = Object.freeze([
  "admin_platform_endpoint_tools",
  "tenant_platform_endpoint_tools",
  "sql_cache_runtime_policies",
  "platform_runtime_config",
  "users",
  "memberships",
  "tenants",
  "role_assignments",
  "workspace_registry",
  "connected_systems",
  "installations",
  "permission_grants",
  "activation_authorized_surface_registry",
  "registry_surfaces_catalog",
  "brands",
  "plugins",
  "logic_definitions",
  "workflows",
  "session_summaries",
  "gpt_session_conversation_refs",
  "platform_pending_tasks",
  "platform_graph_nodes",
  "platform_graph_edges",
  "platform_graph_memory_rank_rules",
  "json_asset_subject_links",
  "activation_dynamic_tab_registry",
  "activation_dynamic_tab_section_registry",
  "activation_dynamic_tab_discovery_rule_registry",
  "activation_section_action_registry",
  "activation_attention_rule_registry",
  "activation_freshness_policy_registry",
  "activation_signal_subscription_registry",
  "activation_connector_pack_registry",
]);

const STAGING_RUNTIME_OPTIONAL_READ_SURFACES = Object.freeze([
  // These surfaces are version-dependent views/tables. Grant them only when
  // present; absence is reported as degraded evidence and never triggers a
  // schema-wide privilege expansion.
  "v_activation_pending_tasks",
  "v_activation_agent_catalog",
  "v_activation_agent_skill_grants",
  "activation_freshness_ledger",
  "activation_signal_inbox",
  "readiness_checks",
  "telemetry_spans",
  "operational_alerts",
  "v_platform_evolution_activation_card",
  "v_platform_capability_gaps",
]);

const STAGING_RUNTIME_READ_ONLY_MATRIX = Object.freeze(Object.fromEntries(
  [...STAGING_RUNTIME_READ_ONLY_TABLES, ...STAGING_RUNTIME_OPTIONAL_READ_SURFACES]
    .map((table) => [table, Object.freeze(["SELECT"])]),
));

// Local Staging keeps the production bootstrap grant surface unchanged while
// adding only bounded read-only runtime authority surfaces that the running
// Staging app must inspect. The Staging-only overlay includes Activation
// session-context, registry, graph-memory and hard-run read surfaces. No broad
// schema grant, CREATE/ALTER authority, GRANT OPTION, or Production grant change
// is introduced.
export const STAGING_ROLE_GRANT_POLICIES = Object.freeze({
  runtime: buildGrantSpec(
    [
      "customer_sessions",
      "gpt_session_turns",
      "actions",
      "dynamic_audit_scheduler_runs",
      "execution_log",
      "json_assets",
      ...STAGING_RUNTIME_READ_ONLY_TABLES,
    ],
    ["SELECT", "INSERT", "UPDATE"],
    "always",
    STAGING_RUNTIME_READ_ONLY_MATRIX,
    STAGING_RUNTIME_OPTIONAL_READ_SURFACES,
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
