-- Sprint 67: Google Ads budget execution adapter skeleton.
-- Scope: disabled/skeleton execution adapter only. No Google Ads provider call, no credential read, no spend mutation.

CREATE TABLE IF NOT EXISTS google_ads_budget_execution_gate_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  audit_id VARCHAR(36) NOT NULL,
  preflight_id VARCHAR(36) NULL,
  capability_envelope_id VARCHAR(36) NULL,
  decision VARCHAR(128) NOT NULL,
  requested_amount_minor BIGINT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  blocking_gap_count INT NOT NULL DEFAULT 0,
  audit_json JSON NOT NULL,
  no_provider_call TINYINT(1) NOT NULL DEFAULT 1,
  no_spend_change TINYINT(1) NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_google_ads_budget_execution_gate_audit_id (audit_id),
  KEY idx_google_ads_budget_execution_gate_preflight (preflight_id),
  KEY idx_google_ads_budget_execution_gate_decision (decision, created_at),
  CONSTRAINT chk_google_ads_execution_gate_no_provider_call CHECK (no_provider_call = 1),
  CONSTRAINT chk_google_ads_execution_gate_no_spend_change CHECK (no_spend_change = 1),
  CONSTRAINT chk_google_ads_execution_gate_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('google_ads_budget_execution_adapter_skeleton_policy_v1',
   JSON_OBJECT(
     'policy_key','google_ads_budget_execution_adapter_skeleton_policy_v1',
     'status','active',
     'tool_key','google_ads_budget_change_execution_adapter',
     'script','http-generic-api/scripts/google-ads-budget-change-execution-adapter.mjs',
     'audit_table','google_ads_budget_execution_gate_audit',
     'requires_preflight_execution_gate_helper',true,
     'helper','http-generic-api/preflightLedgerExecutionGate.js',
     'requires_ready_preflight_id',true,
     'requires_expected_envelope_match_when_supplied',true,
     'provider_execution_implemented',false,
     'always_blocks_provider_execution',true,
     'real_google_ads_credentials_required_for_future_execution',true,
     'no_provider_call',true,
     'no_credential_read',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Google Ads budget execution adapter skeleton. Validates ready preflight through helper, records audit, then blocks provider execution. No Google Ads call or spend mutation.'
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
  'google_ads_budget_change_execution_adapter',
  'Google Ads Budget Change Execution Adapter Skeleton',
  'Skeleton adapter that validates a ready Google Ads budget preflight through preflightLedgerExecutionGate.js, records an audit row, and then blocks because provider execution is not implemented. No credential read, provider call, or spend change.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','google_ads_budget_change_execution_adapter'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',32,'description','Required: --preflight-id. Optional: --expected-envelope-id, --requested-amount-minor, --currency, --customer-id, --campaign-id, --campaign-budget-resource-name.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,google_ads,budget,execution_adapter_skeleton,preflight_gate_required,no_execution,no_provider_call,no_credential_read,no_spend_change,no_secrets,spend_governance',
  0,
  236
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
