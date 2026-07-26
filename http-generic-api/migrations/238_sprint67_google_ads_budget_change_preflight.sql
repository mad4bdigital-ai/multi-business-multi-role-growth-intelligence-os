-- Sprint 67: Google Ads budget change preflight gate.
-- Scope: preflight/admin tool only. No Google Ads provider call, no credential read, no spend mutation.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('google_ads_budget_change_preflight_policy_v1',
   JSON_OBJECT(
     'policy_key','google_ads_budget_change_preflight_policy_v1',
     'status','active',
     'app_key','google_ads',
     'capability_key','google_ads_budget_change',
     'operation_intent','spend_budget_update',
     'tool_key','google_ads_budget_change_preflight',
     'script','http-generic-api/scripts/google-ads-budget-change-preflight.mjs',
     'requires_capability_envelope',true,
     'accepted_envelope_app_keys',JSON_ARRAY('google_ads'),
     'accepted_envelope_intents',JSON_ARRAY('google_ads_budget_change','spend_budget_update','campaign_budget_update','budget_update','write'),
     'requires_budget_quota_authority',true,
     'budget_quota_tool_key','budget_quota_authority_dry_run',
     'missing_budget_authority_blocks_execution',true,
     'limit_exceeded_blocks_execution',true,
     'budget_authority_decision_required','ready_for_dispatch',
     'no_provider_call',true,
     'no_credential_read',true,
     'no_spend_change',true,
     'future_execution_gate_required',true,
     'secrets_included',false
   ),
   'active',
   'Google Ads budget change preflight. Requires capability envelope and budget/quota authority; does not call Google Ads or mutate spend.'
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
  'google_ads_budget_change_preflight',
  'Google Ads Budget Change Preflight',
  'Preflight gate for Google Ads budget changes. Requires a ready Google Ads capability envelope and budget/quota authority. Does not call Google Ads, read credentials, or change spend.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','google_ads_budget_change_preflight'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',32,'description','Required: --capability-envelope-id and --requested-amount-minor. Supports --tenant-id, --user-id, --workspace-id, --workspace-key, --brand-key, --customer-id, --campaign-id, --campaign-budget-resource-name, --currency, --meter-key, --explain.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,google_ads,budget,quota,preflight,no_execution,no_provider_call,no_credential_read,no_spend_change,capability_envelope_required,spend_governance',
  1,
  234
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
