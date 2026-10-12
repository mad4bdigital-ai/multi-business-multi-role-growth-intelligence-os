-- Staging Activation Registry Schema Reconciliation
-- Purpose: restore the eight Activation registry tables required by hard activation.
-- Scope: schema only; no seed/backfill rows are written by this migration.
-- Source authority:
--   20260611_activation_dynamic_tabs.sql
--   20260611_activation_dynamic_tabs_autodiscovery.sql
--   20260611_activation_operational_intelligence.sql
-- Safety:
--   additive CREATE TABLE IF NOT EXISTS only
--   no DROP/TRUNCATE/DELETE/UPDATE/GRANT
--   no Production-specific mutation

CREATE TABLE IF NOT EXISTS activation_dynamic_tab_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tab_key VARCHAR(160) NOT NULL UNIQUE,
  display_name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  tab_group ENUM('overview','access','operations','automation','knowledge','tasks','integrations','custom') NOT NULL DEFAULT 'custom',
  container_scope ENUM('platform','tenant','workspace','brand','user','connector','agent','mixed') NOT NULL DEFAULT 'workspace',
  default_visibility ENUM('admin_only','owner_and_admin','tenant_members','user_private','subject_scoped') NOT NULL DEFAULT 'subject_scoped',
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_dynamic_tab_group (tab_group, status),
  INDEX idx_activation_dynamic_tab_scope (container_scope, status),
  INDEX idx_activation_dynamic_tab_priority (priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_dynamic_tab_section_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  section_key VARCHAR(180) NOT NULL UNIQUE,
  tab_key VARCHAR(160) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  source_table VARCHAR(160) NOT NULL,
  result_columns_json JSON NOT NULL,
  tenant_column VARCHAR(128) NULL,
  user_column VARCHAR(128) NULL,
  workspace_column VARCHAR(128) NULL,
  brand_key_column VARCHAR(128) NULL,
  system_id_column VARCHAR(128) NULL,
  status_column VARCHAR(128) NULL,
  active_status_values_json JSON NULL,
  row_limit INT UNSIGNED NOT NULL DEFAULT 25,
  aggregation_mode ENUM('rows','count','summary') NOT NULL DEFAULT 'rows',
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_tab_section_tab (tab_key, status),
  INDEX idx_activation_tab_section_source (source_table, status),
  INDEX idx_activation_tab_section_priority (priority_order),
  CONSTRAINT fk_activation_tab_section_tab FOREIGN KEY (tab_key) REFERENCES activation_dynamic_tab_registry(tab_key) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_dynamic_tab_discovery_rule_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_key VARCHAR(180) NOT NULL UNIQUE,
  target_tab_key VARCHAR(160) NOT NULL,
  surface_key_like VARCHAR(180) NULL,
  source_table_like VARCHAR(180) NULL,
  provider_family_like VARCHAR(180) NULL,
  display_name VARCHAR(200) NULL,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_tab_discovery_tab (target_tab_key, status),
  INDEX idx_activation_tab_discovery_priority (priority_order),
  CONSTRAINT fk_activation_tab_discovery_tab FOREIGN KEY (target_tab_key) REFERENCES activation_dynamic_tab_registry(tab_key) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_section_action_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  action_ref_key VARCHAR(180) NOT NULL UNIQUE,
  tab_key VARCHAR(160) NULL,
  section_key_like VARCHAR(180) NULL,
  provider_family VARCHAR(128) NULL,
  connector_family VARCHAR(128) NULL,
  source_table_like VARCHAR(180) NULL,
  runtime_action_key VARCHAR(255) NULL,
  endpoint_selector VARCHAR(255) NULL,
  label VARCHAR(220) NOT NULL,
  action_mode ENUM('read_only','advisory','draft_only','write_requires_confirmation','background_requires_native','blocked') NOT NULL DEFAULT 'read_only',
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  required_capability_key VARCHAR(180) NULL,
  fallback_prompt_template_key VARCHAR(180) NULL,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_section_action_tab (tab_key, status),
  INDEX idx_activation_section_action_provider (provider_family, connector_family, status),
  INDEX idx_activation_section_action_priority (priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_attention_rule_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rule_key VARCHAR(180) NOT NULL UNIQUE,
  display_name VARCHAR(220) NOT NULL,
  source_tab_key VARCHAR(160) NULL,
  source_section_key_like VARCHAR(180) NULL,
  source_table_like VARCHAR(180) NULL,
  provider_family VARCHAR(128) NULL,
  signal_field VARCHAR(128) NULL,
  signal_value_like VARCHAR(180) NULL,
  severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  reason_code VARCHAR(180) NOT NULL,
  recommended_action_key VARCHAR(255) NULL,
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_attention_source (source_tab_key, status),
  INDEX idx_activation_attention_provider (provider_family, status),
  INDEX idx_activation_attention_priority (priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_freshness_policy_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  policy_key VARCHAR(180) NOT NULL UNIQUE,
  surface_key_like VARCHAR(180) NULL,
  source_table_like VARCHAR(180) NULL,
  provider_family VARCHAR(128) NULL,
  connector_family VARCHAR(128) NULL,
  freshness_sla_seconds INT UNSIGNED NOT NULL DEFAULT 900,
  refresh_mode ENUM('platform_native','chatgpt_app_conversation','manual_prompt','webhook','polling','mixed') NOT NULL DEFAULT 'mixed',
  stale_severity ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_freshness_policy_provider (provider_family, connector_family, status),
  INDEX idx_activation_freshness_policy_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_signal_subscription_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  subscription_key VARCHAR(180) NOT NULL UNIQUE,
  provider_family VARCHAR(128) NOT NULL,
  connector_family VARCHAR(128) NULL,
  signal_type VARCHAR(180) NOT NULL,
  source_mode ENUM('webhook','polling','platform_event','chatgpt_conversation','manual_prompt','mixed') NOT NULL DEFAULT 'mixed',
  webhook_supported TINYINT(1) NOT NULL DEFAULT 0,
  polling_supported TINYINT(1) NOT NULL DEFAULT 1,
  min_poll_interval_seconds INT UNSIGNED NOT NULL DEFAULT 900,
  required_scope_json JSON NULL,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_signal_provider (provider_family, connector_family, status),
  INDEX idx_activation_signal_type (signal_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_connector_pack_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  pack_key VARCHAR(180) NOT NULL UNIQUE,
  provider_family VARCHAR(128) NOT NULL,
  connector_family VARCHAR(128) NULL,
  display_name VARCHAR(220) NOT NULL,
  description TEXT NULL,
  pack_category ENUM('cms','email','calendar','files','crm','ads','commerce','payments','devops','team_ops','analytics','custom') NOT NULL DEFAULT 'custom',
  default_scope_class ENUM('platform','tenant','user','brand','workspace','mixed') NOT NULL DEFAULT 'mixed',
  webhook_supported TINYINT(1) NOT NULL DEFAULT 0,
  polling_supported TINYINT(1) NOT NULL DEFAULT 1,
  chatgpt_app_fallback_supported TINYINT(1) NOT NULL DEFAULT 0,
  manual_fallback_supported TINYINT(1) NOT NULL DEFAULT 1,
  required_scopes_json JSON NULL,
  pack_status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_pack_provider (provider_family, connector_family, pack_status),
  INDEX idx_activation_pack_category (pack_category, pack_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
