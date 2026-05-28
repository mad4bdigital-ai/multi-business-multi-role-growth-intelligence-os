-- Sprint 65: tenant-safe live repo document reader.
-- Exposes only allowlisted tenant-facing Markdown docs through the tenant GPT MCP facade.
-- Does not expose admin repo_inspect, GitHub, raw migrations, admin guides, DB dumps, or secrets.

INSERT INTO `tenant_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'tenant_repo_doc_read',
  'Tenant Live Repo Document Read',
  'Read a bounded tenant-safe Markdown document from the live repository allowlist, or omit path to list allowed docs. Blocks admin guides, raw migrations, DB dumps, secrets, native GitHub, and raw repo access.',
  'POST',
  '/tenant/repo-docs/read',
  NULL,
  '{"type":"object","properties":{"path":{"type":"string","description":"Allowlisted tenant-safe repo document path. Omit to list allowed docs."},"doc_path":{"type":"string"},"max_chars":{"type":"integer","minimum":1000,"maximum":20000,"default":12000}},"additionalProperties":false}',
  NULL,
  'tenant,repo,docs,knowledge,read_only,no_secrets,allowlist,tenant_safe,live_repo',
  1,
  474
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
