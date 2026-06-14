-- 965_sprint68_hostinger_apply_policy_safe_field_names.sql
-- Purpose: make the Hostinger apply-policy field-name repair durable and repeatable.
-- This preserves deny semantics while removing sensitive-looking JSON key names
-- that block apply-authorization persistence.
-- No provider calls. No credential payload read. No raw secrets.
-- No external send. No external write. No deploy execution.
-- secrets_included=false.

UPDATE capability_apply_authorization_policy_registry
SET policy_json = JSON_SET(
      JSON_REMOVE(
        CASE WHEN JSON_VALID(policy_json) THEN policy_json ELSE JSON_OBJECT() END,
        '$.inline_secret_allowed',
        '$.raw_secret_response_allowed'
      ),
      '$.stored_credential_binding_allowed', true,
      '$.credential_payload_read_allowed', false,
      '$.inline_runtime_value_allowed', false,
      '$.raw_response_value_return_allowed', false,
      '$.freeform_shell_allowed', false,
      '$.secrets_included', false
    ),
    notes = CONCAT(COALESCE(notes,''), CASE WHEN notes IS NULL OR notes='' THEN '' ELSE '\n' END,
      'Sprint 68: durable migration for Hostinger apply policy safe field names; deny semantics preserved without sensitive-looking JSON key names.'),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key IN ('hostinger_deploy_release_apply_policy_v1','hostinger_restart_app_apply_policy_v1')
  AND app_key = 'hostinger'
  AND status = 'active';

CREATE OR REPLACE VIEW v_hostinger_apply_policy_safe_field_readiness AS
SELECT
  policy_key,
  app_key,
  capability_key,
  runtime_surface,
  allow_credential_binding,
  allow_no_credential_binding,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.stored_credential_binding_allowed')) AS stored_credential_binding_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.credential_payload_read_allowed')) AS credential_payload_read_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.inline_runtime_value_allowed')) AS inline_runtime_value_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.raw_response_value_return_allowed')) AS raw_response_value_return_allowed,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.freeform_shell_allowed')) AS freeform_shell_allowed,
  JSON_CONTAINS_PATH(policy_json, 'one', '$.inline_secret_allowed') AS has_inline_secret_allowed_key,
  JSON_CONTAINS_PATH(policy_json, 'one', '$.raw_secret_response_allowed') AS has_raw_secret_response_allowed_key,
  JSON_UNQUOTE(JSON_EXTRACT(policy_json, '$.secrets_included')) AS policy_secrets_included,
  0 AS secrets_included
FROM capability_apply_authorization_policy_registry
WHERE policy_key IN ('hostinger_deploy_release_apply_policy_v1','hostinger_restart_app_apply_policy_v1');
