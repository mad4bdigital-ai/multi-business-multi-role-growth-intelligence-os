-- Sprint 56: Connector registry taxonomy bridge.
--
-- Adds read-only classification/bridge tables that clarify the relationship
-- between app catalog entries, provider capability groups, endpoint contracts,
-- tool exports, and connected system inventory.
--
-- Runtime code does not depend on these tables yet. They are governance and
-- diagnostics surfaces for the next cleanup phase.

CREATE TABLE IF NOT EXISTS `connector_family_registry` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `connector_family` VARCHAR(128) NOT NULL,
  `provider_family` VARCHAR(128) NULL,
  `display_name` VARCHAR(160) NULL,
  `protocol_type` ENUM('rest_api','mcp','webhook','local_device','native_runtime','resolver','transport_executor','unknown') NOT NULL DEFAULT 'unknown',
  `provider_domain_mode` ENUM('fixed_domain','target_resolved','tenant_domain','local_device','same_service','mixed','unknown') NOT NULL DEFAULT 'unknown',
  `connection_scope` ENUM('platform','tenant','user','brand','device','mixed') NOT NULL DEFAULT 'mixed',
  `runtime_layer` ENUM('provider_http','mcp','local_connector','native_runtime','resolver','transport_executor','unknown') NOT NULL DEFAULT 'unknown',
  `default_auth_mode` VARCHAR(128) NULL,
  `status` ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  `source` VARCHAR(64) NOT NULL DEFAULT 'migration_061',
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_connector_family_registry_family` (`connector_family`),
  KEY `idx_connector_family_registry_provider` (`provider_family`),
  KEY `idx_connector_family_registry_protocol` (`protocol_type`),
  KEY `idx_connector_family_registry_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_integration_action_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `binding_id` VARCHAR(36) NOT NULL,
  `app_key` VARCHAR(64) NOT NULL,
  `action_key` VARCHAR(128) NOT NULL,
  `binding_role` ENUM('primary_api','secondary_api','mcp_api','oauth_provider','webhook','transport','resolver','native_controller','canary','unknown') NOT NULL DEFAULT 'primary_api',
  `credential_source` ENUM('user_connection','tenant_connection','platform_managed','target_resolved','none','mixed') NOT NULL DEFAULT 'mixed',
  `exposure_default` ENUM('not_exported','curated_exports','manual_tools','runtime_only') NOT NULL DEFAULT 'runtime_only',
  `status` ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_app_action_binding_id` (`binding_id`),
  UNIQUE KEY `uq_app_action_binding` (`app_key`, `action_key`, `binding_role`),
  KEY `idx_app_action_binding_app` (`app_key`),
  KEY `idx_app_action_binding_action` (`action_key`),
  KEY `idx_app_action_binding_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `connector_family_registry`
  (`connector_family`, `provider_family`, `display_name`, `protocol_type`, `provider_domain_mode`, `connection_scope`, `runtime_layer`, `default_auth_mode`, `status`, `source`, `notes`)
VALUES
  ('github_com_connector', 'github_com_connector', 'GitHub REST connector', 'rest_api', 'fixed_domain', 'mixed', 'provider_http', 'github_app_or_bearer_token', 'active', 'migration_061', 'GitHub API capability groups such as contents, git data, and actions status'),
  ('www_googleapis_com_connector', 'www_googleapis_com_connector', 'Google Drive REST connector', 'rest_api', 'fixed_domain', 'mixed', 'provider_http', 'google_oauth2_or_service_account', 'active', 'migration_061', 'Google Drive and Google workspace file surfaces'),
  ('docs_googleapis_com_connector', 'docs_googleapis_com_connector', 'Google Docs REST connector', 'rest_api', 'fixed_domain', 'mixed', 'provider_http', 'google_oauth2_or_service_account', 'active', 'migration_061', 'Google Docs read and export surfaces'),
  ('sheets_googleapis_com_connector', 'sheets_googleapis_com_connector', 'Google Sheets REST connector', 'rest_api', 'fixed_domain', 'mixed', 'provider_http', 'google_oauth2_or_service_account', 'active', 'migration_061', 'Google Sheets values and bootstrap read surfaces'),
  ('analytics_googleapis_com_connector', 'analytics_googleapis_com_connector', 'Google Analytics connector', 'rest_api', 'fixed_domain', 'user', 'provider_http', 'google_oauth2', 'active', 'migration_061', 'Analytics Admin and Data API action families'),
  ('analyticsdata_googleapis_com_connector', 'analyticsdata_googleapis_com_connector', 'Google Analytics Data connector', 'rest_api', 'fixed_domain', 'user', 'provider_http', 'google_oauth2', 'active', 'migration_061', 'Analytics Data provider instance family'),
  ('googleads_googleapis_com_connector', 'googleads_googleapis_com_connector', 'Google Ads REST connector', 'rest_api', 'fixed_domain', 'user', 'provider_http', 'google_ads_oauth2', 'active', 'migration_061', 'Google Ads API capability group'),
  ('searchads360_googleapis_com_connector', 'searchads360_googleapis_com_connector', 'Search Ads 360 REST connector', 'rest_api', 'fixed_domain', 'user', 'provider_http', 'google_oauth2', 'active', 'migration_061', 'Search Ads 360 capability group'),
  ('searchconsole_googleapis_com_connector', 'searchconsole_googleapis_com_connector', 'Google Search Console REST connector', 'rest_api', 'fixed_domain', 'user', 'provider_http', 'google_oauth2', 'active', 'migration_061', 'Search Console capability group'),
  ('tagmanager_googleapis_com_connector', 'tagmanager_googleapis_com_connector', 'Google Tag Manager REST connector', 'rest_api', 'fixed_domain', 'user', 'provider_http', 'google_oauth2', 'active', 'migration_061', 'Tag Manager capability group'),
  ('google_cloud_rest_connector', 'google_cloud_rest_connector', 'Google Cloud REST connector', 'rest_api', 'fixed_domain', 'platform', 'provider_http', 'managed_service_account_adc', 'active', 'migration_061', 'Managed Cloud Run and Google Cloud control surfaces'),
  ('hostinger_api_connector', 'hostinger_api_connector', 'Hostinger REST connector', 'rest_api', 'fixed_domain', 'mixed', 'provider_http', 'bearer_token', 'active', 'migration_061', 'Hostinger DNS and infrastructure API connector'),
  ('http_generic_api_connector', 'http_generic_api_connector', 'HTTP Generic API connector', 'transport_executor', 'mixed', 'mixed', 'transport_executor', 'delegated_per_target', 'active', 'migration_061', 'Platform internal HTTP executor and target resolved transport layer'),
  ('makecom_mcp_connector', 'makecom_mcp_connector', 'Make.com MCP connector', 'mcp', 'fixed_domain', 'user', 'mcp', 'bearer_token', 'active', 'migration_061', 'Make.com MCP client connector'),
  ('make_mcp', 'makecom_mcp_connector', 'Make.com MCP connected-system alias', 'mcp', 'fixed_domain', 'user', 'mcp', 'bearer_token', 'active', 'migration_061', 'Alias observed in connected_systems.connector_family'),
  ('http_client_backend', 'http_client_backend', 'Native backend runtime', 'native_runtime', 'same_service', 'platform', 'native_runtime', 'none', 'active', 'migration_061', 'Same-service native controllers and internal runtime surfaces'),
  ('wordpress', 'wordpress', 'WordPress site connector', 'rest_api', 'tenant_domain', 'brand', 'provider_http', 'basic_auth_app_password', 'active', 'migration_061', 'Brand site WordPress REST connector instances'),
  ('hosting_provider_connector', 'hosting_provider_connector', 'Hosting provider resolver', 'resolver', 'target_resolved', 'brand', 'resolver', 'delegated_per_target', 'active', 'migration_061', 'Resolver-only hosting inventory and target selection surface'),
  ('serpapi_com_connector', 'serpapi_com_connector', 'SerpApi connector', 'rest_api', 'fixed_domain', 'platform', 'provider_http', 'default_api', 'active', 'migration_061', 'SERP provider connector'),
  ('api_scraperapi_com_connector', 'api_scraperapi_com_connector', 'ScraperAPI connector', 'rest_api', 'fixed_domain', 'platform', 'provider_http', 'default_api', 'active', 'migration_061', 'Scraping provider connector'),
  ('scrape_abstractapi_com_connector', 'scrape_abstractapi_com_connector', 'AbstractAPI scraping connector', 'rest_api', 'fixed_domain', 'platform', 'provider_http', 'default_api', 'active', 'migration_061', 'Scraping provider connector'),
  ('generic', 'generic', 'Generic tenant system connector', 'unknown', 'tenant_domain', 'tenant', 'unknown', NULL, 'active', 'migration_061', 'Generic connected_systems family for tenant-specific systems')
ON DUPLICATE KEY UPDATE
  `provider_family` = VALUES(`provider_family`),
  `display_name` = VALUES(`display_name`),
  `protocol_type` = VALUES(`protocol_type`),
  `provider_domain_mode` = VALUES(`provider_domain_mode`),
  `connection_scope` = VALUES(`connection_scope`),
  `runtime_layer` = VALUES(`runtime_layer`),
  `default_auth_mode` = VALUES(`default_auth_mode`),
  `status` = VALUES(`status`),
  `source` = VALUES(`source`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `app_integration_action_bindings`
  (`binding_id`, `app_key`, `action_key`, `binding_role`, `credential_source`, `exposure_default`, `status`, `notes`)
VALUES
  ('bind_github_github_api_mcp', 'github', 'github_api_mcp', 'primary_api', 'platform_managed', 'curated_exports', 'active', 'GitHub contents REST capability currently uses GitHub App auth'),
  ('bind_github_github_git_data', 'github', 'github_git_data', 'secondary_api', 'platform_managed', 'curated_exports', 'active', 'Git data operations for branches, commits, trees, and refs'),
  ('bind_github_github_actions_status', 'github', 'github_actions_status', 'secondary_api', 'platform_managed', 'curated_exports', 'active', 'GitHub Actions status and workflow run read surfaces'),
  ('bind_github_github_api_mcp_canary', 'github', 'github_api_mcp_app_canary', 'canary', 'platform_managed', 'curated_exports', 'active', 'GitHub App canary capability group'),
  ('bind_wordpress_rest_wordpress_api', 'wordpress_rest', 'wordpress_api', 'primary_api', 'user_connection', 'runtime_only', 'active', 'WordPress REST operations use tenant or brand resolved app-password credentials'),
  ('bind_makecom_mcp_client', 'makecom_mcp', 'makecom_mcp_client', 'mcp_api', 'user_connection', 'runtime_only', 'active', 'Make.com MCP tool enumeration and call surface'),
  ('bind_google_drive_api', 'google_drive', 'google_drive_api', 'primary_api', 'mixed', 'curated_exports', 'active', 'Google Drive API supports platform and user-owned credential paths'),
  ('bind_google_docs_api', 'google_docs', 'google_docs_api', 'primary_api', 'mixed', 'curated_exports', 'active', 'Google Docs read/export surfaces'),
  ('bind_google_sheets_api', 'google_sheets', 'google_sheets_api', 'primary_api', 'mixed', 'curated_exports', 'active', 'Google Sheets values surfaces'),
  ('bind_google_analytics_data_api', 'google_analytics', 'analytics_data_api', 'primary_api', 'user_connection', 'runtime_only', 'active', 'Google Analytics Data API capability group'),
  ('bind_google_analytics_admin_api', 'google_analytics_admin', 'analytics_admin_api', 'primary_api', 'user_connection', 'runtime_only', 'active', 'Google Analytics Admin API capability group'),
  ('bind_google_ads_api', 'google_ads', 'googleads_api', 'primary_api', 'user_connection', 'runtime_only', 'active', 'Google Ads API capability group'),
  ('bind_search_ads_360_api', 'search_ads_360', 'searchads360_api', 'primary_api', 'user_connection', 'runtime_only', 'active', 'Search Ads 360 API capability group'),
  ('bind_google_search_console_api', 'google_search_console', 'searchconsole_api', 'primary_api', 'user_connection', 'runtime_only', 'active', 'Search Console API capability group'),
  ('bind_google_tag_manager_api', 'google_tag_manager', 'tagmanager_api', 'primary_api', 'user_connection', 'runtime_only', 'active', 'Tag Manager API capability group'),
  ('bind_google_cloud_gcloud_api', 'google_cloud', 'gcloud_api', 'primary_api', 'platform_managed', 'runtime_only', 'active', 'Google Cloud REST control-plane surface'),
  ('bind_hostinger_api', 'hostinger', 'hostinger_api', 'primary_api', 'mixed', 'runtime_only', 'active', 'Hostinger API capability group'),
  ('bind_custom_api_http_generic', 'api_key', 'http_generic_api', 'transport', 'mixed', 'manual_tools', 'active', 'Custom API app catalog entry maps to the generic HTTP executor')
ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `action_key` = VALUES(`action_key`),
  `binding_role` = VALUES(`binding_role`),
  `credential_source` = VALUES(`credential_source`),
  `exposure_default` = VALUES(`exposure_default`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
