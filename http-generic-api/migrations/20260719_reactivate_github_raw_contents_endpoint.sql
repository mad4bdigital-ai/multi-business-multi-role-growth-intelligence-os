-- 20260719_reactivate_github_raw_contents_endpoint.sql
-- Reactivate only github_api_mcp/getFileContents by copying the validated
-- runtime, auth, privacy, schema, and transport contract from the canonical
-- github_get_contents endpoint. The raw alias keeps its stable endpoint key.

UPDATE endpoints AS target
JOIN endpoints AS source
  ON source.parent_action_key = 'github_api_mcp'
 AND source.endpoint_key = 'github_get_contents'
SET target.endpoint_operation = source.endpoint_operation,
    target.provider_domain = source.provider_domain,
    target.method = source.method,
    target.endpoint_path_or_function = source.endpoint_path_or_function,
    target.route_target = source.route_target,
    target.openai_action_name = source.openai_action_name,
    target.module_binding = source.module_binding,
    target.connector_family = source.connector_family,
    target.status = 'active',
    target.spec_validation_status = source.spec_validation_status,
    target.auth_validation_status = source.auth_validation_status,
    target.privacy_validation_status = source.privacy_validation_status,
    target.execution_readiness = source.execution_readiness,
    target.endpoint_role = source.endpoint_role,
    target.execution_mode = source.execution_mode,
    target.transport_required = source.transport_required,
    target.fallback_allowed = source.fallback_allowed,
    target.fallback_match_basis = source.fallback_match_basis,
    target.fallback_provider_domain = source.fallback_provider_domain,
    target.fallback_connector_family = source.fallback_connector_family,
    target.fallback_action_name = source.fallback_action_name,
    target.fallback_route_target = source.fallback_route_target,
    target.fallback_notes = source.fallback_notes,
    target.inventory_role = source.inventory_role,
    target.inventory_source = 'governed_migration:20260719_reactivate_github_raw_contents_endpoint',
    target.notes = CONCAT_WS('\n', NULLIF(target.notes, ''), '2026-07-19: Reactivated governed raw GitHub contents alias from validated github_get_contents contract.'),
    target.brand_resolution_source = source.brand_resolution_source,
    target.transport_action_key = source.transport_action_key,
    target.endpoint_title = 'Get GitHub file contents as raw text',
    target.provider_family = source.provider_family,
    target.execution_layer = source.execution_layer,
    target.dependencies = source.dependencies,
    target.logging_target = source.logging_target,
    target.category_group = source.category_group,
    target.category_detail = source.category_detail,
    target.last_reviewed_at = '2026-07-19',
    target.legacy_status = 'active',
    target.required_variable_contracts = source.required_variable_contracts,
    target.runtime_binding_profile = source.runtime_binding_profile,
    target.child_openai_schema_file_id = source.child_openai_schema_file_id,
    target.schema_json = source.schema_json,
    target.schema_overlay_mode = source.schema_overlay_mode,
    target.schema_overlay_status = source.schema_overlay_status,
    target.schema_overlay_parent_action_key = source.schema_overlay_parent_action_key,
    target.schema_overlay_notes = source.schema_overlay_notes,
    target.client_interface_agnostic = source.client_interface_agnostic,
    target.request_envelope_required = source.request_envelope_required,
    target.structured_api_supported = source.structured_api_supported,
    target.conversational_trigger_supported = source.conversational_trigger_supported,
    target.provider_agnostic = source.provider_agnostic,
    target.allowed_actor_roles = source.allowed_actor_roles,
    target.allowed_governance_levels = source.allowed_governance_levels,
    target.client_allowed = source.client_allowed,
    target.team_allowed = source.team_allowed,
    target.admin_only = source.admin_only,
    target.writeback_scope = source.writeback_scope
WHERE target.parent_action_key = 'github_api_mcp'
  AND target.endpoint_key = 'getFileContents';

-- no_provider_mutation=true
-- no_external_write=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- same_cycle_readback_required=true
-- secrets_included=false
