-- Sprint 65: expose the Action → Endpoint → Tool authority manifest as a
-- governed admin diagnostic tool. This route is read-only and dry-run only.
-- It never dispatches providers and never returns credential payloads.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'action_manifest_resolve',
  'Resolve Action Manifest',
  'Read-only dry-run diagnostic for Action → Endpoint → Tool authority. Returns manifest readiness and guard preview without executing providers or exposing secrets.',
  'POST',
  '/platform/action-manifest/resolve',
  NULL,
  '{"type":"object","properties":{"action_key":{"type":"string"},"endpoint_key":{"type":"string"},"plugin_key":{"type":"string"},"tool_key":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"actor_role":{"type":"string"},"governance_level":{"type":"string"},"client_key":{"type":"string"},"team_key":{"type":"string"},"preview_enforce":{"type":"boolean","default":false},"require_plugin_connection":{"type":"boolean","default":false}},"additionalProperties":false}',
  NULL,
  'action-manifest,authority,diagnostics,dry-run,read_only,secret_free',
  1,
  462
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
