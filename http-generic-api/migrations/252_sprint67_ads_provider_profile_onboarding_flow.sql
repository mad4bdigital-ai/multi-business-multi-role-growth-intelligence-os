-- Sprint 67: Ads provider profile onboarding flow.
-- Scope: governed request/approve/disable lifecycle for ads provider profiles. No provider calls, credential reads, or spend changes.

CREATE TABLE IF NOT EXISTS ads_provider_profile_onboarding_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(36) NOT NULL,
  approval_hold_id VARCHAR(36) NULL,
  tenant_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NULL,
  workspace_key VARCHAR(191) NULL,
  provider_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  request_status ENUM('pending_approval','approved','rejected','disabled','archived') NOT NULL DEFAULT 'pending_approval',
  requested_by VARCHAR(191) NOT NULL,
  approved_by VARCHAR(191) NULL,
  approved_at DATETIME NULL,
  decision_note VARCHAR(512) NULL,
  reason VARCHAR(512) NULL,
  profile_json JSON NOT NULL,
  profile_sha256 CHAR(64) NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ads_provider_profile_request_id (request_id),
  KEY idx_ads_provider_profile_request_provider (provider_key, request_status, created_at),
  KEY idx_ads_provider_profile_request_tenant (tenant_id, request_status, created_at),
  CONSTRAINT chk_ads_provider_profile_request_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('ads_provider_profile_onboarding_flow_policy_v1',
   JSON_OBJECT(
     'policy_key','ads_provider_profile_onboarding_flow_policy_v1',
     'status','active',
     'request_table','ads_provider_profile_onboarding_requests',
     'profile_table','ads_provider_capability_profile_registry',
     'approval_table','approval_holds',
     'request_tool_key','ads_provider_profile_request',
     'approve_tool_key','ads_provider_profile_approve',
     'disable_tool_key','ads_provider_profile_disable',
     'requires_approval_hold',true,
     'approved_profile_status','draft',
     'approved_profile_execution_enabled_default',false,
     'provider_specific_surfaces_not_created_by_onboarding',true,
     'does_not_execute_target_capability',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Governed ads provider profile onboarding flow. Request creates pending approval, approve creates draft provider profile, disable disables profile. No provider execution.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('ads_provider_profile_request','Request Ads Provider Profile','Create a pending ads provider profile onboarding request and tenant-scoped approval hold. No provider call or spend change.','POST','/admin/control',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('tool',JSON_OBJECT('type','string','const','shell'),'action',JSON_OBJECT('type','string','const','run'),'alias',JSON_OBJECT('type','string','const','ads_provider_profile_request'),'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',28)),'required',JSON_ARRAY('tool','action','alias'),'additionalProperties',false),NULL,'admin,ads_provider,profile,onboarding,request,approval,no_execution,no_provider_call,no_spend_change,no_secrets',1,243),
  ('ads_provider_profile_approve','Approve Ads Provider Profile','Approve a pending ads provider profile onboarding request and create/update a draft provider profile with execution disabled. No provider call or spend change.','POST','/admin/control',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('tool',JSON_OBJECT('type','string','const','shell'),'action',JSON_OBJECT('type','string','const','run'),'alias',JSON_OBJECT('type','string','const','ads_provider_profile_approve'),'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8)),'required',JSON_ARRAY('tool','action','alias'),'additionalProperties',false),NULL,'admin,ads_provider,profile,onboarding,approve,approval,no_execution,no_provider_call,no_spend_change,no_secrets',1,244),
  ('ads_provider_profile_disable','Disable Ads Provider Profile','Disable an ads provider profile. No provider call or spend change.','POST','/admin/control',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('tool',JSON_OBJECT('type','string','const','shell'),'action',JSON_OBJECT('type','string','const','run'),'alias',JSON_OBJECT('type','string','const','ads_provider_profile_disable'),'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8)),'required',JSON_ARRAY('tool','action','alias'),'additionalProperties',false),NULL,'admin,ads_provider,profile,onboarding,disable,no_execution,no_provider_call,no_spend_change,no_secrets',1,245)
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
