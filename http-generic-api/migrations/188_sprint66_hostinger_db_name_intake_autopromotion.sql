-- Sprint 66: Hostinger SSH DB_NAME credential and credential-intake auto-promotion governance
-- Adds the production DB_NAME as a platform-scoped DB-encrypted secret slot
-- and marks it as required for Hostinger production runtime readiness. This also
-- documents that ssh_key_pair intake can auto-promote submitted encrypted fields
-- into platform_secrets when metadata approval is present.

SET @platform_tenant_id := 'f2795a7f-8d06-4053-8bee-35ca9af8b460';
SET @platform_brand_id := '13';
SET @platform_brand_key := 'growth_intelligence_platform';
SET @prod_system_id := '98d6a18b-5578-11f1-9baf-8e76a7e1749f';
SET @prod_system_key := 'hostinger_ssh_prod_platform';

INSERT INTO `platform_secrets`
  (`secret_key`, `secret_type`, `storage_backend`, `secret_ref`, `value_sha256`, `value_ciphertext`, `metadata_json`, `status`, `created_by`)
VALUES
  ('hostinger_ssh_prod_db_name', 'db_name', 'db_encrypted', NULL, NULL, '', JSON_OBJECT('provisioning_status','pending_secret_value','brand_id',@platform_brand_id,'brand_target_key',@platform_brand_key,'system_key',@prod_system_key,'required_for','hostinger_ssh_prod_platform'), 'active', 'migration_188')
ON DUPLICATE KEY UPDATE
  secret_type = VALUES(secret_type),
  storage_backend = 'db_encrypted',
  secret_ref = NULL,
  metadata_json = VALUES(metadata_json),
  status = 'active',
  updated_at = CURRENT_TIMESTAMP;

UPDATE `secret_references`
   SET owner_type = 'platform',
       owner_id = @platform_brand_key,
       system_id = @prod_system_id,
       provider_family = 'hostinger',
       connector_family = 'hostinger_ssh',
       store_type = 'db_encrypted',
       env_var_name = NULL,
       vault_path = NULL,
       validation_status = 'pending_secret_value',
       status = 'active'
 WHERE tenant_id = @platform_tenant_id
   AND system_id = @prod_system_id
   AND secret_key = 'hostinger_ssh_prod_db_name';

INSERT INTO `secret_references`
  (`ref_id`, `tenant_id`, `owner_type`, `owner_id`, `system_id`, `provider_family`, `connector_family`, `credential_type`, `scope_json`, `consent_status`, `validation_status`, `status`, `secret_key`, `store_type`, `env_var_name`, `vault_path`, `description`)
SELECT UUID(), @platform_tenant_id, 'platform', @platform_brand_key, @prod_system_id, 'hostinger', 'hostinger_ssh', 'db_name',
       JSON_OBJECT('brand_id',@platform_brand_id,'brand_target_key',@platform_brand_key,'system_key',@prod_system_key,'environment','production'),
       'not_required', 'pending_secret_value', 'active', 'hostinger_ssh_prod_db_name', 'db_encrypted', NULL, NULL,
       'Platform brand DB-encrypted Hostinger production DB_NAME'
WHERE NOT EXISTS (
  SELECT 1 FROM `secret_references` sr
   WHERE sr.tenant_id = @platform_tenant_id
     AND sr.system_id = @prod_system_id
     AND sr.secret_key = 'hostinger_ssh_prod_db_name'
);

INSERT INTO `credential_bindings`
  (`binding_id`, `tenant_id`, `owner_type`, `owner_id`, `system_id`, `target_key`, `credential_role`, `credential_ref`, `provider_family`, `connector_family`, `resolution_priority`, `status`, `created_by`)
SELECT UUID(), @platform_tenant_id, 'platform', @platform_brand_key, @prod_system_id, @prod_system_key,
       'db_name', 'platform_secret:hostinger_ssh_prod_db_name', 'hostinger', 'hostinger_ssh', 20, 'active', 'migration_188'
WHERE NOT EXISTS (
  SELECT 1 FROM `credential_bindings` cb
   WHERE cb.tenant_id = @platform_tenant_id
     AND cb.system_id = @prod_system_id
     AND cb.credential_role = 'db_name'
     AND cb.status = 'active'
);

UPDATE `connected_systems`
   SET config_json = JSON_SET(
       COALESCE(config_json, JSON_OBJECT()),
       '$.secret_refs.db_name', 'platform_secret:hostinger_ssh_prod_db_name',
       '$.required_credential_roles', JSON_ARRAY('ssh_host','ssh_port','ssh_user','ssh_private_key','db_name'),
       '$.credential_intake.auto_promote_platform_secrets', true,
       '$.credential_intake.requires_db_name', true
     ),
       updated_at = CURRENT_TIMESTAMP
 WHERE system_id = @prod_system_id;

UPDATE `admin_platform_endpoint_tools`
   SET description = 'Create a short-lived, single-use secure web form URL for entering connector credentials. Supports schema-driven fields for API keys, bearer tokens, MCP, webhook, basic auth, custom headers, client credentials, and SSH key-pair credentials including DB_NAME. Metadata may request server-side auto-promotion to platform secrets after form submission.',
       input_schema = JSON_SET(
         COALESCE(input_schema, JSON_OBJECT()),
         '$.properties.metadata.properties.auto_promote_platform_secrets', JSON_OBJECT('type','boolean'),
         '$.properties.metadata.properties.platform_secret_mappings', JSON_OBJECT('type','array'),
         '$.properties.metadata.properties.promotion_approved', JSON_OBJECT('type','boolean'),
         '$.properties.metadata.properties.promotion_reason', JSON_OBJECT('type','string')
       )
 WHERE tool_key = 'credential_intake_session_create';
