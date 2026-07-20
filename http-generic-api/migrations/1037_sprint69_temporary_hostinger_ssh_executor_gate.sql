UPDATE platform_runtime_config
SET
  config_json = JSON_OBJECT(
    'enabled', true,
    'purpose', 'temporary_hostinger_ssh_deploy_release_runtime_parity_20260706',
    'target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
    'expected_commit_sha', 'post_merge_deploy_envelope_required',
    'expires_at', DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR), '%Y-%m-%dT%H:%i:%sZ'),
    'approved_by', 'gpt_admin',
    'approved_at', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ'),
    'deploy_allowed', true,
    'restart_allowed', true,
    'provider_dispatch_allowed', false,
    'credential_payload_read_allowed', false,
    'secrets_included', false,
    'enable_reason', 'Temporary executor gate for governed production deploy release after release readiness pass, dispatch certification renewal, dry-run dispatch_ready, and approval envelope. Must be disabled after deploy readback.'
  ),
  status = 'active',
  note = 'Temporary Hostinger SSH executor gate for governed deploy release. Expires automatically in config_json and must be disabled after readback.',
  updated_at = CURRENT_TIMESTAMP
WHERE config_key = 'remote_runtime_hostinger_ssh_executor_enabled';
