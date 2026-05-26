import assert from "node:assert/strict";
import { resolveActionCandidates } from "./actionRegistryAuthorityResolver.js";

function createPool() {
  const state = { queries: [] };
  const pool = {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params });
      const compactSql = String(sql).replace(/\s+/g, " ").trim();
      if (compactSql.includes("FROM `registry_surfaces_catalog`")) {
        assert.equal(params[0], "surface.actions_registry_sheet");
        return [[{
          surface_id: "surface.actions_registry_sheet",
          logical_surface_key: "surface.actions_registry_sheet",
          surface_name: "Actions Registry",
          surface_type: "registry",
          surface_scope: "runtime",
          storage_type: "sql_table",
          active_status: "active",
          authority_status: "authoritative",
          required_for_execution: "TRUE",
          resolution_rule: "sql_primary",
          owner_layer: "governed_context_resolution",
          schema_ref: "actions",
          schema_version: "v1",
          binding_mode: "sql_runtime_authority",
          sheet_role: "runtime_action_registry",
          source_surface_id: null,
          source_surface_role: null,
          retired_replacement_surface_id: null,
          backend_type: "sql",
          backend_adapter: "governed_context_resolution.actions",
          authority_model: "sql_runtime_authority",
          portability_class: "runtime_action_authority",
          repair_candidate_types: "surface_authority|action_readback|plugin_binding_integrity",
          repair_priority: "high",
          updated_at: "2026-05-26T00:00:00.000Z",
        }]];
      }
      if (compactSql.includes("FROM `actions` a")) {
        return [[
          {
            action_key: "crm.contact.list",
            status: "active",
            module_binding: "http_generic_api",
            connector_family: "rest_api",
            runtime_capability_class: "tenant_plugin_action",
            runtime_callable: 1,
            primary_executor: "platform_plugin_private_rest_dispatch",
            action_id: "act.crm.contact.list",
            action_title: "List CRM contacts",
            action_class: "read",
            action_scope: "tenant",
            route_target: "platformPluginPrivateRestDispatch",
            execution_layer: "runtime",
            logging_target: "execution_log_unified",
            openai_action_binding: "http_generic_api",
            endpoint_group: "crm",
            review_required: "FALSE",
            openai_schema_ref: "schema.crm.contact.list",
            oauth_config_ref: null,
            oauth_binding_status: null,
            openai_schema_file_name: "crm.openapi.yaml",
            openai_schema_storage_surface: "db",
            required_variable_contracts: "tenant_id|connection_id",
            runtime_binding_profile: "tenant_rest_plugin",
            request_envelope_required: "TRUE",
            structured_api_supported: "TRUE",
            conversational_trigger_supported: "FALSE",
            provider_agnostic: "TRUE",
            allowed_actor_roles: "admin|member",
            allowed_governance_levels: "standard|advanced",
            client_allowed: "tenant_1",
            team_allowed: "growth",
            admin_only: "FALSE",
            writeback_scope: "none",
            plugin_binding_id: "bind.crm.contact.list",
            plugin_app_key: "tenant.nagy_sample_crm_20260525",
            plugin_binding_role: "primary_api",
            plugin_credential_source: "tenant_connection",
            plugin_exposure_default: "runtime_only",
            plugin_binding_status: "active",
            plugin_display_name: "Nagy Sample CRM Plugin",
            plugin_auth_type: "api_key",
            plugin_category: "rest_api",
            plugin_status: "active",
            policy_tenant_id: "tenant_1",
            policy_source_mode: "dedicated",
            policy_fallback_allowed: 0,
            policy_status: "active",
            active_connection_count: 1,
            primary_connection_count: 1,
          },
          {
            action_key: "github_api_mcp",
            status: "active",
            module_binding: "github",
            connector_family: "rest_api",
            runtime_capability_class: "repository_automation",
            runtime_callable: 1,
            primary_executor: "github_api_mcp",
            action_id: "act.github",
            action_title: "GitHub API",
            action_class: "admin_tool",
            action_scope: "platform",
            route_target: "github",
            execution_layer: "admin",
            logging_target: "execution_log_unified",
            openai_action_binding: "github_api_mcp",
            endpoint_group: "github",
            review_required: "TRUE",
            openai_schema_ref: "schema.github",
            runtime_binding_profile: "platform_managed_github_app",
            structured_api_supported: "TRUE",
            conversational_trigger_supported: "FALSE",
            provider_agnostic: "FALSE",
            allowed_actor_roles: "admin",
            allowed_governance_levels: "advanced",
            client_allowed: "all",
            team_allowed: "all",
            admin_only: "TRUE",
            writeback_scope: "repo",
            plugin_binding_id: "bind.github",
            plugin_app_key: "github",
            plugin_binding_role: "primary_api",
            plugin_credential_source: "platform_managed",
            plugin_exposure_default: "curated_exports",
            plugin_binding_status: "active",
            plugin_display_name: "GitHub",
            plugin_auth_type: "oauth2",
            plugin_category: "code",
            plugin_status: "active",
            active_connection_count: 0,
            primary_connection_count: 0,
          },
          {
            action_key: "legacy.disabled",
            status: "deprecated",
            module_binding: "legacy",
            connector_family: "legacy",
            runtime_capability_class: "legacy",
            runtime_callable: 0,
            action_id: "act.legacy",
            action_title: "Legacy disabled action",
            action_class: "legacy",
            action_scope: "platform",
            admin_only: "FALSE",
            allowed_actor_roles: "all",
            allowed_governance_levels: "standard",
          },
        ]];
      }
      throw new Error(`unexpected query: ${compactSql}`);
    },
  };
  return pool;
}

{
  const pool = createPool();
  const result = await resolveActionCandidates({
    pool,
    action_key: "crm.contact.list",
    plugin_key: "tenant.nagy_sample_crm_20260525",
    tenant_id: "tenant_1",
    user_id: "user_1",
    actor_role: "member",
    governance_level: "standard",
    client_key: "tenant_1",
    team_key: "growth",
    limit: 5,
  });

  assert.equal(result.ok, true);
  assert.equal(result.resolver, "shared_action_registry_authority_resolver");
  assert.equal(result.mode, "read_model_only");
  assert.equal(result.surface_authority.ok, true);
  assert.equal(result.secrets_included, false);
  assert.equal(result.taxonomy_model.plugin_container_layer, "app_integrations");
  assert.equal(result.taxonomy_model.plugin_binding_layer, "app_integration_action_bindings");
  assert.equal(result.count, 1);
  assert.equal(result.candidates[0].action_key, "crm.contact.list");
  assert.equal(result.candidates[0].plugin.plugin_key, "tenant.nagy_sample_crm_20260525");
  assert.equal(result.candidates[0].plugin.connection_summary.active_connection_count, 1);
  assert.equal(result.candidates[0].evaluation.allowed, true);
  assert(result.candidates[0].customization.layers.includes("plugin_container_specialization"));
  assert(result.candidates[0].customization.layers.includes("plugin_action_binding_specialization"));
  assert(result.candidates[0].customization.layers.includes("protocol_binding_specialization"));
  assert.equal(result.candidates[0].secrets_included, false);
}

{
  const pool = createPool();
  const result = await resolveActionCandidates({
    pool,
    actor_role: "member",
    governance_level: "standard",
    include_denied: true,
    limit: 10,
  });

  const github = result.candidates.find((candidate) => candidate.action_key === "github_api_mcp");
  assert(github);
  assert.equal(github.evaluation.allowed, false);
  assert(github.evaluation.reasons.includes("admin_only_action"));

  const legacy = result.candidates.find((candidate) => candidate.action_key === "legacy.disabled");
  assert(legacy);
  assert.equal(legacy.evaluation.allowed, false);
  assert(legacy.evaluation.reasons.includes("action_not_active"));
  assert(legacy.evaluation.reasons.includes("action_not_runtime_callable"));
}

console.log("action registry authority resolver tests passed");
