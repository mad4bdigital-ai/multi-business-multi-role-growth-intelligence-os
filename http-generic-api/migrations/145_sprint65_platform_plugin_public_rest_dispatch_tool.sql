-- Sprint 65: governed public Platform Plugin REST dispatch tool.
-- This dispatch path only runs after platform_plugin_resolve returns dispatch_ready.
-- It does not accept or return secret payloads; credentials remain resolved server-side.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_plugin_dispatch_rest',
  'Dispatch Platform Plugin REST Action',
  'Execute a promoted or tenant-installed Platform Plugin REST action after resolver approval gates pass. Requires dispatch_ready resolution, active connection with api_base_url, and an action template from plugin contribution metadata. Supports dry_run and returns no secrets.',
  'POST',
  '/platform/plugins/dispatch-rest',
  NULL,
  '{"type":"object","required":["plugin_key","action_key","tenant_id","user_id"],"properties":{"plugin_key":{"type":"string"},"action_key":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"agent_id":{"type":"string"},"requested_credential_scope":{"type":"string","default":"tenant_connection"},"input":{"type":"object","additionalProperties":true},"dry_run":{"type":"boolean","default":false},"timeout_ms":{"type":"integer","minimum":1000,"maximum":30000,"default":10000}}}',
  NULL,
  'admin,platform-plugin,dispatch,rest,state_changing,audited,no_secrets,approval_gate',
  1,
  131
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
