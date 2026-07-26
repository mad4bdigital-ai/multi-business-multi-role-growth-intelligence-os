-- Sprint 67: Generic ads provider preflight contract.
-- Scope: provider-agnostic validation before provider-specific preflight surfaces are created. No provider calls, credential reads, or spend changes.

CREATE TABLE IF NOT EXISTS ads_provider_preflight_contract_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_key VARCHAR(128) NOT NULL,
  contract_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  status ENUM('active','draft','disabled','archived') NOT NULL DEFAULT 'active',
  applies_to_provider_family VARCHAR(128) NOT NULL DEFAULT 'ads_provider',
  validator_tool_key VARCHAR(191) NOT NULL DEFAULT 'ads_provider_preflight_contract_validate',
  required_profile_status_json JSON NOT NULL,
  required_governance_json JSON NOT NULL,
  policy_json JSON NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ads_provider_preflight_contract_key (contract_key),
  KEY idx_ads_provider_preflight_contract_status (status, applies_to_provider_family),
  CONSTRAINT chk_ads_provider_preflight_contract_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO ads_provider_preflight_contract_registry (
  contract_key, contract_version, status, applies_to_provider_family,
  validator_tool_key, required_profile_status_json, required_governance_json,
  policy_json, secrets_included
) VALUES (
  'ads_provider_preflight_contract_v1',
  'v1',
  'active',
  'ads_provider',
  'ads_provider_preflight_contract_validate',
  JSON_ARRAY('draft','active'),
  JSON_OBJECT(
    'requires_capability_envelope',true,
    'requires_budget_quota_authority',true,
    'requires_preflight_ledger',true,
    'requires_credential_readiness_ledger',true,
    'requires_execution_enablement_gate',true
  ),
  JSON_OBJECT(
    'new_provider_preflight_surface_requires_contract_validation',true,
    'validator_tool_key','ads_provider_preflight_contract_validate',
    'provider_profile_required',true,
    'execution_enabled_default_must_be_false',true,
    'draft_profiles_may_have_null_preflight_surfaces',true,
    'provider_specific_surface_creation_is_separate_future_work',true,
    'real_provider_execution_forbidden',true,
    'no_provider_call',true,
    'no_spend_change',true,
    'secrets_included',false
  ),
  0
)
ON DUPLICATE KEY UPDATE
  contract_version = VALUES(contract_version),
  status = VALUES(status),
  applies_to_provider_family = VALUES(applies_to_provider_family),
  validator_tool_key = VALUES(validator_tool_key),
  required_profile_status_json = VALUES(required_profile_status_json),
  required_governance_json = VALUES(required_governance_json),
  policy_json = VALUES(policy_json),
  secrets_included = 0,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('ads_provider_preflight_contract_policy_v1',
   JSON_OBJECT(
     'policy_key','ads_provider_preflight_contract_policy_v1',
     'status','active',
     'contract_table','ads_provider_preflight_contract_registry',
     'profile_table','ads_provider_capability_profile_registry',
     'validator_tool_key','ads_provider_preflight_contract_validate',
     'contract_key','ads_provider_preflight_contract_v1',
     'future_surface_contract',JSON_OBJECT(
       'provider_specific_preflight_surface_requires_profile',true,
       'provider_specific_preflight_surface_requires_contract_validation',true,
       'provider_specific_preflight_surface_creation_separate_from_profile_onboarding',true,
       'draft_profile_can_pass_contract_for_design_only',true,
       'existing_provider_can_pass_contract_for_readback',true,
       'execution_enabled_default_must_be_false',true
     ),
     'does_not_create_provider_surfaces',true,
     'does_not_execute_target_capability',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Generic ads provider preflight contract. Validates profiles before provider-specific preflight surface design; no execution.'
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
  'ads_provider_preflight_contract_validate',
  'Ads Provider Preflight Contract Validate',
  'Read-only validator for generic ads provider preflight contract readiness. It checks provider profile metadata and governance only; no provider calls, credential reads, or spend changes.',
  'POST','/admin/control',JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','ads_provider_preflight_contract_validate'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8,'description','Requires --provider-key=<key>; optional --include-inactive.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,ads_provider,preflight,contract,validator,read_only,no_execution,no_provider_call,no_spend_change,no_secrets',
  1,246
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
