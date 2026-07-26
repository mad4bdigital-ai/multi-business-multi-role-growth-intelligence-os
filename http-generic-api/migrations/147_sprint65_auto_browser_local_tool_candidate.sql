-- Sprint 65: Auto Browser local tool candidate metadata
-- Adds a connector status proxy and metadata for the Auto Browser visual takeover
-- provider. This does not enable visual takeover execution; actions beyond status
-- remain blocked until adapter PoC and same-cycle smoke validation.

UPDATE `browser_runtime_registry`
   SET `public_url` = 'https://github.com/LvcidPsyche/auto-browser',
       `status` = 'activation_pending_adapter_poc',
       `metadata_json` = '{"source_url":"https://github.com/LvcidPsyche/auto-browser","use_case":"visual_takeover","install_required":true,"provider_summary":"MCP-native browser control plane for authorized workflows with shared Playwright browser, human takeover, reusable auth profiles, approvals, audit trails, and local-first deployment.","activation_phase":"local_tool_candidate_status_probe","activation_gates":["local_tool_manifest_release","connector_auto_browser_status","adapter_route","explicit_approval_flow","same_cycle_smoke"],"local_connector":{"path":"/auto-browser","validated_actions":["status"],"blocked_until_poc":["visual_takeover","click","type","auth_profile_reuse","destructive_actions"],"env":{"CONNECTOR_AUTO_BROWSER_ENABLED":"false","AUTO_BROWSER_BASE_URL":"http://127.0.0.1:8000","AUTO_BROWSER_HEALTH_PATH":"/health","AUTO_BROWSER_ALLOWED_HOSTS":"mad4b.com,n8n.mad4b.com"}},"governance":{"domain_allowlist_required":true,"audit_required":true,"no_credential_logging":true,"no_cookie_token_echo":true,"no_payment_or_checkout_submit":true,"explicit_approval_required":true,"artifact_redaction_required":true},"review_status":"candidate_status_probe_added_pending_install_plan"}'
 WHERE `runtime_key` = 'auto_browser_essam_v1';

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `tags`, `is_enabled`, `sort_order`)
VALUES (
  'connector_auto_browser',
  'Connector Auto Browser Status',
  'Admin-only connector proxy for the Auto Browser local tool candidate. Only action=status is supported until adapter PoC is validated.',
  'POST',
  '/connector/{device_id}/auto-browser',
  '["device_id"]',
  '{"type":"object","required":["device_id","action"],"properties":{"device_id":{"type":"string"},"action":{"type":"string","enum":["status"]},"timeout_ms":{"type":"integer"}}}',
  'device,auto-browser,browser-runtime,visual-takeover,read_only,diagnostics,no_secrets,admin_only,candidate_only,adapter_pending',
  1,
  153
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
