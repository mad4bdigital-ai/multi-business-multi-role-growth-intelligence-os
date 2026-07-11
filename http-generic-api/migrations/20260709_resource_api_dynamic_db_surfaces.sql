-- Dynamic Resource API surface registry seeds.
-- source_authority: platform_data_table_registry
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included_false

INSERT INTO platform_data_table_registry
  (table_key, display_name, description, physical_table_name, scope_mode, tenant_column, workspace_column,
   primary_key_columns_json, readable_columns_json, writable_columns_json, creatable_columns_json, patchable_columns_json,
   filterable_columns_json, required_create_columns_json, json_columns_json, default_values_json,
   allowed_operations_json, enabled_surfaces_json, soft_delete_column, soft_delete_value, max_limit, sort_order, status, metadata_json)
VALUES
  ('system_endpoints','System Endpoints','Governed endpoint readiness repair surface.','endpoints','platform',NULL,NULL,'["endpoint_key"]','["endpoint_key","status"]','[]','[]','[]','["endpoint_key","status"]','[]','[]','{}','["list","read","patch"]','["admin"]',NULL,NULL,100,10,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}'),
  ('admin_platform_endpoint_tools','Admin Platform Endpoint Tools','Governed admin tool metadata surface.','admin_platform_endpoint_tools','platform',NULL,NULL,'["tool_key"]','["tool_key"]','[]','[]','[]','["tool_key"]','[]','[]','{}','["list","read","create","patch","archive","restore"]','["admin"]','is_enabled','0',100,20,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}'),
  ('platform_data_table_registry','Platform Data Table Registry','Self-hosted registry surface for DB-backed resources.','platform_data_table_registry','platform',NULL,NULL,'["table_key"]','["table_key","status"]','[]','[]','[]','["table_key","status"]','[]','[]','{}','["list","read","create","patch","archive","restore"]','["admin"]','status','archived',100,30,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}'),
  ('platform_resource_operation_registry','Platform Resource Operation Registry','Binds DB resources to HTTP/tool operations.','platform_resource_operation_registry','platform',NULL,NULL,'["operation_id"]','["operation_id","status"]','[]','[]','[]','["operation_id","status"]','[]','[]','{}','["list","read","create","patch","archive","restore"]','["admin"]','status','archived',100,40,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}'),
  ('capability_resolution_envelopes','Capability Resolution Envelopes','Read-only capability envelope readiness surface.','capability_resolution_envelope_ledger','platform',NULL,NULL,'["envelope_id"]','["envelope_id"]','[]','[]','[]','["envelope_id"]','[]','[]','{}','["list","read"]','["admin"]',NULL,NULL,100,50,'active','{"source_authority":"platform_data_table_registry","secrets_included":false,"read_only":true}'),
  ('user_app_connections','User App Connections','Tenant-scoped safe connection status surface.','user_app_connections','tenant','tenant_id',NULL,'["connection_id"]','["connection_id","tenant_id","status"]','[]','[]','[]','["connection_id","tenant_id","status"]','[]','[]','{}','["list","read","patch","archive"]','["admin","tenant"]','status','revoked',100,60,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}'),
  ('app_action_grants','App Action Grants','Admin-governed action grant surface.','app_action_grants','platform',NULL,'workspace_id','["grant_id"]','["grant_id","status"]','[]','[]','[]','["grant_id","status"]','[]','[]','{}','["list","read","create","patch","archive","restore"]','["admin"]','status','revoked',100,70,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}'),
  ('cms_site_access_grants','CMS Site Access Grants','Tenant-scoped CMS grant repair and readback surface.','cms_site_access_grants','tenant','tenant_id','workspace_id','["grant_id"]','["grant_id","tenant_id","status"]','[]','[]','[]','["grant_id","tenant_id","status"]','[]','[]','{}','["list","read","create","patch","archive","restore"]','["admin","tenant"]','status','revoked',100,80,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}'),
  ('agent_skill_grants','Agent Skill Grants','Tenant-aware agent skill grant surface.','agent_skill_grants','tenant','tenant_id',NULL,'["grant_id"]','["grant_id","tenant_id","status"]','[]','[]','[]','["grant_id","tenant_id","status"]','[]','[]','{}','["list","read","create","patch","archive","restore"]','["admin","tenant"]','status','revoked',100,90,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}'),
  ('permission_grants','Permission Grants','Tenant-scoped permission grant surface.','permission_grants','tenant','tenant_id',NULL,'["grant_id"]','["grant_id","tenant_id"]','[]','[]','[]','["grant_id","tenant_id"]','[]','[]','{}','["list","read","create","patch"]','["admin","tenant"]',NULL,NULL,100,100,'active','{"source_authority":"platform_data_table_registry","secrets_included":false}')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), physical_table_name=VALUES(physical_table_name),
  scope_mode=VALUES(scope_mode), tenant_column=VALUES(tenant_column), workspace_column=VALUES(workspace_column),
  primary_key_columns_json=VALUES(primary_key_columns_json), readable_columns_json=VALUES(readable_columns_json),
  filterable_columns_json=VALUES(filterable_columns_json), allowed_operations_json=VALUES(allowed_operations_json),
  enabled_surfaces_json=VALUES(enabled_surfaces_json), soft_delete_column=VALUES(soft_delete_column), soft_delete_value=VALUES(soft_delete_value),
  max_limit=VALUES(max_limit), sort_order=VALUES(sort_order), status=VALUES(status), metadata_json=VALUES(metadata_json), updated_at=NOW();
