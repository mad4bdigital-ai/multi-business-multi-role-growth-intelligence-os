-- Sprint 65: Remote Runtime target management tools.
-- These routes manage DB target metadata and validation status only.
-- They do not open SSH, local shell, local files, or return secret values.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'remote_runtime_target_upsert',
  'Remote Runtime Target Upsert',
  'Create or update a remote_ssh_runtime target binding for a hosting_account or local_path. Stores metadata, allowlists, and references only; rejects secret-like fields and never opens SSH/local shell/files.',
  'POST',
  '/platform/remote-runtime/targets/upsert',
  NULL,
  '{"type":"object","required":["tenant_id","target_kind"],"properties":{"target_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"target_kind":{"type":"string","enum":["hosting_account","local_path"]},"provider_family":{"type":"string"},"connector_family":{"type":"string"},"system_id":{"type":"string"},"connection_id":{"type":"string"},"local_path_id":{"type":"string"},"host_label":{"type":"string"},"root_path":{"type":"string"},"path_allowlist":{"type":"array","items":{"type":"string"}},"command_allowlist":{"type":"array","items":{"type":"string"}},"metadata":{"type":"object"},"status":{"type":"string","enum":["planned","active","disabled","archived"]},"validation_status":{"type":"string","enum":["unknown","pending_configuration","valid","invalid","inaccessible","partial"]},"updated_by":{"type":"string"}}}',
  NULL,
  'admin,platform-plugins,remote-runtime,remote-ssh,local-path,target-management,state_changing,no_secrets,approval_gate',
  1,
  252
),
(
  'remote_runtime_target_validate',
  'Remote Runtime Target Validate',
  'Validate remote_ssh_runtime target metadata and references without opening SSH/local shell/files. Updates validation_status and returns a dry-run probe.',
  'POST',
  '/platform/remote-runtime/targets/validate',
  NULL,
  '{"type":"object","required":["target_id"],"properties":{"target_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"updated_by":{"type":"string"}}}',
  NULL,
  'admin,platform-plugins,remote-runtime,remote-ssh,local-path,target-management,state_changing,no_secrets,approval_gate',
  1,
  253
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
