-- Sprint 67: Ads provider capability profile registry.
-- Scope: provider-agnostic ads governance profiles only. No provider calls, credential reads, or spend changes.

CREATE TABLE IF NOT EXISTS ads_provider_capability_profile_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  provider_family VARCHAR(128) NOT NULL DEFAULT 'ads_provider',
  status ENUM('active','draft','disabled','archived') NOT NULL DEFAULT 'draft',
  spend_capability_key VARCHAR(128) NOT NULL,
  budget_meter_key VARCHAR(128) NOT NULL,
  default_currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  credential_source VARCHAR(64) NOT NULL DEFAULT 'user_connection',
  credential_app_key VARCHAR(128) NOT NULL,
  primary_api_action_key VARCHAR(191) NULL,
  preflight_tool_key VARCHAR(191) NULL,
  preflight_family_key VARCHAR(128) NULL,
  preflight_ledger_table VARCHAR(191) NULL,
  preflight_validator_family_key VARCHAR(128) NULL,
  credential_readiness_tool_key VARCHAR(191) NULL,
  credential_readiness_ledger_table VARCHAR(191) NULL,
  execution_adapter_key VARCHAR(191) NULL,
  execution_enablement_family_key VARCHAR(128) NULL,
  execution_enabled_default TINYINT(1) NOT NULL DEFAULT 0,
  account_id_field VARCHAR(128) NULL,
  campaign_id_field VARCHAR(128) NULL,
  budget_resource_field VARCHAR(128) NULL,
  required_scopes_json JSON NULL,
  supported_operations_json JSON NULL,
  governance_contract_json JSON NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ads_provider_profile_key (provider_key),
  KEY idx_ads_provider_profile_status (status, provider_family),
  KEY idx_ads_provider_profile_capability (spend_capability_key, status),
  CONSTRAINT chk_ads_provider_profile_no_secrets CHECK (secrets_included = 0),
  CONSTRAINT chk_ads_provider_profile_execution_default_disabled CHECK (execution_enabled_default = 0)
);

INSERT INTO ads_provider_capability_profile_registry (
  provider_key, display_name, provider_family, status, spend_capability_key,
  budget_meter_key, default_currency, credential_source, credential_app_key,
  primary_api_action_key, preflight_tool_key, preflight_family_key,
  preflight_ledger_table, preflight_validator_family_key,
  credential_readiness_tool_key, credential_readiness_ledger_table,
  execution_adapter_key, execution_enablement_family_key,
  execution_enabled_default, account_id_field, campaign_id_field,
  budget_resource_field, required_scopes_json, supported_operations_json,
  governance_contract_json, secrets_included
) VALUES (
  'google_ads','Google Ads','ads_provider','active','google_ads_budget_change',
  'google_ads_budget_minor','USD','user_connection','google_ads','googleads_api',
  'google_ads_budget_change_preflight','google_ads_budget','google_ads_budget_preflight_ledger',
  'google_ads_budget','google_ads_credential_readiness_gate','google_ads_credential_readiness_ledger',
  'google_ads_budget_change_execution_adapter','google_ads_budget',0,'customer_id','campaign_id',
  'campaign_budget_resource_name',JSON_ARRAY('ads_read','ads_management'),JSON_ARRAY('budget_change','campaign_budget_update'),
  JSON_OBJECT(
    'requires_capability_envelope',true,
    'requires_budget_quota_authority',true,
    'requires_preflight_ledger',true,
    'requires_preflight_validator',true,
    'requires_preflight_execution_gate_helper',true,
    'requires_credential_readiness_gate',true,
    'requires_credential_readiness_ledger',true,
    'requires_execution_enablement_gate',true,
    'requires_execution_enablement_approval_flow',true,
    'real_provider_execution_implemented',false,
    'execution_enabled_default',false,
    'no_provider_call',true,
    'no_spend_change',true,
    'secrets_included',false
  ),0
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  provider_family = VALUES(provider_family),
  status = VALUES(status),
  spend_capability_key = VALUES(spend_capability_key),
  budget_meter_key = VALUES(budget_meter_key),
  default_currency = VALUES(default_currency),
  credential_source = VALUES(credential_source),
  credential_app_key = VALUES(credential_app_key),
  primary_api_action_key = VALUES(primary_api_action_key),
  preflight_tool_key = VALUES(preflight_tool_key),
  preflight_family_key = VALUES(preflight_family_key),
  preflight_ledger_table = VALUES(preflight_ledger_table),
  preflight_validator_family_key = VALUES(preflight_validator_family_key),
  credential_readiness_tool_key = VALUES(credential_readiness_tool_key),
  credential_readiness_ledger_table = VALUES(credential_readiness_ledger_table),
  execution_adapter_key = VALUES(execution_adapter_key),
  execution_enablement_family_key = VALUES(execution_enablement_family_key),
  execution_enabled_default = 0,
  account_id_field = VALUES(account_id_field),
  campaign_id_field = VALUES(campaign_id_field),
  budget_resource_field = VALUES(budget_resource_field),
  required_scopes_json = VALUES(required_scopes_json),
  supported_operations_json = VALUES(supported_operations_json),
  governance_contract_json = VALUES(governance_contract_json),
  secrets_included = 0,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('ads_provider_capability_profile_registry_policy_v1',
   JSON_OBJECT(
     'policy_key','ads_provider_capability_profile_registry_policy_v1',
     'status','active',
     'table','ads_provider_capability_profile_registry',
     'lookup_tool_key','ads_provider_profile_lookup',
     'provider_onboarding_contract',JSON_OBJECT(
       'new_ads_provider_must_have_profile',true,
       'profile_execution_enabled_default_false',true,
       'provider_execution_requires_capability_envelope',true,
       'provider_execution_requires_budget_quota_authority',true,
       'provider_execution_requires_preflight_ledger',true,
       'provider_execution_requires_credential_readiness_ledger',true,
       'provider_execution_requires_execution_enablement_gate',true,
       'provider_execution_requires_separate_adapter_implementation',true
     ),
     'active_profiles_seeded',JSON_ARRAY('google_ads'),
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Provider-agnostic ads capability profile registry. Describes ads provider governance profiles; does not execute providers.'
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
  'ads_provider_profile_lookup',
  'Ads Provider Profile Lookup',
  'Read-only lookup for ads_provider_capability_profile_registry profiles. No provider calls, credential reads, or spend changes.',
  'POST','/admin/control',JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','ads_provider_profile_lookup'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8,'description','Supports --provider-key=<key> and --include-inactive.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,ads_provider,profile,registry,lookup,read_only,no_execution,no_provider_call,no_spend_change,no_secrets',
  1,242
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
