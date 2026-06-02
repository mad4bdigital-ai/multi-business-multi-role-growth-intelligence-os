-- Sprint 66: Platform-scoped Hostinger SSH DB credential references
-- Hostinger SSH deployment credentials belong to the platform brand scope and
-- must be resolved from DB-backed secret references / credential bindings, not
-- from server env variables. This migration registers placeholders only; actual
-- secret values must be written through the secure credential intake/admin
-- secret upsert route and never pasted into chat or source control.

SET @platform_tenant_id := 'f2795a7f-8d06-4053-8bee-35ca9af8b460';
SET @platform_brand_id := '13';
SET @platform_brand_key := 'growth_intelligence_platform';
SET @prod_system_id := '98d6a18b-5578-11f1-9baf-8e76a7e1749f';
SET @prod_system_key := 'hostinger_ssh_prod_platform';

INSERT INTO `platform_secrets`
  (`secret_key`, `secret_type`, `storage_backend`, `secret_ref`, `value_sha256`, `value_ciphertext`, `metadata_json`, `status`, `created_by`)
VALUES
  ('hostinger_ssh_prod_host', 'ssh_host', 'db_encrypted', NULL, NULL, '', JSON_OBJECT('provisioning_status','pending_secret_value','brand_id',@platform_brand_id,'brand_target_key',@platform_brand_key,'system_key',@prod_system_key,'required_for','hostinger_ssh_prod_platform'), 'active', 'migration_182'),
  ('hostinger_ssh_prod_port', 'ssh_port', 'db_encrypted', NULL, NULL, '', JSON_OBJECT('provisioning_status','pending_secret_value','brand_id',@platform_brand_id,'brand_target_key',@platform_brand_key,'system_key',@prod_system_key,'required_for','hostinger_ssh_prod_platform'), 'active', 'migration_182'),
  ('hostinger_ssh_prod_user', 'ssh_user', 'db_encrypted', NULL, NULL, '', JSON_OBJECT('provisioning_status','pending_secret_value','brand_id',@platform_brand_id,'brand_target_key',@platform_brand_key,'system_key',@prod_system_key,'required_for','hostinger_ssh_prod_platform'), 'active', 'migration_182'),
  ('hostinger_ssh_prod_private_key', 'ssh_private_key', 'db_encrypted', NULL, NULL, '', JSON_OBJECT('provisioning_status','pending_secret_value','brand_id',@platform_brand_id,'brand_target_key',@platform_brand_key,'system_key',@prod_system_key,'required_for','hostinger_ssh_prod_platform'), 'active', 'migration_182')
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
   AND secret_key IN ('hostinger_ssh_prod_host','hostinger_ssh_prod_port','hostinger_ssh_prod_user','hostinger_ssh_prod_private_key');

INSERT INTO `secret_references`
  (`ref_id`, `tenant_id`, `owner_type`, `owner_id`, `system_id`, `provider_family`, `connector_family`, `credential_type`, `scope_json`, `consent_status`, `validation_status`, `status`, `secret_key`, `store_type`, `env_var_name`, `vault_path`, `description`)
SELECT UUID(), @platform_tenant_id, 'platform', @platform_brand_key, @prod_system_id, 'hostinger', 'hostinger_ssh', role_name,
       JSON_OBJECT('brand_id',@platform_brand_id,'brand_target_key',@platform_brand_key,'system_key',@prod_system_key,'environment','production'),
       'not_required', 'pending_secret_value', 'active', secret_key, 'db_encrypted', NULL, NULL,
       CONCAT('Platform brand DB-encrypted Hostinger production SSH ', role_name)
FROM (
  SELECT 'ssh_host' AS role_name, 'hostinger_ssh_prod_host' AS secret_key UNION ALL
  SELECT 'ssh_port', 'hostinger_ssh_prod_port' UNION ALL
  SELECT 'ssh_user', 'hostinger_ssh_prod_user' UNION ALL
  SELECT 'ssh_private_key', 'hostinger_ssh_prod_private_key'
) refs
WHERE NOT EXISTS (
  SELECT 1 FROM `secret_references` sr
   WHERE sr.tenant_id = @platform_tenant_id
     AND sr.system_id = @prod_system_id
     AND sr.secret_key = refs.secret_key
);

INSERT INTO `credential_bindings`
  (`binding_id`, `tenant_id`, `owner_type`, `owner_id`, `system_id`, `target_key`, `credential_role`, `credential_ref`, `provider_family`, `connector_family`, `resolution_priority`, `status`, `created_by`)
SELECT UUID(), @platform_tenant_id, 'platform', @platform_brand_key, @prod_system_id, @prod_system_key,
       role_name, CONCAT('platform_secret:', secret_key), 'hostinger', 'hostinger_ssh', 20, 'active', 'migration_182'
FROM (
  SELECT 'ssh_host' AS role_name, 'hostinger_ssh_prod_host' AS secret_key UNION ALL
  SELECT 'ssh_port', 'hostinger_ssh_prod_port' UNION ALL
  SELECT 'ssh_user', 'hostinger_ssh_prod_user' UNION ALL
  SELECT 'ssh_private_key', 'hostinger_ssh_prod_private_key'
) refs
WHERE NOT EXISTS (
  SELECT 1 FROM `credential_bindings` cb
   WHERE cb.tenant_id = @platform_tenant_id
     AND cb.system_id = @prod_system_id
     AND cb.credential_role = refs.role_name
     AND cb.status = 'active'
);

UPDATE `connected_systems`
   SET config_json = JSON_SET(
       COALESCE(CAST(config_json AS JSON), JSON_OBJECT()),
       '$.secret_storage', 'platform_db_encrypted',
       '$.credential_owner', JSON_OBJECT('owner_type','platform','brand_id',@platform_brand_id,'brand_target_key',@platform_brand_key),
       '$.secret_refs.host', 'platform_secret:hostinger_ssh_prod_host',
       '$.secret_refs.port', 'platform_secret:hostinger_ssh_prod_port',
       '$.secret_refs.user', 'platform_secret:hostinger_ssh_prod_user',
       '$.secret_refs.private_key', 'platform_secret:hostinger_ssh_prod_private_key',
       '$.required_credential_roles', JSON_ARRAY('ssh_host','ssh_port','ssh_user','ssh_private_key')
     ),
       updated_at = CURRENT_TIMESTAMP
 WHERE system_id = @prod_system_id;
