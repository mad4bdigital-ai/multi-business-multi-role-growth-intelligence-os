-- Repository-owned Local Manager control-template registry.
-- Runtime request paths are read-only; schema and seed convergence are migration-owned.
CREATE TABLE IF NOT EXISTS `local_manager_control_templates` (
  `template_id` VARCHAR(128) NOT NULL,
  `template_type` ENUM('capability','app','helper') NOT NULL,
  `template_key` VARCHAR(128) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `env_flag` VARCHAR(128) NULL,
  `process_name` VARCHAR(191) NULL,
  `browser` TINYINT(1) NOT NULL DEFAULT 0,
  `capability_class` VARCHAR(128) NULL,
  `risk_class` VARCHAR(64) NOT NULL DEFAULT 'interactive',
  `metadata_json` JSON NULL,
  `sort_order` INT NOT NULL DEFAULT 1000,
  `status` ENUM('active','disabled','deprecated') NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`template_id`),
  UNIQUE KEY `uq_local_manager_control_template` (`template_type`, `template_key`),
  KEY `idx_local_manager_control_status` (`status`, `template_type`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `local_manager_control_templates`
  (`template_id`, `template_type`, `template_key`, `label`, `env_flag`, `process_name`, `browser`, `capability_class`, `risk_class`, `metadata_json`, `sort_order`, `status`)
VALUES
  ('local-manager-capability-powershell_admin', 'capability', 'powershell_admin', 'Admin PowerShell recovery', 'CONNECTOR_POWERSHELL_ENABLED', NULL, 0, NULL, 'high', '{"note":"Break-glass recovery only. Enables governed /ps proxy after local elevated reinstall.","surface_type":"helper_tool","execution_location":"local_device","integration_type":"capability","credential_scope":"device","requires_credentials":false}', 10, 'active'),
  ('local-manager-capability-windows_control', 'capability', 'windows_control', 'Windows app/process control', 'CONNECTOR_WIN_ENABLED', NULL, 0, NULL, 'high', '{"note":"Break-glass/desktop-control only. Enables governed /win proxy after local elevated reinstall.","surface_type":"desktop_control","execution_location":"local_device","integration_type":"capability","credential_scope":"device","requires_credentials":false}', 20, 'active'),
  ('local-manager-capability-hermes_agent_surface', 'capability', 'hermes_agent_surface', 'Hermes Agent Surface', 'CONNECTOR_HERMES_AGENT_SURFACE_ENABLED', NULL, 0, NULL, 'interactive', '{"note":"Enables governed local Hermes agent surface controls when tenant policy grants it.","surface_type":"agent_surface","execution_location":"local_device","integration_type":"capability","credential_scope":"tenant","requires_credentials":false}', 30, 'active'),
  ('local-manager-capability-auto_browser', 'capability', 'auto_browser', 'Auto Browser', 'CONNECTOR_AUTO_BROWSER_ENABLED', NULL, 0, NULL, 'interactive', '{"note":"Enables governed automated browser surface controls when tenant policy grants it.","surface_type":"automation_surface","execution_location":"platform_managed","integration_type":"capability","credential_scope":"tenant","requires_credentials":false}', 40, 'active'),
  ('local-manager-app-managed_n8n_client', 'app', 'managed_n8n_client', 'Managed n8n Client', NULL, 'n8n', 0, 'workflow_runtime', 'managed', '{"app_manager_scope":"managed_mad4b_service_side","current_hosting_target":"essam_local_device","future_hosting_target":"vps","managed_by":"mad4b","tenant_installs_local_service":false,"note":"Mad4B-managed n8n client. Currently may run on Essam local device during bootstrap; target hosting is VPS/platform service side.","surface_type":"workflow_runtime","execution_location":"mad4b_service_side","integration_type":"managed_service_client","credential_scope":"tenant","requires_credentials":false}', 50, 'active'),
  ('local-manager-app-tenant_dedicated_n8n', 'app', 'tenant_dedicated_n8n', 'Dedicated tenant n8n', NULL, 'n8n', 0, 'workflow_runtime', 'interactive', '{"app_manager_scope":"tenant_local_device_side","managed_by":"tenant","tenant_installs_local_service":true,"writes_local_files":true,"note":"Tenant-dedicated n8n installation that is installed and run on the tenant local device.","surface_type":"workflow_runtime","execution_location":"tenant_local_device","integration_type":"tenant_local_service","credential_scope":"tenant","requires_credentials":false}', 60, 'active'),
  ('local-manager-app-edge', 'app', 'edge', 'Microsoft Edge', NULL, 'msedge', 1, 'browser', 'interactive', '{"app_manager_scope":"tenant_local_device_side","surface_type":"browser_runtime","execution_location":"local_device","integration_type":"local_app","credential_scope":"none","requires_credentials":false}', 100, 'active'),
  ('local-manager-app-chrome', 'app', 'chrome', 'Google Chrome', NULL, 'chrome', 1, 'browser', 'interactive', '{"surface_type":"browser_runtime","execution_location":"local_device","integration_type":"local_app","credential_scope":"none","requires_credentials":false}', 110, 'active'),
  ('local-manager-app-firefox', 'app', 'firefox', 'Mozilla Firefox', NULL, 'firefox', 1, 'browser', 'interactive', '{"surface_type":"browser_runtime","execution_location":"local_device","integration_type":"local_app","credential_scope":"none","requires_credentials":false}', 112, 'active'),
  ('local-manager-app-brave', 'app', 'brave', 'Brave Browser', NULL, 'brave', 1, 'browser', 'interactive', '{"surface_type":"browser_runtime","execution_location":"local_device","integration_type":"local_app","credential_scope":"none","requires_credentials":false}', 114, 'active'),
  ('local-manager-app-opera', 'app', 'opera', 'Opera', NULL, 'opera', 1, 'browser', 'interactive', '{"surface_type":"browser_runtime","execution_location":"local_device","integration_type":"local_app","credential_scope":"none","requires_credentials":false}', 116, 'active'),
  ('local-manager-app-chromium', 'app', 'chromium', 'Chromium', NULL, 'chromium', 1, 'browser', 'interactive', '{"surface_type":"browser_runtime","execution_location":"local_device","integration_type":"local_app","credential_scope":"none","requires_credentials":false}', 118, 'active'),
  ('local-manager-app-browserbase', 'app', 'browserbase', 'Browserbase', NULL, 'browserbase', 1, 'browser_provider', 'external', '{"requires_credentials":true,"surface_type":"browser_runtime","execution_location":"external_cloud","integration_type":"external_provider","credential_scope":"tenant"}', 121, 'active'),
  ('local-manager-app-browserless', 'app', 'browserless', 'Browserless', NULL, 'browserless', 1, 'browser_provider', 'external', '{"requires_credentials":true,"surface_type":"browser_runtime","execution_location":"external_cloud","integration_type":"external_provider","credential_scope":"tenant"}', 122, 'active'),
  ('local-manager-app-steel_browser', 'app', 'steel_browser', 'Steel Browser', NULL, 'steel', 1, 'browser_provider', 'external', '{"requires_credentials":true,"surface_type":"browser_runtime","execution_location":"external_cloud","integration_type":"external_provider","credential_scope":"tenant"}', 123, 'active'),
  ('local-manager-capability-playwright_adapter', 'capability', 'playwright_adapter', 'Playwright Adapter', 'CONNECTOR_PLAYWRIGHT_ENABLED', NULL, 0, NULL, 'interactive', '{"note":"Governed browser automation adapter; requires local runtime installation and tenant consent.","surface_type":"browser_adapter","execution_location":"local_device","integration_type":"plugin_adapter","credential_scope":"device","requires_credentials":false}', 124, 'active'),
  ('local-manager-capability-puppeteer_adapter', 'capability', 'puppeteer_adapter', 'Puppeteer Adapter', 'CONNECTOR_PUPPETEER_ENABLED', NULL, 0, NULL, 'interactive', '{"note":"Governed browser automation adapter; requires local runtime installation and tenant consent.","surface_type":"browser_adapter","execution_location":"local_device","integration_type":"plugin_adapter","credential_scope":"device","requires_credentials":false}', 125, 'active'),
  ('local-manager-capability-selenium_adapter', 'capability', 'selenium_adapter', 'Selenium Adapter', 'CONNECTOR_SELENIUM_ENABLED', NULL, 0, NULL, 'interactive', '{"note":"Governed browser automation adapter; requires local runtime installation and tenant consent.","surface_type":"browser_adapter","execution_location":"local_device","integration_type":"plugin_adapter","credential_scope":"device","requires_credentials":false}', 126, 'active'),
  ('local-manager-app-vscode', 'app', 'vscode', 'Visual Studio Code', NULL, 'Code', 0, 'developer_tool', 'interactive', '{"surface_type":"desktop_app","execution_location":"local_device","integration_type":"local_app","credential_scope":"none","requires_credentials":false}', 130, 'active'),
  ('local-manager-app-cursor', 'app', 'cursor', 'Cursor', NULL, 'Cursor', 0, 'developer_tool', 'interactive', '{"surface_type":"developer_tool","execution_location":"local_device","integration_type":"local_app","credential_scope":"device","requires_credentials":false}', 130, 'active'),
  ('local-manager-app-open_claude', 'app', 'open_claude', 'Open Claude', NULL, 'Claude', 0, 'agent_surface', 'interactive', '{"aliases":["open_cloude"],"surface_type":"agent_surface","execution_location":"local_device","integration_type":"local_app","credential_scope":"device","requires_credentials":false}', 140, 'active'),
  ('local-manager-app-open_claw', 'app', 'open_claw', 'Open Claw', NULL, 'OpenClaw', 0, 'agent_surface', 'interactive', '{"aliases":["open_claw","open_claude_claw"],"surface_type":"agent_surface","execution_location":"local_device","integration_type":"local_app","credential_scope":"device","requires_credentials":false}', 150, 'active'),
  ('local-manager-app-notepad', 'app', 'notepad', 'Windows Notepad', NULL, 'notepad', 0, 'desktop_app', 'low', '{"surface_type":"desktop_app","execution_location":"local_device","integration_type":"local_app","credential_scope":"device","requires_credentials":false}', 900, 'active'),
  ('local-manager-app-git_bash', 'app', 'git_bash', 'Git Bash', NULL, 'git-bash', 0, 'developer_tool', 'interactive', '{"surface_type":"developer_tool","execution_location":"local_device","integration_type":"local_app","credential_scope":"device","requires_credentials":false}', 910, 'active')
ON DUPLICATE KEY UPDATE
  `label` = VALUES(`label`),
  `env_flag` = VALUES(`env_flag`),
  `process_name` = VALUES(`process_name`),
  `browser` = VALUES(`browser`),
  `capability_class` = VALUES(`capability_class`),
  `risk_class` = VALUES(`risk_class`),
  `metadata_json` = VALUES(`metadata_json`),
  `sort_order` = VALUES(`sort_order`),
  `status` = VALUES(`status`),
  `updated_at` = CURRENT_TIMESTAMP;
