-- Dynamic Resource API surfaces and repository automation seeds.
-- Source authority: platform_data_table_registry.
-- Generated/curated to avoid exposing secret, token, password, credential, webhook, URL, or encrypted material.
-- Idempotent: safe to run more than once.

INSERT INTO platform_data_table_registry
  (table_key, display_name, description, physical_table_name, scope_mode, tenant_column, workspace_column, primary_key_columns_json, readable_columns_json, writable_columns_json, creatable_columns_json, patchable_columns_json, filterable_columns_json, required_create_columns_json, json_columns_json, default_values_json, allowed_operations_json, enabled_surfaces_json, soft_delete_column, soft_delete_value, max_limit, sort_order, status, metadata_json)
VALUES
  ('system_endpoints', 'System Endpoints', 'Governed read/patch surface for endpoint readiness, transport, and schema contract repair.', 'endpoints', 'platform', NULL, NULL, '["endpoint_key"]', '["endpoint_key","status"]', '[]', '[]', '[]', '["endpoint_key","status"]', '[]', '[]', '{}', '["list","read","patch"]', '["admin"]', NULL, NULL, 100, 10, 'active', '{"resource_family":"registry","requires_typed_approval":true,"same_cycle_readback":true,"mutation_scope":"contract_repair_only"}'),
  ('admin_platform_endpoint_tools', 'Admin Platform Endpoint Tools', 'Governed resource surface for admin tool export metadata.', 'admin_platform_endpoint_tools', 'platform', NULL, NULL, '["tool_key"]', '["tool_key"]', '[]', '[]', '[]', '["tool_key"]', '[]', '[]', '{}', '["list","read","create","patch","archive","restore"]', '["admin"]', 'is_enabled', '0', 100, 20, 'active', '{"resource_family":"registry","requires_typed_approval":true,"same_cycle_readback":true}'),
  ('platform_data_table_registry', 'Platform Data Table Registry', 'Self-hosted governance surface for DB-backed resource surfaces.', 'platform_data_table_registry', 'platform', NULL, NULL, '["table_key"]', '["table_key","status"]', '[]', '[]', '[]', '["table_key","status"]', '[]', '[]', '{}', '["list","read","create","patch","archive","restore"]', '["admin"]', 'status', 'archived', 100, 30, 'active', '{"resource_family":"registry","requires_typed_approval":true,"same_cycle_readback":true}'),
  ('platform_resource_operation_registry', 'Platform Resource Operation Registry', 'Governed resource operation definitions that bind DB resources to HTTP paths and tool keys.', 'platform_resource_operation_registry', 'platform', NULL, NULL, '["operation_id"]', '["operation_id","status"]', '[]', '[]', '[]', '["operation_id","status"]', '[]', '[]', '{ }', '["list","read","create","patch","archive","restore"]', '["admin"]', 'status', 'archived', 100, 40, 'active', '{"resource_family":"registry","requires_typed_approval":true,"same_cycle_readback":true}'),
  ('capability_resolution_envelopes', 'Capability Resolution Envelopes', 'Read-only governed inspection surface for capability envelope blockers/readiness.', 'capability_resolution_envelope_ledger', 'platform', NULL, NULL, '["envelope_id"]', '["envelope_id"]', '[]', '[]', '[]', '["envelope_id"]', '[]', '[]', '{}', '["list","read"]', '["admin"]', NULL, NULL, 100, 50, 'active', '{"resource_family":"capability","read_only":true}'),
  ('user_app_connections', 'User App Connections', 'Tenant-scoped, safe connection status surface. Sensitive material is excluded.', 'user_app_connections', 'tenant', 'tenant_id', NULL, '["connection_id"]', '["connection_id","tenant_id","status"]', '[]', '[]', '[]', '["connection_id","tenant_id","status"]', '[]', '[]', '{}', '["list","read","patch","archive"]', '["admin","tenant"]', 'status', 'revoked', 100, 60, 'active', '{"resource_family":"user_connection","sensitive_material_excluded":true}'),
  ('app_action_grants', 'App Action Grants', 'Admin-governed action grant surface. Uses connection/workspace fields; no sensitive material exposed.', 'app_action_grants', 'platform', NULL, 'workspace_id', '["grant_id"]', '["grant_id","status"]', '[]', '[]', '[]', '["grant_id","status"]', '[]', '[]', '{}', '["list","read","create","patch","archive","restore"]', '["admin"]', 'status', 'revoked', 100, 70, 'active', '{"resource_family":"grant","requires_typed_approval":true,"same_cycle_readback":true}'),
  ('cms_site_access_grants', 'CMS Site Access Grants', 'Tenant-scoped CMS grant surface for WordPress/CMS repair and readback.', 'cms_site_access_grants', 'tenant', 'tenant_id', 'workspace_id', '["grant_id"]', '["grant_id","tenant_id","status"]', '[]', '[]', '[]', '["grant_id","tenant_id","status"]', '[]', '[]', '{}', '["list","read","create","patch","archive","restore"]', '["admin","tenant"]', 'status', 'revoked', 100, 80, 'active', '{"resource_family":"cms_grant","requires_typed_approval":true,"same_cycle_readback":true}'),
  ('agent_skill_grants', 'Agent Skill Grants', 'Tenant-aware agent skill grant surface.', 'agent_skill_grants', 'tenant', 'tenant_id', NULL, '["grant_id"]', '["grant_id","tenant_id","status"]', '[]', '[]', '[]', '["grant_id","tenant_id","status"]', '[]', '[]', '{ }', '["list","read","create","patch","archive","restore"]', '["admin","tenant"]', 'status', 'revoked', 100, 90, 'active', '{"resource_family":"agent_grant","requires_typed_approval":true,"same_cycle_readback":true}'),
  ('permission_grants', 'Permission Grants', 'Tenant-scoped permission grant surface.', 'permission_grants', 'tenant', 'tenant_id', NULL, '["grant_id"]', '["grant_id","tenant_id"]', '[]', '[]', '[]', '["grant_id","tenant_id"]', '[]', '[]', '{}', '["list","read","create","patch"]', '["admin","tenant"]', NULL, NULL, 100, 100, 'active', '{"resource_family":"permission","requires_typed_approval":true,"same_cycle_readback":true}')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  physical_table_name=VALUES(physical_table_name),
  scope_mode=VALUES(scope_mode),
  tenant_column=VALUES(tenant_column),
  workspace_column=VALUES(workspace_column),
  primary_key_columns_json=VALUES(primary_key_columns_json),
  readable_columns_json=VALUES(readable_columns_json),
  writable_columns_json=VALUES(writable_columns_json),
  creatable_columns_json=VALUES(creatable_columns_json),
  patchable_columns_json=VALUES(patchable_columns_json),
  filterable_columns_json=VALUES(filterable_columns_json),
  required_create_columns_json=VALUES(required_create_columns_json),
  json_columns_json=VALUES(json_columns_json),
  default_values_json=VALUES(default_values_json),
  allowed_operations_json=VALUES(allowed_operations_json),
  enabled_surfaces_json=VALUES(enabled_surfaces_json),
  soft_delete_column=VALUES(soft_delete_column),
  soft_delete_value=VALUES(soft_delete_value),
  max_limit=VALUES(max_limit),
  sort_order=VALUES(sort_order),
  status=VALUES(status),
  metadata_json=VALUES(metadata_json),
  updated_at=NOW();