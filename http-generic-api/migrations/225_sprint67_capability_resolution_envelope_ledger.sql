-- Sprint 67: Capability Resolution Envelope Ledger.
-- Stores immutable dry-run resolution envelopes before execution so tools can
-- reference a concrete authority decision. No tools are executed and no secrets
-- are stored or returned by this migration.

CREATE TABLE IF NOT EXISTS capability_resolution_envelope_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  envelope_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  workspace_key VARCHAR(191) NULL,
  brand_key VARCHAR(191) NULL,
  app_key VARCHAR(128) NULL,
  capability_key VARCHAR(191) NULL,
  operation_intent VARCHAR(128) NULL,
  risk_class VARCHAR(64) NULL,
  selected_source_tier VARCHAR(96) NULL,
  selected_runtime_surface VARCHAR(128) NULL,
  authority_status VARCHAR(64) NULL,
  decision VARCHAR(96) NULL,
  envelope_status ENUM('dry_run','ready_for_dispatch','ready_requires_approval','blocked','superseded','expired') NOT NULL DEFAULT 'dry_run',
  dispatch_allowed TINYINT(1) NOT NULL DEFAULT 0,
  apply_allowed TINYINT(1) NOT NULL DEFAULT 0,
  approval_required TINYINT(1) NOT NULL DEFAULT 0,
  quota_required TINYINT(1) NOT NULL DEFAULT 0,
  audit_required TINYINT(1) NOT NULL DEFAULT 1,
  readback_required TINYINT(1) NOT NULL DEFAULT 0,
  blocking_gap_count INT UNSIGNED NOT NULL DEFAULT 0,
  envelope_sha256 CHAR(64) NOT NULL,
  envelope_json JSON NOT NULL,
  requested_by VARCHAR(191) NULL,
  execution_ref VARCHAR(191) NULL,
  execution_status ENUM('not_executed','referenced','executed','failed','cancelled') NOT NULL DEFAULT 'not_executed',
  expires_at DATETIME NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_capability_resolution_envelope_id (envelope_id),
  KEY idx_capability_resolution_envelope_tenant (tenant_id, created_at),
  KEY idx_capability_resolution_envelope_app (app_key, operation_intent, created_at),
  KEY idx_capability_resolution_envelope_status (envelope_status, expires_at),
  KEY idx_capability_resolution_envelope_decision (decision, created_at),
  CONSTRAINT chk_capability_resolution_envelope_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('capability_resolution_envelope_ledger_policy_v1',
   JSON_OBJECT(
     'policy_key','capability_resolution_envelope_ledger_policy_v1',
     'status','active',
     'table','capability_resolution_envelope_ledger',
     'creator_tool_key','capability_resolution_envelope_create',
     'dry_run_source_tool_key','capability_resolution_dry_run',
     'purpose','Persist a no-secret dry-run resolution envelope before execution so runtime tools can reference a concrete authority decision.',
     'default_ttl_minutes',60,
     'max_ttl_minutes',1440,
     'execution_contract',JSON_OBJECT(
       'execution_tools_should_require_envelope_id',true,
       'dispatch_requires_dispatch_allowed',true,
       'apply_requires_apply_allowed',true,
       'approval_required_must_be_resolved_before_apply',true,
       'quota_required_must_be_resolved_before_platform_fallback',true,
       'expired_envelopes_must_not_execute',true,
       'envelope_hash_must_match_stored_json',true
     ),
     'no_execution',true,
     'secrets_included',false,
     'must_not_store',JSON_ARRAY('raw_secret','oauth_token','api_key_value','private_key','decrypted_credential','value_ciphertext')
   ),
   'active',
   'Capability resolution envelope ledger policy. No execution and no secrets.'
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
  'capability_resolution_envelope_create',
  'Create Capability Resolution Envelope',
  'Run capability_resolution_dry_run and persist a no-secret authority envelope with a SHA-256 hash for later execution tools to reference. Does not execute the selected capability.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','capability_resolution_envelope_create'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',32,'description','Flags mirror capability_resolution_dry_run plus --requested-by and --ttl-minutes.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,capability_resolution,envelope_ledger,dry_run,no_execution,no_secrets,authority_graph,immutable_reference,managed_dedicated_dynamic',
  1,
  231
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
