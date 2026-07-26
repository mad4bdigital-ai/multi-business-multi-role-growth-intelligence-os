-- Sprint 65: Governed session archive/writeback smoke tool.
-- Exposes the existing /release/session-archive-smoke route through the admin tool registry.
-- Smoke verifies Drive doc, JSONL sidecar, SQL pointer-only turn rows, activation readback, and cleanup.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'release_session_archive_smoke',
  'Release Session Archive Smoke',
  'Run live GPT session archive/writeback smoke. Creates a synthetic GPT action session, writes user and assistant turns, verifies Drive doc/JSONL readback, SQL pointer-only rows, activation session-context readback, and optional cleanup. Does not return raw secrets.',
  'POST',
  '/release/session-archive-smoke',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string","description":"Tenant id for the synthetic smoke session. Defaults to platform tenant."},"user_id":{"type":"string","description":"Synthetic user id for the smoke session. Defaults to a generated session_archive_smoke_* value."},"include_drive_readback":{"type":"boolean","default":true},"cleanup":{"type":"boolean","default":true},"smoke_subfolder":{"type":"string","default":"_smoke_archives"}},"additionalProperties":false}',
  NULL,
  'release,session-archive,drive-writeback,activation-readback,smoke,read_write,admin,no_secrets,cleanup_default_true',
  1,
  104
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
