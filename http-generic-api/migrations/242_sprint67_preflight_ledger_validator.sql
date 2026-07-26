-- Sprint 67: Generic preflight ledger validator registry.
-- Scope: registry + validation tool only. No provider calls, no connector execution, no spend changes.

CREATE TABLE IF NOT EXISTS preflight_ledger_validator_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  family_key VARCHAR(128) NOT NULL,
  ledger_table VARCHAR(191) NOT NULL,
  id_column VARCHAR(128) NOT NULL DEFAULT 'preflight_id',
  envelope_column VARCHAR(128) NOT NULL DEFAULT 'capability_envelope_id',
  decision_column VARCHAR(128) NOT NULL DEFAULT 'decision',
  ready_column VARCHAR(128) NOT NULL DEFAULT 'ready_for_dispatch',
  hash_column VARCHAR(128) NOT NULL DEFAULT 'preflight_sha256',
  payload_column VARCHAR(128) NOT NULL DEFAULT 'preflight_json',
  no_provider_call_column VARCHAR(128) NOT NULL DEFAULT 'no_provider_call',
  no_spend_change_column VARCHAR(128) NOT NULL DEFAULT 'no_spend_change',
  secrets_column VARCHAR(128) NOT NULL DEFAULT 'secrets_included',
  status ENUM('active','draft','disabled','archived') NOT NULL DEFAULT 'active',
  policy_json JSON NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_preflight_validator_family (family_key),
  KEY idx_preflight_validator_table (ledger_table, status),
  CONSTRAINT chk_preflight_validator_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO preflight_ledger_validator_registry (
  family_key, ledger_table, id_column, envelope_column, decision_column,
  ready_column, hash_column, payload_column, no_provider_call_column,
  no_spend_change_column, secrets_column, status, policy_json, secrets_included
) VALUES (
  'google_ads_budget',
  'google_ads_budget_preflight_ledger',
  'preflight_id',
  'capability_envelope_id',
  'decision',
  'ready_for_dispatch',
  'preflight_sha256',
  'preflight_json',
  'no_provider_call',
  'no_spend_change',
  'secrets_included',
  'active',
  JSON_OBJECT(
    'family_key','google_ads_budget',
    'requires_ready_for_execution',true,
    'expected_ready_decision','ready_for_dispatch',
    'hash_readback_required',true,
    'envelope_match_required_for_execution',true,
    'no_provider_call_required',true,
    'no_spend_change_required',true,
    'secrets_included',false
  ),
  0
)
ON DUPLICATE KEY UPDATE
  ledger_table = VALUES(ledger_table),
  id_column = VALUES(id_column),
  envelope_column = VALUES(envelope_column),
  decision_column = VALUES(decision_column),
  ready_column = VALUES(ready_column),
  hash_column = VALUES(hash_column),
  payload_column = VALUES(payload_column),
  no_provider_call_column = VALUES(no_provider_call_column),
  no_spend_change_column = VALUES(no_spend_change_column),
  secrets_column = VALUES(secrets_column),
  status = VALUES(status),
  policy_json = VALUES(policy_json),
  secrets_included = 0,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('preflight_ledger_validator_policy_v1',
   JSON_OBJECT(
     'policy_key','preflight_ledger_validator_policy_v1',
     'status','active',
     'tool_key','preflight_ledger_validate',
     'script','http-generic-api/scripts/preflight-ledger-validate.mjs',
     'registry_table','preflight_ledger_validator_registry',
     'allowlisted_tables',JSON_ARRAY('google_ads_budget_preflight_ledger'),
     'validates_hash',true,
     'validates_ready_for_dispatch',true,
     'validates_envelope_match_when_expected',true,
     'validates_no_provider_call',true,
     'validates_no_spend_change',true,
     'does_not_execute_target_capability',true,
     'secrets_included',false
   ),
   'active',
   'Generic preflight ledger validator. Validates ledger rows and hash/readback before future execution adapters can use a preflight_id. No provider or connector execution.'
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
  'preflight_ledger_validate',
  'Validate Preflight Ledger Row',
  'Validate a preflight ledger row by family key and preflight_id. Verifies no-secret markers, no-provider/no-spend markers, ready state, optional envelope match, and payload hash. Does not execute target capabilities.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','preflight_ledger_validate'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',16,'description','Required: --family-key and --preflight-id. Optional: --expected-envelope-id, --expected-decision, --allow-blocked-readback, --no-require-ready.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,preflight,ledger,validator,readback,no_execution,no_provider_call,no_spend_change,no_secrets,spend_governance',
  1,
  235
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
