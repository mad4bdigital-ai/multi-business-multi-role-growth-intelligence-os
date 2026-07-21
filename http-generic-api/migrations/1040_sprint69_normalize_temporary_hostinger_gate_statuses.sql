-- Normalize temporary Hostinger deploy-gate cleanup statuses after migration 1039.
-- Safety contract: no_provider_call, no_credential_payload_read, no_raw_secrets, no_external_send, no_external_write, no_deploy_execution, secrets_included=false.
UPDATE platform_runtime_config
SET
  status = 'disabled',
  note = CONCAT(
    'Temporary Hostinger SSH executor gate status normalized to disabled after parity cleanup. ',
    'Original cleanup evidence run 1b619912-fc20-46f8-a000-37d80e115a8b matched 308146d11050ebb473b4f85f1ff54feab7e41aac.'
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE config_key = 'remote_runtime_hostinger_ssh_executor_enabled'
  AND JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.enabled')) = 'false'
  AND status <> 'disabled';

UPDATE platform_resource_authority_bindings
SET
  status = 'revoked',
  notes = CONCAT(
    'Temporary Hostinger deploy resource authority status normalized to revoked after parity cleanup. ',
    'Original cleanup evidence run 1b619912-fc20-46f8-a000-37d80e115a8b matched 308146d11050ebb473b4f85f1ff54feab7e41aac. ',
    'Binding retained for audit only.'
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE binding_id = 'a8ec8ed2-5ba7-4b33-98ac-f6f51076ce38'
  AND resource_type = 'remote_runtime_target'
  AND resource_uri = 'hostinger://auth.mad4b.com/production'
  AND status <> 'revoked';
