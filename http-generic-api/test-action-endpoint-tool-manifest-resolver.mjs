import assert from "node:assert/strict";
import { resolveActionEndpointToolManifest } from "./actionEndpointToolManifestResolver.js";

function surfaceRow(surfaceId, name, schemaRef) {
  return {
    surface_id: surfaceId,
    logical_surface_key: surfaceId,
    surface_name: name,
    surface_type: "registry",
    surface_scope: "runtime",
    storage_type: "sql_table",
    active_status: "active",
    authority_status: "authoritative",
    required_for_execution: "TRUE",
    resolution_rule: "sql_primary",
    owner_layer: "governed_context_resolution",
    schema_ref: schemaRef,
    schema_version: "v1",
    binding_mode: "sql_runtime_authority",
    sheet_role: "runtime_manifest",
    source_surface_id: null,
    source_surface_role: null,
    retired_replacement_surface_id: null,
    backend_type: "sql",
    backend_adapter: `governed_context_resolution.${schemaRef}`,
    authority_model: "sql_runtime_authority",
    portability_class: "runtime_authority",
    repair_candidate_types: "surface_authority|readback|binding_integrity",
    repair_priority: "high",
    updated_at: "2026-05-26T00:00:00.000Z",
  };
}

function createPool() {
  const state = { queries: [] };
  const pool = {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params });
      const compactSql = String(sql).replace(/\s+/g, " ").trim();
      if (compactSql.includes("FROM `registry_surfaces_catalog`")) {
        const surfaceId = params[0];
        if (surfaceId === "surface.endpoint_registry_sheet") return [[surfaceRow(surfaceId, "API Actions Endpoint Registry", "endpoints")]];
        if (surfaceId === "surface.platform_tool_manifest") return [[surfaceRow(surfaceId, "Platform Tool Manifest", "admin_platform_endpoint_tools")]];
        if (surfaceId === "surface.actions_registry_sheet") return [[surfaceRow(surfaceId, "Actions Registry", "actions")]];
        throw new Error(`unexpected surface: ${surfaceId}`);
      }
      if (compactSql.includes("FROM `actions` a")) {
        return [[{
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
        }]];
      }
      if (compactSql.includes("FROM endpoints")) {
        return [[{
          endpoint_id: "ep.crm.contact.list",
          parent_action_key: "crm.contact.list",
          endpoint_key: "crm_contact_list",
          endpoint_title: "List CRM contacts endpoint",
          endpoint_operation: "listContacts",
          endpoint_role: "primary",
          method: "GET",
          provider_domain: "tenant_plugin_private_rest",
          provider_family: "rest_api",
          endpoint_path_or_function: "/contacts",
          route_target: "platformPluginPrivateRestDispatch",
          openai_action_name: "crm_contact_list",
          module_binding: "http_generic_api",
          connector_family: "rest_api",
          status: "active",
          spec_validation_status: "valid",
          auth_validation_status: "valid",
          privacy_validation_status: "valid",
          execution_readiness: "ready",
          transport_required: "TRUE",
          fallback_allowed: "FALSE",
          schema_json_present: 1,
          child_openai_schema_file_id_present: 0,
          schema_overlay_mode: "none",
          schema_overlay_status: "ready",
          schema_overlay_parent_action_key: null,
          required_variable_contracts: "tenant_id|connection_id",
          runtime_binding_profile: "tenant_rest_plugin",
          review_required: "FALSE",
          admin_only: "FALSE",
          allowed_actor_roles: "admin|member",
          allowed_governance_levels: "standard|advanced",
          client_allowed: "tenant_1",
          team_allowed: "growth",
          writeback_scope: "none",
        }]];
      }
      if (compactSql.includes("FROM app_integration_tool_bindings b")) {
        return [[
          {
            binding_id: "tool.bind.connection.create",
            app_key: "tenant.nagy_sample_crm_20260525",
            tool_key: "admin_app_connection_create",
            tool_surface: "admin_platform_tool",
            binding_role: "connection_management",
            credential_source: "tenant_connection",
            exposure_scope: "admin",
            binding_status: "active",
            display_name: "Create Admin App Connection",
            description: "Create a governed app connection.",
            http_method: "POST",
            http_path: "/app-connections",
            path_param_keys: null,
            input_schema_present: 1,
            fixed_body_present: 0,
            tags: "credentials,app-integrations,admin",
            tool_is_enabled: 1,
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
  const result = await resolveActionEndpointToolManifest({
    pool,
    action_key: "crm.contact.list",
    endpoint_key: "crm_contact_list",
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
  assert.equal(result.resolver, "shared_action_endpoint_tool_manifest_resolver");
  assert.equal(result.mode, "read_model_only");
  assert.equal(result.surface_authority.action_registry.ok, true);
  assert.equal(result.surface_authority.endpoint_registry.ok, true);
  assert.equal(result.surface_authority.tool_manifest.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.manifests[0].action.action_key, "crm.contact.list");
  assert.equal(result.manifests[0].endpoints.length, 1);
  assert.equal(result.manifests[0].endpoints[0].endpoint_key, "crm_contact_list");
  assert.equal(result.manifests[0].tools.length, 1);
  assert.equal(result.manifests[0].tools[0].tool_key, "admin_app_connection_create");
  assert.equal(result.manifests[0].readiness.manifest_complete, true);
  assert.equal(result.secrets_included, false);
  assert.equal(result.manifests[0].secrets_included, false);
  assert(result.authority_chain.includes("action_registry_authority_resolver"));
  assert(result.authority_chain.includes("platform_tool_manifest"));
}

console.log("action endpoint tool manifest resolver tests passed");
