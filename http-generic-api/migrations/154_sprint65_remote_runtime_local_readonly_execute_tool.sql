-- Sprint 65: Remote Runtime local-path read-only execution tool.
-- This is the first execution surface and is intentionally narrow:
-- local_path targets only, status/git_status request only, fixed repo_status_growth_os connector alias only.
-- It does not support Hostinger/SSH, arbitrary shell, file access, deploy, restart, or extra args.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'remote_runtime_local_readonly_execute',
  'Remote Runtime Local Read-only Execute',
  'Execute the first allowlisted Remote Runtime local_path command. Supports only status/git_status, maps to connector_shell alias repo_status_growth_os, rejects Hostinger/SSH targets, arbitrary shell, file access, extra args, deploy, and restart.',
  'POST',
  '/platform/remote-runtime/local-path/execute-readonly',
  NULL,
  '{"type":"object","required":["target_id"],"properties":{"target_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"device_id":{"type":"string"},"command_key":{"type":"string","enum":["status","git_status"],"default":"status"},"inputs":{"type":"object"},"timeout_ms":{"type":"integer","minimum":1000,"maximum":120000}}}',
  NULL,
  'admin,platform-plugins,remote-runtime,local-path,execute,read_only,no_secrets,allowlisted_alias,connector_shell',
  1,
  255
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
