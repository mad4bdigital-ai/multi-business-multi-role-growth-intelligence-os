-- Sprint 65 follow-up: Browser4 local adapter session lifecycle.
-- Registers a governed local connector Browser4 surface and a browser-runtime route
-- that runs only after browser_runtime_policy_check. No raw PowerShell surface is
-- exposed as the production Browser4 API.

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('connector_browser4', 'Device Browser4 Adapter', 'Admin-only governed Browser4 local connector adapter. Supports status and inspect_site actions with connector-side host allowlist and no secret return.', 'POST', '/connector/{device_id}/browser4', '["device_id"]',
   '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status","inspect_site"]},"url":{"type":"string"},"checks":{"type":"array","items":{"type":"string"}},"inspection_key":{"type":"string"},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000},"user_id":{"type":"string"}}}', NULL, 'device,browser4,browser-runtime,inspection,state_changing,audited,no_secrets,admin_only', 1, 147),
  ('browser_runtime_inspect_site_run', 'Run Browser Runtime Site Inspection', 'Run a Browser4 site inspection through browser runtime policy and the governed local connector adapter. Requires binding_key and URL; rejects unallowlisted domains before device execution.', 'POST', '/browser-runtime/inspect-site/run', NULL,
   '{"type":"object","required":["binding_key","url"],"properties":{"inspection_key":{"type":"string"},"binding_key":{"type":"string"},"url":{"type":"string"},"checks":{"type":"array","items":{"type":"string"}},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"policy":{"type":"object"},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000}}}', NULL, 'admin,browser-runtime,browser4,inspection,state_changing,audited,no_secrets,policy_gated', 1, 148)
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

UPDATE `browser_runtime_registry`
   SET `status` = CASE
       WHEN `status` IN ('planned', 'blocked_missing_java17', 'planned_poc_partial_java17_ready') THEN 'planned_adapter_available_after_connector_upgrade'
       ELSE `status`
     END,
       `metadata_json` = JSON_SET(
         COALESCE(`metadata_json`, JSON_OBJECT()),
         '$.adapter.route', '/browser-runtime/inspect-site/run',
         '$.adapter.connector_path', '/browser4',
         '$.adapter.session_lifecycle', JSON_ARRAY('open', 'goto', 'snapshot_or_screenshot'),
         '$.adapter.requires_connector_upgrade', true
       )
 WHERE `runtime_key` = 'browser4_essam_v1';
