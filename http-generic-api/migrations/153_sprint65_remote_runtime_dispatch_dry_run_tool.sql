-- Sprint 65: Remote Runtime dispatch dry-run tool.
-- This tool plans allowlisted dispatch only. It never opens SSH, local shell, local files, or returns secrets.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'remote_runtime_dispatch_dry_run',
  'Remote Runtime Dispatch Dry Run',
  'Plan an allowlisted remote_ssh_runtime dispatch for a target and command. Evaluates target readiness, global command allowlist, target command allowlist, and approval requirements. Never opens SSH/local shell/files and never executes commands.',
  'POST',
  '/platform/remote-runtime/dispatch-dry-run',
  NULL,
  '{"type":"object","required":["target_id","command_key"],"properties":{"target_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"command_key":{"type":"string"},"inputs":{"type":"object"},"approval_id":{"type":"string"},"approval_reason":{"type":"string"}}}',
  NULL,
  'admin,platform-plugins,remote-runtime,remote-ssh,local-path,dispatch,dry-run,diagnostic,no_secrets,read_only,approval_gate',
  1,
  254
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
