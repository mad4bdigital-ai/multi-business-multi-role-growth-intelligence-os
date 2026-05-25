-- Sprint 65: Browser Runtime Layer registry, inspection/extraction governance, and admin tools.
-- This migration intentionally registers governance surfaces only. It does not install
-- Browser4, Auto Browser, Vessel, Oxylabs, or any new browser runtime executable.

CREATE TABLE IF NOT EXISTS `browser_runtime_registry` (
  `runtime_key` VARCHAR(128) NOT NULL,
  `provider` VARCHAR(80) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `device_id` VARCHAR(128) NULL,
  `capability_class` VARCHAR(80) NOT NULL,
  `capabilities_json` JSON NULL,
  `degraded_capabilities_json` JSON NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'planned',
  `endpoint_url` VARCHAR(512) NULL,
  `public_url` VARCHAR(512) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`runtime_key`),
  KEY `idx_browser_runtime_provider` (`provider`),
  KEY `idx_browser_runtime_status` (`status`),
  KEY `idx_browser_runtime_device` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_bindings` (
  `binding_key` VARCHAR(128) NOT NULL,
  `runtime_key` VARCHAR(128) NOT NULL,
  `use_case` VARCHAR(80) NOT NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `allowed_brands_json` JSON NULL,
  `allowed_actions_json` JSON NULL,
  `domain_allowlist_json` JSON NULL,
  `policy_json` JSON NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`binding_key`),
  KEY `idx_browser_binding_runtime` (`runtime_key`),
  KEY `idx_browser_binding_use_case` (`use_case`),
  KEY `idx_browser_binding_tenant` (`tenant_id`),
  KEY `idx_browser_binding_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_capabilities` (
  `runtime_key` VARCHAR(128) NOT NULL,
  `capability_key` VARCHAR(128) NOT NULL,
  `capability_class` VARCHAR(80) NOT NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'active',
  `risk_level` VARCHAR(40) NOT NULL DEFAULT 'medium',
  `requires_approval` TINYINT(1) NOT NULL DEFAULT 0,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`runtime_key`, `capability_key`),
  KEY `idx_browser_capability_key` (`capability_key`),
  KEY `idx_browser_capability_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_policy` (
  `policy_key` VARCHAR(128) NOT NULL,
  `runtime_key` VARCHAR(128) NULL,
  `binding_key` VARCHAR(128) NULL,
  `policy_json` JSON NOT NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`policy_key`),
  KEY `idx_browser_policy_runtime` (`runtime_key`),
  KEY `idx_browser_policy_binding` (`binding_key`),
  KEY `idx_browser_policy_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_sessions` (
  `session_id` CHAR(36) NOT NULL,
  `runtime_key` VARCHAR(128) NOT NULL,
  `binding_key` VARCHAR(128) NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `url_host` VARCHAR(255) NULL,
  `session_status` VARCHAR(80) NOT NULL DEFAULT 'created',
  `expires_at` DATETIME NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`),
  KEY `idx_browser_session_runtime` (`runtime_key`),
  KEY `idx_browser_session_binding` (`binding_key`),
  KEY `idx_browser_session_status` (`session_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_events` (
  `event_id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NULL,
  `runtime_key` VARCHAR(128) NOT NULL,
  `binding_key` VARCHAR(128) NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `url_host` VARCHAR(255) NULL,
  `policy_result` VARCHAR(40) NOT NULL DEFAULT 'unknown',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  KEY `idx_browser_event_runtime` (`runtime_key`),
  KEY `idx_browser_event_session` (`session_id`),
  KEY `idx_browser_event_type` (`event_type`),
  KEY `idx_browser_event_policy` (`policy_result`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_artifacts` (
  `artifact_id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NULL,
  `runtime_key` VARCHAR(128) NOT NULL,
  `binding_key` VARCHAR(128) NULL,
  `artifact_type` VARCHAR(80) NOT NULL,
  `artifact_url` VARCHAR(1024) NULL,
  `redaction_status` VARCHAR(80) NOT NULL DEFAULT 'redaction_required',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`artifact_id`),
  KEY `idx_browser_artifact_runtime` (`runtime_key`),
  KEY `idx_browser_artifact_session` (`session_id`),
  KEY `idx_browser_artifact_type` (`artifact_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_data_extraction_jobs` (
  `job_key` VARCHAR(128) NOT NULL,
  `binding_key` VARCHAR(128) NOT NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `target_url` VARCHAR(2048) NOT NULL,
  `extraction_mode` VARCHAR(80) NOT NULL DEFAULT 'schema_based',
  `schema_json` JSON NULL,
  `policy_json` JSON NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'draft',
  `result_json` JSON NULL,
  `error_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`job_key`),
  KEY `idx_browser_extract_binding` (`binding_key`),
  KEY `idx_browser_extract_status` (`status`),
  KEY `idx_browser_extract_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_site_inspection_runs` (
  `inspection_key` VARCHAR(128) NOT NULL,
  `binding_key` VARCHAR(128) NOT NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `target_url` VARCHAR(2048) NOT NULL,
  `checks_json` JSON NULL,
  `policy_json` JSON NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'draft',
  `result_json` JSON NULL,
  `error_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`inspection_key`),
  KEY `idx_browser_inspect_binding` (`binding_key`),
  KEY `idx_browser_inspect_status` (`status`),
  KEY `idx_browser_inspect_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `browser_runtime_registry`
  (`runtime_key`, `provider`, `display_name`, `device_id`, `capability_class`, `capabilities_json`, `degraded_capabilities_json`, `status`, `metadata_json`)
VALUES
  ('native_essam_edge_connector_v1', 'windows_connector_browser', 'Essam Native Edge Connector', 'essam-pc', 'native_desktop_browser', '["open_url","launch_browser","basic_screenshot_attempt"]', '["visual_screenshot","remote_human_takeover","inspect_data_extraction"]', 'active_open_url_degraded_visual_capture', '{"browser_alias":"edge","public_url_tested":"https://n8n.mad4b.com/","notes":"open_url succeeded, screenshot returned blank/white because the connector service cannot reliably capture the interactive Windows desktop session.","use_only_for":["open_url","local_browser_presence_check"],"do_not_use_for":["visual_takeover","primary_inspect","primary_data_extraction"]}'),
  ('browser4_essam_v1', 'browser4', 'Browser4 Essam Extraction/Inspect Runtime', 'essam-pc', 'structured_local_extraction', '["extract_data","inspect_site","dom_snapshot","network","console","screenshot"]', '[]', 'planned', '{"use_case":"extraction_inspect","install_required":true}'),
  ('auto_browser_essam_v1', 'auto_browser', 'Auto Browser Essam Visual Takeover Runtime', 'essam-pc', 'visual_takeover', '["visual_takeover","novnc","open_url","screenshot","human_supervision"]', '[]', 'planned', '{"use_case":"visual_takeover","install_required":true}'),
  ('vessel_browser_essam_v1', 'vessel_browser', 'Vessel Browser Essam Persistent Session Runtime', 'essam-pc', 'persistent_agent_session', '["persistent_session","mcp","authenticated_profile","human_visible_ui"]', '[]', 'planned', '{"use_case":"persistent_authenticated_session","install_required":true}'),
  ('oxylabs_browser_agent_v1', 'oxylabs_browser_agent', 'Oxylabs Browser Agent Cloud Extraction Runtime', NULL, 'cloud_public_extraction', '["cloud_extraction","public_scraping","multi_step_browsing","screenshot"]', '[]', 'planned', '{"use_case":"cloud_public_extraction","credential_intake_required":true}')
ON DUPLICATE KEY UPDATE
  `provider` = VALUES(`provider`),
  `display_name` = VALUES(`display_name`),
  `device_id` = VALUES(`device_id`),
  `capability_class` = VALUES(`capability_class`),
  `capabilities_json` = VALUES(`capabilities_json`),
  `degraded_capabilities_json` = VALUES(`degraded_capabilities_json`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `browser_runtime_bindings`
  (`binding_key`, `runtime_key`, `use_case`, `allowed_actions_json`, `domain_allowlist_json`, `policy_json`, `status`)
VALUES
  ('native_essam_open_url', 'native_essam_edge_connector_v1', 'local_user_visible_open_url', '["open_url"]', '["mad4b.com","n8n.mad4b.com"]', '{"domain_allowlist_required":true,"audit_required":true,"no_credential_logging":true,"no_cookie_token_echo":true,"no_destructive_actions":true,"no_form_submit":true,"screenshot_artifact_redaction":true,"decision":"Use only for opening URLs and local browser presence checks because screenshot capture is degraded."}', 'active'),
  ('browser4_extraction_essam', 'browser4_essam_v1', 'structured_local_extraction', '["extract_data","inspect_site","capture_screenshot","get_page_metadata"]', '["mad4b.com","n8n.mad4b.com"]', '{"domain_allowlist_required":true,"audit_required":true,"no_credential_logging":true,"no_cookie_token_echo":true,"no_destructive_actions":true,"no_form_submit":true,"pii_redaction":true,"status":"planned_runtime_only"}', 'planned'),
  ('auto_browser_takeover_essam', 'auto_browser_essam_v1', 'visual_takeover', '["open_url","visual_takeover","capture_screenshot"]', '["mad4b.com","n8n.mad4b.com"]', '{"domain_allowlist_required":true,"audit_required":true,"requires_human_takeover_approval":true,"no_credential_logging":true,"no_cookie_token_echo":true,"no_destructive_actions":true,"no_form_submit":true,"session_expiry_required":true,"status":"planned_runtime_only"}', 'planned'),
  ('vessel_browser_persistent_essam', 'vessel_browser_essam_v1', 'persistent_authenticated_session', '["create_session","open_url","inspect_site","extract_data"]', '["mad4b.com","n8n.mad4b.com"]', '{"domain_allowlist_required":true,"audit_required":true,"explicit_approval_required_for_login_reuse":true,"session_expiry_required":true,"no_credential_logging":true,"no_cookie_token_echo":true,"no_destructive_actions":true,"status":"planned_runtime_only"}', 'planned'),
  ('oxylabs_public_extraction', 'oxylabs_browser_agent_v1', 'cloud_public_extraction', '["extract_data","inspect_site","capture_screenshot"]', '[]', '{"domain_allowlist_required":true,"audit_required":true,"credential_intake_required":true,"no_credential_logging":true,"no_cookie_token_echo":true,"no_destructive_actions":true,"pii_redaction":true,"status":"planned_runtime_only"}', 'planned')
ON DUPLICATE KEY UPDATE
  `runtime_key` = VALUES(`runtime_key`),
  `use_case` = VALUES(`use_case`),
  `allowed_actions_json` = VALUES(`allowed_actions_json`),
  `domain_allowlist_json` = VALUES(`domain_allowlist_json`),
  `policy_json` = VALUES(`policy_json`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `browser_runtime_policy`
  (`policy_key`, `policy_json`, `status`)
VALUES
  ('browser_runtime_default_policy_v1', '{"domain_allowlist_required":true,"tenant_brand_scoping_required":true,"no_credential_logging":true,"no_cookie_token_echo":true,"no_payment_submit":true,"no_destructive_actions":true,"explicit_approval_for_login_session_reuse":true,"screenshot_artifact_redaction":true,"session_expiry_required":true,"audit_required":true}', 'active')
ON DUPLICATE KEY UPDATE
  `policy_json` = VALUES(`policy_json`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `browser_runtime_capabilities`
  (`runtime_key`, `capability_key`, `capability_class`, `status`, `risk_level`, `requires_approval`, `metadata_json`)
VALUES
  ('native_essam_edge_connector_v1', 'open_url', 'native_desktop_browser', 'active', 'low', 0, '{"degraded_visual_capture":true}'),
  ('native_essam_edge_connector_v1', 'basic_screenshot_attempt', 'native_desktop_browser', 'degraded', 'medium', 0, '{"observed_result":"blank_white_frame"}'),
  ('browser4_essam_v1', 'extract_data', 'structured_local_extraction', 'planned', 'medium', 0, '{"runtime_install_required":true}'),
  ('browser4_essam_v1', 'inspect_site', 'structured_local_extraction', 'planned', 'medium', 0, '{"runtime_install_required":true}'),
  ('auto_browser_essam_v1', 'visual_takeover', 'visual_takeover', 'planned', 'high', 1, '{"runtime_install_required":true,"human_approval_required":true}'),
  ('vessel_browser_essam_v1', 'persistent_session', 'persistent_agent_session', 'planned', 'high', 1, '{"runtime_install_required":true,"session_reuse_approval_required":true}'),
  ('oxylabs_browser_agent_v1', 'cloud_extraction', 'cloud_public_extraction', 'planned', 'medium', 0, '{"credential_intake_required":true}')
ON DUPLICATE KEY UPDATE
  `capability_class` = VALUES(`capability_class`),
  `status` = VALUES(`status`),
  `risk_level` = VALUES(`risk_level`),
  `requires_approval` = VALUES(`requires_approval`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('browser_runtime_list', 'Browser Runtime List', 'List governed browser runtimes and their current status. Returns no secrets and does not execute a browser.', 'GET', '/browser-runtime/runtimes', NULL, '{"type":"object","properties":{"status":{"type":"string"},"provider":{"type":"string"},"capability_class":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250}}}', NULL, 'admin,browser_runtime,read_only,diagnostics,no_secrets', 1, 140),
  ('browser_runtime_get', 'Browser Runtime Get', 'Read one governed browser runtime by runtime_key. Returns no secrets and does not execute a browser.', 'GET', '/browser-runtime/runtimes/{runtime_key}', '["runtime_key"]', '{"type":"object","required":["runtime_key"],"properties":{"runtime_key":{"type":"string"}}}', NULL, 'admin,browser_runtime,read_only,diagnostics,no_secrets', 1, 141),
  ('browser_runtime_health', 'Browser Runtime Health', 'Read registry-level browser runtime health and degraded capability classification. Does not execute the runtime adapter.', 'POST', '/browser-runtime/health', NULL, '{"type":"object","properties":{"runtime_key":{"type":"string"},"binding_key":{"type":"string"}}}', NULL, 'admin,browser_runtime,diagnostics,no_secrets,policy_first', 1, 142),
  ('browser_runtime_binding_upsert', 'Browser Runtime Binding Upsert', 'Create or update a governed browser runtime binding. Secret-like payload keys and values are rejected.', 'POST', '/browser-runtime/bindings', NULL, '{"type":"object","required":["binding_key","runtime_key","use_case"],"properties":{"binding_key":{"type":"string"},"runtime_key":{"type":"string"},"use_case":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"allowed_brands":{"type":"array","items":{"type":"string"}},"allowed_actions":{"type":"array","items":{"type":"string"}},"domain_allowlist":{"type":"array","items":{"type":"string"}},"policy":{"type":"object"},"status":{"type":"string"}}}', NULL, 'admin,browser_runtime,state_changing,audited,no_secrets,policy_first', 1, 143),
  ('browser_runtime_policy_check', 'Browser Runtime Policy Check', 'Run browser runtime policy preflight for a URL/action before any browser execution. Blocks unallowlisted domains and risky actions.', 'POST', '/browser-runtime/policy-check', NULL, '{"type":"object","required":["url"],"properties":{"binding_key":{"type":"string"},"runtime_key":{"type":"string"},"url":{"type":"string"},"target_url":{"type":"string"},"action":{"type":"string"},"use_case":{"type":"string"},"explicit_approval":{"type":"boolean"},"session_reuse_approved":{"type":"boolean"},"policy":{"type":"object"}}}', NULL, 'admin,browser_runtime,policy,read_only,no_secrets,preflight', 1, 144),
  ('browser_runtime_extract_data', 'Browser Runtime Extract Data', 'Create a governed browser data extraction job after policy preflight. This foundation route records policy-allowed pending runtime work only.', 'POST', '/browser-runtime/extract-data', NULL, '{"type":"object","required":["binding_key","target_url"],"properties":{"job_key":{"type":"string"},"binding_key":{"type":"string"},"target_url":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"extraction_mode":{"type":"string"},"schema":{"type":"object"},"policy":{"type":"object"}}}', NULL, 'admin,browser_runtime,extraction,state_changing,audited,no_secrets,policy_first', 1, 145),
  ('browser_runtime_inspect_site', 'Browser Runtime Inspect Site', 'Create a governed browser site inspection run after policy preflight. This foundation route records policy-allowed pending runtime work only.', 'POST', '/browser-runtime/inspect-site', NULL, '{"type":"object","required":["binding_key","url"],"properties":{"inspection_key":{"type":"string"},"binding_key":{"type":"string"},"url":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"checks":{"type":"array","items":{"type":"string"}},"policy":{"type":"object"}}}', NULL, 'admin,browser_runtime,site_inspection,state_changing,audited,no_secrets,policy_first', 1, 146)
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
