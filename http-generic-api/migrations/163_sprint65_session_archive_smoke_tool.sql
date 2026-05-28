-- Sprint 65: Session archive/writeback certification tool.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'session_archive_smoke',
  'Session Archive Drive Writeback Smoke',
  'Run governed GPT session archive smoke. Writes a synthetic GPT action session, verifies Drive Doc and JSONL writeback, SQL pointer/hash/preview-only storage, activation readback, and optional cleanup. Does not return secret values.',
  'POST',
  '/release/session-archive-smoke',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"include_drive_readback":{"type":"boolean","default":true},"cleanup":{"type":"boolean","default":true},"smoke_subfolder":{"type":"string","default":"_smoke_archives"}},"additionalProperties":false}',
  NULL,
  'session,archive,drive,writeback,smoke,read_write,admin,release,certification,no_secrets,cleanup_supported',
  1,
  258
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
