-- Sprint 66: Tenant SSH CLI approval request tool
-- Creates a tenant-scoped approval request surface for future allowlisted SSH
-- CLI execution. This migration is additive, stores no secrets, and does not
-- enable command execution.

CREATE TABLE IF NOT EXISTS tenant_ssh_cli_approval_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(36) NOT NULL,
  hold_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  connection_id VARCHAR(36) NOT NULL,
  command_key VARCHAR(64) NOT NULL,
  command_argv_json JSON NOT NULL,
  status ENUM('open','approved','rejected','expired','cancelled') NOT NULL DEFAULT 'open',
  decision_by VARCHAR(36) NULL,
  decision_note VARCHAR(512) NULL,
  expires_at DATETIME NULL,
  decided_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenant_ssh_cli_approval_request_id (request_id),
  UNIQUE KEY uq_tenant_ssh_cli_approval_hold_id (hold_id),
  KEY idx_tenant_ssh_cli_approval_tenant_status (tenant_id, status),
  KEY idx_tenant_ssh_cli_approval_connection (connection_id),
  CONSTRAINT chk_tenant_ssh_cli_approval_command CHECK (JSON_VALID(command_argv_json))
);

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'tenant_ssh_cli_approval_request_create',
  'Tenant SSH CLI Approval Request Create',
  'Create an approval request for future allowlisted SSH CLI execution. Validates a fixed command_key, stores a no-secret plan, and does not authenticate, connect, or execute commands.',
  'POST',
  '/me/infrastructure/ssh/connections/{connection_id}/cli/approval-request',
  JSON_ARRAY('connection_id'),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('connection_id','command_key'),
    'properties',JSON_OBJECT(
      'connection_id',JSON_OBJECT('type','string'),
      'command_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('pwd','whoami','uname_s','uptime'))
    ),
    'additionalProperties',false
  ),
  NULL,
  'tenant,infrastructure,ssh,cli,approval_request,allowlisted,no_secrets,no_auth,no_network,no_command,no_execute,auth_scoped,specific_path',
  1,
  328
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
  sort_order = VALUES(sort_order);
