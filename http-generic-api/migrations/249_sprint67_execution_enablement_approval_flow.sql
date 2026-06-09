-- Sprint 67: Execution enablement approval flow.
-- Scope: governed request/approve/revoke flow for execution enablement rows. No provider calls, no credential reads, no spend changes.

CREATE TABLE IF NOT EXISTS execution_enablement_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(36) NOT NULL,
  family_key VARCHAR(128) NOT NULL,
  adapter_key VARCHAR(191) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  workspace_key VARCHAR(191) NULL,
  requested_by VARCHAR(191) NOT NULL,
  reason VARCHAR(512) NULL,
  ttl_hours INT NOT NULL DEFAULT 24,
  max_risk_level VARCHAR(32) NOT NULL DEFAULT 'critical',
  request_status ENUM('pending_approval','approved','rejected','revoked','expired') NOT NULL DEFAULT 'pending_approval',
  approval_hold_id VARCHAR(36) NULL,
  enablement_id VARCHAR(96) NULL,
  approved_by VARCHAR(191) NULL,
  approved_at DATETIME NULL,
  decision_note VARCHAR(512) NULL,
  request_json JSON NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_execution_enablement_request_id (request_id),
  KEY idx_execution_enablement_request_lookup (family_key, adapter_key, request_status, created_at),
  KEY idx_execution_enablement_request_enablement (enablement_id),
  CONSTRAINT chk_execution_enablement_request_no_secrets CHECK (secrets_included = 0)
);

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('execution_enablement_approval_flow_policy_v1',
   JSON_OBJECT(
     'policy_key','execution_enablement_approval_flow_policy_v1',
     'status','active',
     'request_table','execution_enablement_requests',
     'enablement_table','execution_enablement_registry',
     'approval_table','approval_holds',
     'request_tool_key','execution_enablement_request',
     'approve_tool_key','execution_enablement_approve',
     'revoke_tool_key','execution_enablement_revoke',
     'requires_approval_hold',true,
     'approved_rows_are_scoped_and_expiring',true,
     'default_max_ttl_hours',168,
     'does_not_execute_target_capability',true,
     'no_provider_call',true,
     'no_spend_change',true,
     'secrets_included',false
   ),
   'active',
   'Governed execution enablement approval flow. Request creates pending approval, approve creates scoped expiring enablement, revoke disables it. No provider execution.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('execution_enablement_request','Request Execution Enablement','Create a pending execution enablement request and approval_holds row. No provider call or spend change.','POST','/admin/control',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('tool',JSON_OBJECT('type','string','const','shell'),'action',JSON_OBJECT('type','string','const','run'),'alias',JSON_OBJECT('type','string','const','execution_enablement_request'),'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',20)),'required',JSON_ARRAY('tool','action','alias'),'additionalProperties',false),NULL,'admin,execution_enablement,request,approval,no_execution,no_provider_call,no_spend_change,no_secrets',1,239),
  ('execution_enablement_approve','Approve Execution Enablement','Approve a pending execution enablement request and create a scoped expiring enablement row. No provider call or spend change.','POST','/admin/control',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('tool',JSON_OBJECT('type','string','const','shell'),'action',JSON_OBJECT('type','string','const','run'),'alias',JSON_OBJECT('type','string','const','execution_enablement_approve'),'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',12)),'required',JSON_ARRAY('tool','action','alias'),'additionalProperties',false),NULL,'admin,execution_enablement,approve,approval,no_execution,no_provider_call,no_spend_change,no_secrets',1,240),
  ('execution_enablement_revoke','Revoke Execution Enablement','Disable an active execution enablement row. No provider call or spend change.','POST','/admin/control',JSON_ARRAY(),JSON_OBJECT('type','object','properties',JSON_OBJECT('tool',JSON_OBJECT('type','string','const','shell'),'action',JSON_OBJECT('type','string','const','run'),'alias',JSON_OBJECT('type','string','const','execution_enablement_revoke'),'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8)),'required',JSON_ARRAY('tool','action','alias'),'additionalProperties',false),NULL,'admin,execution_enablement,revoke,no_execution,no_provider_call,no_spend_change,no_secrets',1,241)
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
