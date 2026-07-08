-- Hard-disable the temporary Hostinger SSH executor gate after parity cleanup readback.
-- Safety contract: no_provider_call, no_credential_payload_read, no_raw_secrets, no_external_send, no_external_write, no_deploy_execution, secrets_included=false.
UPDATE platform_runtime_config
SET
  config_json = JSON_MERGE_PATCH(
    COALESCE(config_json, JSON_OBJECT()),
    JSON_OBJECT(
      'enabled', false,
      'disabled_after_parity_verification', true,
      'disabled_by', 'gpt_admin',
      'disabled_at', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ'),
      'parity_verification_run_id', '1b619912-fc20-46f8-a000-37d80e115a8b',
      'parity_verified_commit_sha', '308146d11050ebb473b4f85f1ff54feab7e41aac',
      'deploy_allowed', false,
      'restart_allowed', false,
      'provider_dispatch_allowed', false,
      'credential_payload_read_allowed', false,
      'secrets_included', false,
      'hard_disabled_by_migration', '1041_sprint69_hard_disable_temporary_hostinger_executor_gate.sql'
    )
  ),
  status = 'disabled',
  note = 'Temporary Hostinger SSH executor gate hard-disabled after parity cleanup readback. Production parity run 1b619912-fc20-46f8-a000-37d80e115a8b matched 308146d11050ebb473b4f85f1ff54feab7e41aac. No deploy, provider call, credential payload read, raw secret, external send, or external write.',
  updated_at = CURRENT_TIMESTAMP
WHERE config_key = 'remote_runtime_hostinger_ssh_executor_enabled';
