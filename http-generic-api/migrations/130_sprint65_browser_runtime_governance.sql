-- Sprint 65: Browser Runtime Registry + extraction/inspection governance foundation.
-- No browser runtime is installed by this migration. It creates registry/policy/audit
-- surfaces and seeds the current Essam connector plus planned runtimes.

CREATE TABLE IF NOT EXISTS `browser_runtime_registry` (
  `runtime_key` VARCHAR(128) NOT NULL,
  `provider` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `device_id` VARCHAR(128) NULL,
  `capability_class` VARCHAR(128) NOT NULL,
  `capabilities_json` JSON NULL,
  `degraded_capabilities_json` JSON NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'planned',
  `endpoint_url` VARCHAR(1024) NULL,
  `public_url` VARCHAR(1024) NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`runtime_key`),
  KEY `idx_browser_runtime_provider` (`provider`),
  KEY `idx_browser_runtime_status` (`status`),
  KEY `idx_browser_runtime_device` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_capabilities` (
  `capability_id` CHAR(36) NOT NULL,
  `runtime_key` VARCHAR(128) NOT NULL,
  `capability_key` VARCHAR(128) NOT NULL,
  `capability_group` VARCHAR(128) NULL,
  `risk_level` VARCHAR(40) NOT NULL DEFAULT 'medium',
  `requires_approval` TINYINT(1) NOT NULL DEFAULT 0,
  `policy_json` JSON NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`capability_id`),
  UNIQUE KEY `uniq_browser_runtime_capability` (`runtime_key`, `capability_key`),
  CONSTRAINT `fk_browser_runtime_capability_runtime`
    FOREIGN KEY (`runtime_key`) REFERENCES `browser_runtime_registry` (`runtime_key`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_bindings` (
  `binding_key` VARCHAR(128) NOT NULL,
  `runtime_key` VARCHAR(128) NOT NULL,
  `use_case` VARCHAR(128) NOT NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `allowed_brands_json` JSON NULL,
  `allowed_actions_json` JSON NULL,
  `domain_allowlist_json` JSON NULL,
  `policy_json` JSON NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`binding_key`),
  KEY `idx_browser_runtime_binding_runtime` (`runtime_key`),
  KEY `idx_browser_runtime_binding_use_case` (`use_case`),
  KEY `idx_browser_runtime_binding_tenant` (`tenant_id`),
  CONSTRAINT `fk_browser_runtime_binding_runtime`
    FOREIGN KEY (`runtime_key`) REFERENCES `browser_runtime_registry` (`runtime_key`)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_policy` (
  `policy_key` VARCHAR(128) NOT NULL,
  `runtime_key` VARCHAR(128) NULL,
  `binding_key` VARCHAR(128) NULL,
  `tenant_id` CHAR(36) NULL,
  `brand_key` VARCHAR(128) NULL,
  `domain_allowlist_json` JSON NULL,
  `policy_json` JSON NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`policy_key`),
  KEY `idx_browser_runtime_policy_runtime` (`runtime_key`),
  KEY `idx_browser_runtime_policy_binding` (`binding_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_sessions` (
  `session_id` CHAR(36) NOT NULL,
  `runtime_key` VARCHAR(128) NOT NULL,
  `binding_key` VARCHAR(128) NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `url_host` VARCHAR(255) NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'created',
  `expires_at` DATETIME NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`),
  KEY `idx_browser_runtime_session_runtime` (`runtime_key`),
  KEY `idx_browser_runtime_session_binding` (`binding_key`),
  KEY `idx_browser_runtime_session_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_events` (
  `event_id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NULL,
  `runtime_key` VARCHAR(128) NULL,
  `binding_key` VARCHAR(128) NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `event_type` VARCHAR(80) NOT NULL,
  `url_host` VARCHAR(255) NULL,
  `actor` VARCHAR(128) NULL,
  `policy_result` VARCHAR(40) NULL,
  `event_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  KEY `idx_browser_runtime_event_runtime` (`runtime_key`),
  KEY `idx_browser_runtime_event_binding` (`binding_key`),
  KEY `idx_browser_runtime_event_type` (`event_type`),
  KEY `idx_browser_runtime_event_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_runtime_artifacts` (
  `artifact_id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NULL,
  `runtime_key` VARCHAR(128) NULL,
  `binding_key` VARCHAR(128) NULL,
  `artifact_type` VARCHAR(80) NOT NULL,
  `storage_ref` VARCHAR(1024) NULL,
  `redaction_status` VARCHAR(40) NOT NULL DEFAULT 'redacted_or_not_sensitive',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`artifact_id`),
  KEY `idx_browser_runtime_artifact_runtime` (`runtime_key`),
  KEY `idx_browser_runtime_artifact_session` (`session_id`)
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
  `status` VARCHAR(80) NOT NULL DEFAULT 'policy_allowed_pending_runtime',
  `result_json` JSON NULL,
  `error_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`job_key`),
  KEY `idx_browser_extract_binding` (`binding_key`),
  KEY `idx_browser_extract_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `browser_site_inspection_runs` (
  `inspection_key` VARCHAR(128) NOT NULL,
  `binding_key` VARCHAR(128) NOT NULL,
  `tenant_id` CHAR(36) NULL,
  `user_id` CHAR(36) NULL,
  `target_url` VARCHAR(2048) NOT NULL,
  `checks_json` JSON NULL,
  `policy_json` JSON NULL,
  `status` VARCHAR(80) NOT NULL DEFAULT 'policy_allowed_pending_runtime',
  `result_json` JSON NULL,
  `error_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`inspection_key`),
  KEY `idx_browser_inspect_binding` (`binding_key`),
  KEY `idx_browser_inspect_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `browser_runtime_registry`
  (`runtime_key`, `provider`, `display_name`, `device_id`, `capability_class`, `capabilities_json`, `degraded_capabilities_json`, `status`, `metadata_json`)
VALUES
  ('native_essam_edge_connector_v1', 'windows_connector_browser', 'Essam Native Edge Connector', 'essam-pc', 'native_desktop_browser',
   JSON_ARRAY('open_url', 'launch_browser', 'basic_screenshot_attempt'),
   JSON_ARRAY('visual_screenshot', 'remote_human_takeover', 'inspect_data_extraction'),
   'active_open_url_degraded_visual_capture',
   JSON_OBJECT('browser_alias', 'edge', 'public_url_tested', 'https://n8n.mad4b.com/', 'notes', 'open_url succeeded, but screenshot returned blank/white; use only for URL launch and basic checks.')),
  ('browser4_essam_v1', 'browser4', 'Browser4 Essam Extraction/Inspect Runtime', 'essam-pc', 'structured_local_extraction',
   JSON_ARRAY('extract_data', 'inspect_site', 'dom_snapshot', 'network', 'console', 'screenshot'), JSON_ARRAY(), 'planned',
   JSON_OBJECT('use_case', 'extraction_inspect', 'install_required', true)),
  ('auto_browser_essam_v1', 'auto_browser', 'Auto Browser Essam Visual Takeover Runtime', 'essam-pc', 'visual_takeover',
   JSON_ARRAY('visual_takeover', 'novnc', 'open_url', 'screenshot', 'human_supervision'), JSON_ARRAY(), 'planned',
   JSON_OBJECT('use_case', 'visual_takeover', 'install_required', true)),
  ('vessel_browser_essam_v1', 'vessel_browser', 'Vessel Browser Essam Persistent Session Runtime', 'essam-pc', 'persistent_agent_session',
   JSON_ARRAY('persistent_session', 'mcp', 'authenticated_profile', 'human_visible_ui'), JSON_ARRAY(), 'planned',
   JSON_OBJECT('use_case', 'persistent_authenticated_session', 'install_required', true)),
  ('oxylabs_browser_agent_v1', 'oxylabs_browser_agent', 'Oxylabs Browser Agent Cloud Extraction Runtime', NULL, 'cloud_public_extraction',
   JSON_ARRAY('cloud_extraction', 'public_scraping', 'multi_step_browsing', 'screenshot'), JSON_ARRAY(), 'planned',
   JSON_OBJECT('use_case', 'cloud_public_extraction', 'credential_intake_required', true))
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
  ('native_essam_open_url', 'native_essam_edge_connector_v1', 'local_user_visible_open_url',
   JSON_ARRAY('open_url'), JSON_ARRAY('mad4b.com', 'n8n.mad4b.com'),
   JSON_OBJECT('domain_allowlist_required', true, 'audit_required', true, 'no_destructive_actions', true, 'no_cookie_token_echo', true), 'active'),
  ('browser4_extraction_essam', 'browser4_essam_v1', 'structured_local_extraction',
   JSON_ARRAY('extract_data', 'inspect_site'), JSON_ARRAY('mad4b.com', 'n8n.mad4b.com'),
   JSON_OBJECT('domain_allowlist_required', true, 'audit_required', true, 'pii_redaction', true, 'no_login_without_profile', true), 'planned'),
  ('browser4_inspect_essam', 'browser4_essam_v1', 'site_diagnostics',
   JSON_ARRAY('inspect_site'), JSON_ARRAY('mad4b.com', 'n8n.mad4b.com'),
   JSON_OBJECT('domain_allowlist_required', true, 'audit_required', true, 'redact_cookies', true, 'redact_tokens', true, 'no_form_submit', true), 'planned'),
  ('auto_browser_takeover_essam', 'auto_browser_essam_v1', 'visual_takeover',
   JSON_ARRAY('visual_takeover', 'open_url', 'screenshot'), JSON_ARRAY('mad4b.com', 'n8n.mad4b.com'),
   JSON_OBJECT('requires_approval', true, 'domain_allowlist_required', true, 'audit_required', true, 'human_takeover_approval', true), 'planned'),
  ('vessel_persistent_essam', 'vessel_browser_essam_v1', 'persistent_authenticated_session',
   JSON_ARRAY('persistent_session', 'open_url', 'inspect_site', 'extract_data'), JSON_ARRAY('mad4b.com', 'n8n.mad4b.com'),
   JSON_OBJECT('session_reuse_approval_required', true, 'domain_allowlist_required', true, 'audit_required', true, 'session_expiry_required', true), 'planned'),
  ('oxylabs_cloud_extraction', 'oxylabs_browser_agent_v1', 'cloud_public_extraction',
   JSON_ARRAY('extract_data', 'screenshot'), JSON_ARRAY('mad4b.com'),
   JSON_OBJECT('domain_allowlist_required', true, 'audit_required', true, 'public_data_only', true, 'credential_intake_required', true), 'planned')
ON DUPLICATE KEY UPDATE
  `runtime_key` = VALUES(`runtime_key`),
  `use_case` = VALUES(`use_case`),
  `allowed_actions_json` = VALUES(`allowed_actions_json`),
  `domain_allowlist_json` = VALUES(`domain_allowlist_json`),
  `policy_json` = VALUES(`policy_json`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('browser_runtime_list', 'Browser Runtime List', 'List governed browser runtimes. Returns registry metadata only; no browser execution and no secrets.', 'GET', '/browser-runtime/runtimes', NULL,
   '{"type":"object","properties":{"status":{"type":"string"},"provider":{"type":"string"},"capability_class":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":250}}}', NULL, 'admin,browser-runtime,read_only,diagnostics,no_secrets', 1, 140),
  ('browser_runtime_get', 'Browser Runtime Get', 'Read one governed browser runtime by runtime_key. No secrets are returned.', 'GET', '/browser-runtime/runtimes/{runtime_key}', '["runtime_key"]',
   '{"type":"object","required":["runtime_key"],"properties":{"runtime_key":{"type":"string"}}}', NULL, 'admin,browser-runtime,read_only,diagnostics,no_secrets', 1, 141),
  ('browser_runtime_health', 'Browser Runtime Health', 'Read registry-level browser runtime health and capability classification. Does not launch a browser.', 'POST', '/browser-runtime/health', NULL,
   '{"type":"object","properties":{"runtime_key":{"type":"string"},"binding_key":{"type":"string"}}}', NULL, 'admin,browser-runtime,read_only,diagnostics,no_secrets', 1, 142),
  ('browser_runtime_binding_upsert', 'Browser Runtime Binding Upsert', 'Create or update a browser runtime binding with domain allowlist and policy. Rejects secret-like fields.', 'POST', '/browser-runtime/bindings', NULL,
   '{"type":"object","required":["binding_key","runtime_key","use_case"],"properties":{"binding_key":{"type":"string"},"runtime_key":{"type":"string"},"use_case":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"allowed_brands":{"type":"array","items":{"type":"string"}},"allowed_actions":{"type":"array","items":{"type":"string"}},"domain_allowlist":{"type":"array","items":{"type":"string"}},"policy":{"type":"object"},"status":{"type":"string"}}}', NULL, 'admin,browser-runtime,state_changing,audited,no_secrets', 1, 143),
  ('browser_runtime_policy_check', 'Browser Runtime Policy Check', 'Run browser policy preflight for a URL/action/binding. Blocks unallowlisted domains and risky actions before execution.', 'POST', '/browser-runtime/policy-check', NULL,
   '{"type":"object","required":["url"],"properties":{"binding_key":{"type":"string"},"runtime_key":{"type":"string"},"url":{"type":"string"},"target_url":{"type":"string"},"action":{"type":"string"},"use_case":{"type":"string"},"explicit_approval":{"type":"boolean"},"session_reuse_approved":{"type":"boolean"},"policy":{"type":"object"}}}', NULL, 'admin,browser-runtime,policy,read_only,diagnostics,no_secrets', 1, 144),
  ('browser_runtime_extract_data', 'Browser Runtime Extract Data', 'Create a governed browser data extraction job after policy preflight. Runtime execution remains pending until a runtime adapter is installed.', 'POST', '/browser-runtime/extract-data', NULL,
   '{"type":"object","required":["binding_key","target_url"],"properties":{"job_key":{"type":"string"},"binding_key":{"type":"string"},"target_url":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"extraction_mode":{"type":"string"},"schema":{"type":"object"},"policy":{"type":"object"}}}', NULL, 'admin,browser-runtime,extraction,state_changing,audited,no_secrets', 1, 145),
  ('browser_runtime_inspect_site', 'Browser Runtime Inspect Site', 'Create a governed site inspection run after policy preflight. Runtime execution remains pending until a runtime adapter is installed.', 'POST', '/browser-runtime/inspect-site', NULL,
   '{"type":"object","required":["binding_key","url"],"properties":{"inspection_key":{"type":"string"},"binding_key":{"type":"string"},"url":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"checks":{"type":"array","items":{"type":"string"}},"policy":{"type":"object"}}}', NULL, 'admin,browser-runtime,inspection,state_changing,audited,no_secrets', 1, 146)
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
