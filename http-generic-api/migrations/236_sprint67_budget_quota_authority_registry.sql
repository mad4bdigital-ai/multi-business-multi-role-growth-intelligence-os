-- Sprint 67: Budget + Quota Authority Registry foundation.
-- Scope: authority registry + dry-run admin tool only.
-- No provider spend, no connector execution, no secrets.

CREATE TABLE IF NOT EXISTS budget_quota_authority_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  authority_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  workspace_key VARCHAR(191) NULL,
  brand_key VARCHAR(191) NULL,
  app_key VARCHAR(128) NULL,
  capability_key VARCHAR(191) NULL,
  operation_intent VARCHAR(128) NULL,
  meter_key VARCHAR(128) NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'USD',
  period ENUM('per_action','daily','weekly','monthly','quarterly','annual','lifetime') NOT NULL DEFAULT 'monthly',
  max_amount_minor BIGINT NULL,
  max_units BIGINT NULL,
  approval_required TINYINT(1) NOT NULL DEFAULT 1,
  required_role VARCHAR(64) NULL,
  approver_user_id VARCHAR(64) NULL,
  enforcement_action ENUM('block','require_approval','warn') NOT NULL DEFAULT 'require_approval',
  priority INT NOT NULL DEFAULT 100,
  status ENUM('active','draft','disabled','archived') NOT NULL DEFAULT 'active',
  source VARCHAR(64) NOT NULL DEFAULT 'admin_policy',
  policy_json JSON NULL,
  created_by VARCHAR(191) NULL,
  updated_by VARCHAR(191) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_budget_quota_authority_id (authority_id),
  KEY idx_budget_quota_authority_scope (tenant_id, workspace_id, brand_key, app_key, operation_intent),
  KEY idx_budget_quota_authority_meter (meter_key, status, period),
  KEY idx_budget_quota_authority_status (status, priority),
  CONSTRAINT chk_budget_quota_authority_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('budget_quota_authority_registry_policy_v1',
   JSON_OBJECT(
     'policy_key','budget_quota_authority_registry_policy_v1',
     'status','active',
     'table','budget_quota_authority_registry',
     'dry_run_tool_key','budget_quota_authority_dry_run',
     'purpose','Provide scoped budget and quota authority before spend-changing or platform-cost actions can execute.',
     'authority_scopes',JSON_ARRAY('tenant','workspace','brand','app','capability','operation_intent','meter'),
     'target_families',JSON_ARRAY('google_ads_budget_change','openrouter_platform_fallback','codex_platform_fallback','make_mcp_write','custom_api_write','browser_session_side_effects'),
     'execution_contract',JSON_OBJECT(
       'spend_changing_tools_must_check_authority',true,
       'missing_authority_blocks_execution',true,
       'limit_exceeded_blocks_execution',true,
       'approval_required_flows_through_capability_envelope_approve',true,
       'quota_required_must_be_visible_in_envelope',true,
       'no_provider_call_or_connector_forwarding_in_dry_run',true
     ),
     'no_execution',true,
     'secrets_included',false
   ),
   'active',
   'Budget + quota authority registry foundation. Dry-run only; no provider spend or connector execution.'
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
  'budget_quota_authority_dry_run',
  'Budget + Quota Authority Dry Run',
  'Evaluate whether a requested spend/quota-changing operation has scoped budget or quota authority. Does not execute provider calls, connector forwarding, or spend changes.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','budget_quota_authority_dry_run'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',24,'description','Flags include --tenant-id, --workspace-id, --workspace-key, --brand-key, --app-key, --capability-key, --operation-intent, --meter-key, --requested-amount-minor, --requested-units, --currency, --explain')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,budget,quota,authority,dry_run,no_execution,no_secrets,spend_governance,managed_dedicated_dynamic',
  1,
  233
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
