-- 964_sprint68_hostinger_stored_credential_apply_policy.sql
-- Purpose: allow Hostinger deploy/restart apply authorization to use existing
-- stored credential bindings while continuing to forbid inline secrets,
-- credential payload reads, freeform shell, and raw secret responses.
-- Safety: No provider calls. No credential payload reads. No raw secrets. No external send. No external writes. secrets_included=false

UPDATE capability_apply_authorization_policy_registry
SET allow_credential_binding = 1,
    allow_no_credential_binding = 1,
    policy_json = JSON_SET(
      CASE WHEN JSON_VALID(policy_json) THEN policy_json ELSE JSON_OBJECT() END,
      '$.stored_credential_binding_allowed', true,
      '$.credential_payload_read_allowed', false,
      '$.inline_secret_allowed', false,
      '$.raw_secret_response_allowed', false,
      '$.freeform_shell_allowed', false,
      '$.expected_commit_sha_required', true,
      '$.path_allowlist_required', true,
      '$.actual_execution_requires_capability_envelope', true,
      '$.requires_post_deploy_readback', true,
      '$.secrets_included', false
    ),
    notes = CONCAT(COALESCE(notes,''), CASE WHEN notes IS NULL OR notes='' THEN '' ELSE '\n' END,
      'Sprint 68: allow stored credential bindings for Hostinger deploy authorization only. Credential payload reads, inline secrets, raw secret responses, and freeform shell remain forbidden.'),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key = 'hostinger_deploy_release_apply_policy_v1'
  AND app_key = 'hostinger'
  AND capability_key = 'remote_runtime_hostinger_deploy_release'
  AND runtime_surface = 'remote_runtime_hostinger_deploy_release'
  AND status = 'active';

UPDATE capability_apply_authorization_policy_registry
SET allow_credential_binding = 1,
    allow_no_credential_binding = 1,
    policy_json = JSON_SET(
      CASE WHEN JSON_VALID(policy_json) THEN policy_json ELSE JSON_OBJECT() END,
      '$.stored_credential_binding_allowed', true,
      '$.credential_payload_read_allowed', false,
      '$.inline_secret_allowed', false,
      '$.raw_secret_response_allowed', false,
      '$.freeform_shell_allowed', false,
      '$.break_glass_reason_required', true,
      '$.deploy_write_allowed', false,
      '$.actual_execution_requires_capability_envelope', true,
      '$.requires_post_restart_readback', true,
      '$.secrets_included', false
    ),
    notes = CONCAT(COALESCE(notes,''), CASE WHEN notes IS NULL OR notes='' THEN '' ELSE '\n' END,
      'Sprint 68: allow stored credential bindings for Hostinger restart authorization only. Credential payload reads, inline secrets, raw secret responses, freeform shell, and deploy writes remain forbidden by restart policy.'),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key = 'hostinger_restart_app_apply_policy_v1'
  AND app_key = 'hostinger'
  AND capability_key = 'hostinger_ssh_restart_app'
  AND runtime_surface = 'hostinger_ssh_restart_app'
  AND status = 'active';

CREATE OR REPLACE VIEW v_hostinger_apply_policy_readiness AS
SELECT
  policy_key,
  app_key,
  capability_key,
  operation_intent,
  runtime_surface,
  status,
  allow_external_write,
  allow_credential_binding,
  allow_no_credential_binding,
  requires_typed_confirmation,
  requires_readback,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.stored_credential_binding_allowed')) AS stored_credential_binding_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.credential_payload_read_allowed')) AS credential_payload_read_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.inline_secret_allowed')) AS inline_secret_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.raw_secret_response_allowed')) AS raw_secret_response_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.freeform_shell_allowed')) AS freeform_shell_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.secrets_included')) AS policy_secrets_included,
  0 AS secrets_included
FROM capability_apply_authorization_policy_registry
WHERE policy_key IN ('hostinger_deploy_release_apply_policy_v1','hostinger_restart_app_apply_policy_v1');
