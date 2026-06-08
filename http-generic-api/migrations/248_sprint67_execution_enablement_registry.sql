-- Sprint 67: Execution enablement registry.
-- Scope: final explicit enablement gate before provider execution. Does not enable Google Ads execution.

CREATE TABLE IF NOT EXISTS execution_enablement_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  enablement_id VARCHAR(64) NOT NULL,
  family_key VARCHAR(128) NOT NULL,
  adapter_key VARCHAR(191) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  workspace_key VARCHAR(191) NULL,
  status ENUM('active','draft','disabled','archived') NOT NULL DEFAULT 'draft',
  execution_enabled TINYINT(1) NOT NULL DEFAULT 0,
  required_approver VARCHAR(64) NULL,
  max_risk_level VARCHAR(32) NOT NULL DEFAULT 'critical',
  requires_preflight_gate TINYINT(1) NOT NULL DEFAULT 1,
  requires_credential_readiness TINYINT(1) NOT NULL DEFAULT 1,
  requires_budget_authority TINYINT(1) NOT NULL DEFAULT 1,
  requires_live_readback TINYINT(1) NOT NULL DEFAULT 1,
  priority INT NOT NULL DEFAULT 100,
  policy_json JSON NULL,
  expires_at DATETIME NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(191) NULL,
  updated_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_execution_enablement_id (enablement_id),
  KEY idx_execution_enablement_lookup (family_key, adapter_key, tenant_id, workspace_id, status, execution_enabled),
  CONSTRAINT chk_execution_enablement_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('execution_enablement_registry_policy_v1',
   JSON_OBJECT(
     'policy_key','execution_enablement_registry_policy_v1',
     'status','active',
     'table','execution_enablement_registry',
     'tool_key','execution_enablement_gate',
     'script','http-generic-api/scripts/execution-enablement-gate.mjs',
     'default_decision_without_row','blocked_execution_enablement_missing_or_disabled',
     'requires_explicit_enablement_row',true,
     'execution_enabled_default',false,
     'requires_preflight_gate',true,
     'requires_credential_readiness',true,
     'requires_budget_authority',true,
     'requires_live_readback',true,
     'does_not_execute_target_capability',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Execution enablement registry. Provider execution remains disabled unless an explicit active enablement row exists. No provider call or spend mutation.'
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
  'execution_enablement_gate',
  'Execution Enablement Gate',
  'Checks whether a future provider execution adapter has an explicit active execution_enablement_registry row. Missing or disabled rows block execution. No provider call, connector call, or spend mutation.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','execution_enablement_gate'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',16,'description','Required: --family-key and --adapter-key. Optional: --tenant-id, --workspace-id, --workspace-key, --preflight-id, --capability-envelope-id.')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,execution_enablement,gate,no_execution,no_provider_call,no_spend_change,no_secrets,spend_governance',
  1,
  238
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
   SET config_json = JSON_MERGE_PATCH(
         COALESCE(config_json, JSON_OBJECT()),
         JSON_OBJECT(
           'future_execution_contract', JSON_OBJECT(
             'execution_enablement_gate_required', true,
             'execution_enablement_tool_key', 'execution_enablement_gate',
             'execution_enablement_registry_table', 'execution_enablement_registry',
             'missing_enablement_blocks_provider_execution', true,
             'preflight_execution_gate_helper_required', true,
             'credential_readiness_gate_required', true,
             'execution_enablement_still_required', true,
             'secrets_included', false
           )
         )
       ),
       note = CASE
         WHEN note LIKE '%execution_enablement_gate%' THEN note
         ELSE CONCAT(note, ' Future provider execution also requires execution_enablement_gate.')
       END,
       updated_at = CURRENT_TIMESTAMP
 WHERE config_key = 'google_ads_budget_execution_adapter_skeleton_policy_v1';
