-- Sprint 67: Google Ads credential readiness gate.
-- Scope: readiness/preflight only. Does not decrypt credentials, call Google Ads, or mutate spend.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('google_ads_credential_readiness_gate_policy_v1',
   JSON_OBJECT(
     'policy_key','google_ads_credential_readiness_gate_policy_v1',
     'status','active',
     'tool_key','google_ads_credential_readiness_gate',
     'script','http-generic-api/scripts/google-ads-credential-readiness-gate.mjs',
     'app_key','google_ads',
     'requires_active_user_app_connection',true,
     'requires_credential_ref_present',true,
     'requires_active_credential_binding',true,
     'requires_validated_connection_by_default',true,
     'does_not_read_encrypted_credentials',true,
     'does_not_decrypt_credentials',true,
     'does_not_call_google_ads',true,
     'does_not_mutate_spend',true,
     'future_execution_contract',JSON_OBJECT(
       'google_ads_execution_adapter_must_require_credential_readiness',true,
       'credential_readiness_must_be_ready_for_dispatch',true,
       'real_google_ads_user_connection_required',true,
       'preflight_gate_still_required',true,
       'execution_enablement_still_required',true
     ),
     'secrets_included',false
   ),
   'active',
   'Google Ads credential readiness gate. Checks connection/binding readiness using metadata only; no decrypt, no provider call, no spend mutation.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'google_ads_credential_readiness_gate',
  'Google Ads Credential Readiness Gate',
  'Checks whether Google Ads has an active user_app_connection and active credential binding suitable for future execution. Metadata/readiness only: no credential decrypt, no Google Ads call, no spend mutation.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','google_ads_credential_readiness_gate'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',16,'description','Supports --tenant-id, --user-id, --connection-id, --max-validation-age-hours, --no-require-validated.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,google_ads,credential_readiness,connection_gate,no_execution,no_provider_call,no_credential_decrypt,no_spend_change,no_secrets,spend_governance',
  1,
  237
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;

UPDATE platform_runtime_config
   SET config_json = JSON_SET(
         config_json,
         '$.future_execution_contract.credential_readiness_gate_required', true,
         '$.future_execution_contract.credential_readiness_tool_key', 'google_ads_credential_readiness_gate',
         '$.future_execution_contract.real_google_ads_user_connection_required', true
       ),
       note = CASE
         WHEN note LIKE '%credential readiness gate%' THEN note
         ELSE CONCAT(note, ' Future provider execution also requires google_ads_credential_readiness_gate.')
       END,
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'google_ads_budget_execution_adapter_skeleton_policy_v1';
