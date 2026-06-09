-- Sprint 67: Generic ads provider preflight surface blueprint.
-- Scope: provider-agnostic blueprint generation only. No provider calls, credential reads, tool creation, table creation beyond registry, or spend changes.

CREATE TABLE IF NOT EXISTS ads_provider_preflight_surface_blueprint_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  blueprint_key VARCHAR(128) NOT NULL,
  blueprint_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  status ENUM('active','draft','disabled','archived') NOT NULL DEFAULT 'active',
  validator_tool_key VARCHAR(191) NOT NULL DEFAULT 'ads_provider_preflight_surface_blueprint',
  required_contract_key VARCHAR(128) NOT NULL DEFAULT 'ads_provider_preflight_contract_v1',
  naming_policy_json JSON NOT NULL,
  surface_requirements_json JSON NOT NULL,
  policy_json JSON NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ads_provider_preflight_surface_blueprint_key (blueprint_key),
  KEY idx_ads_provider_preflight_surface_blueprint_status (status),
  CONSTRAINT chk_ads_provider_preflight_surface_blueprint_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO ads_provider_preflight_surface_blueprint_registry (
  blueprint_key, blueprint_version, status, validator_tool_key, required_contract_key,
  naming_policy_json, surface_requirements_json, policy_json, secrets_included
) VALUES (
  'ads_provider_preflight_surface_blueprint_v1',
  'v1',
  'active',
  'ads_provider_preflight_surface_blueprint',
  'ads_provider_preflight_contract_v1',
  JSON_OBJECT(
    'preflight_tool_suffix','_preflight',
    'preflight_ledger_suffix','_preflight_ledger',
    'credential_readiness_tool_suffix','_credential_readiness_gate',
    'credential_readiness_ledger_suffix','_credential_readiness_ledger',
    'execution_adapter_suffix','_execution_adapter',
    'budget_family_suffix','_budget'
  ),
  JSON_OBJECT(
    'requires_preflight_tool_key',true,
    'requires_preflight_ledger_table',true,
    'requires_preflight_validator_family_key',true,
    'requires_credential_readiness_tool_key',true,
    'requires_credential_readiness_ledger_table',true,
    'requires_execution_adapter_key',true,
    'requires_execution_enablement_family_key',true,
    'requires_budget_meter_key',true,
    'requires_spend_capability_key',true
  ),
  JSON_OBJECT(
    'blueprint_generator_tool_key','ads_provider_preflight_surface_blueprint',
    'requires_contract_validation',true,
    'does_not_create_provider_surfaces',true,
    'does_not_create_tables',true,
    'does_not_create_tools',true,
    'does_not_create_credentials',true,
    'does_not_create_execution_adapter',true,
    'provider_specific_surface_creation_requires_separate_pr',true,
    'provider_specific_surface_creation_requires_governed_migration',true,
    'provider_specific_surface_creation_requires_guard_tests',true,
    'provider_specific_surface_creation_requires_readback_smoke',true,
    'no_provider_call',true,
    'no_spend_change',true,
    'secrets_included',false
  ),
  0
)
ON DUPLICATE KEY UPDATE
  blueprint_version = VALUES(blueprint_version),
  status = VALUES(status),
  validator_tool_key = VALUES(validator_tool_key),
  required_contract_key = VALUES(required_contract_key),
  naming_policy_json = VALUES(naming_policy_json),
  surface_requirements_json = VALUES(surface_requirements_json),
  policy_json = VALUES(policy_json),
  secrets_included = 0,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('ads_provider_preflight_surface_blueprint_policy_v1',
   JSON_OBJECT(
     'policy_key','ads_provider_preflight_surface_blueprint_policy_v1',
     'status','active',
     'blueprint_table','ads_provider_preflight_surface_blueprint_registry',
     'blueprint_key','ads_provider_preflight_surface_blueprint_v1',
     'blueprint_tool_key','ads_provider_preflight_surface_blueprint',
     'required_contract_tool_key','ads_provider_preflight_contract_validate',
     'future_surface_contract',JSON_OBJECT(
       'provider_specific_preflight_surface_requires_blueprint',true,
       'blueprint_requires_contract_validation',true,
       'blueprint_is_design_only',true,
       'blueprint_must_not_create_provider_surfaces',true,
       'separate_provider_specific_pr_required',true,
       'separate_governed_migration_required',true,
       'guard_tests_required',true,
       'readback_smoke_required',true
     ),
     'does_not_create_provider_surfaces',true,
     'does_not_execute_target_capability',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Generic ads provider preflight surface blueprint. Generates design-only provider-specific preflight surface names after contract validation; no execution.'
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
  'ads_provider_preflight_surface_blueprint',
  'Ads Provider Preflight Surface Blueprint',
  'Design-only blueprint generator for provider-specific ads preflight surfaces after contract validation. It creates no tools, no tables, no credentials, no provider calls, and no spend changes.',
  'POST','/admin/control',JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','ads_provider_preflight_surface_blueprint'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8,'description','Requires --provider-key=<key>; optional --include-inactive.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,ads_provider,preflight,blueprint,design_only,read_only,no_execution,no_provider_call,no_spend_change,no_secrets',
  1,247
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
