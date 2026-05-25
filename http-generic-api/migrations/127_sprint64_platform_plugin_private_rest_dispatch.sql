-- Sprint 64: guarded owner-scoped REST dispatch for private Platform Plugin contributions.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'platform_plugin_contribution_private_dispatch_rest',
  'Dispatch Private Platform Plugin REST Action',
  'Execute a guarded REST action for an owner-scoped private Platform Plugin contribution. Requires private activation, owner scope, active user_app_connections.api_base_url, HTTPS, and no secrets in request headers.',
  'POST',
  '/platform/plugins/contributions/dispatch-rest',
  NULL,
  '{"type":"object","required":["contribution_id","action_key","tenant_id","user_id"],"properties":{"contribution_id":{"type":"string"},"action_key":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"requested_credential_scope":{"type":"string","default":"tenant_connection"},"input":{"type":"object"},"dry_run":{"type":"boolean","default":false},"timeout_ms":{"type":"integer","minimum":1000,"maximum":30000,"default":10000}}}',
  NULL,
  'admin,platform-plugin,contribution,state_changing,audited,no_secrets,owner_scoped,private_runtime,rest_dispatch',
  1,
  130
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
