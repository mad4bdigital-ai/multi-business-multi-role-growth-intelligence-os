-- Sprint 65: Remote Runtime catalog/probe tools.
-- These tools expose readiness metadata only. They never open SSH, local shell, files, or return secrets.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'remote_runtime_target_catalog',
  'Remote Runtime Target Catalog',
  'List remote_ssh_runtime targets and command allowlists for hosting_account and local_path targets without exposing secrets or executing SSH/local commands.',
  'POST',
  '/platform/remote-runtime/targets/catalog',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"target_kind":{"type":"string","enum":["hosting_account","local_path"]},"provider_family":{"type":"string"},"status":{"type":"string","enum":["planned","active","disabled","archived"]},"include_commands":{"type":"boolean","default":true},"limit":{"type":"integer","minimum":1,"maximum":250,"default":100}}}',
  NULL,
  'admin,platform-plugins,remote-runtime,remote-ssh,local-path,catalog,diagnostic,no_secrets,read_only',
  1,
  250
),
(
  'remote_runtime_probe',
  'Remote Runtime Target Probe',
  'Dry-run readiness probe for a remote_ssh_runtime target. Does not open SSH, local shell, or file access. Returns whether the target is ready for future allowlisted dispatch.',
  'POST',
  '/platform/remote-runtime/probe',
  NULL,
  '{"type":"object","required":["target_id"],"properties":{"target_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"command_key":{"type":"string","default":"status"},"dry_run":{"type":"boolean","default":true}}}',
  NULL,
  'admin,platform-plugins,remote-runtime,remote-ssh,local-path,probe,diagnostic,no_secrets,read_only',
  1,
  251
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
