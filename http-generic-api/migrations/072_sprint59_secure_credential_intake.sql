-- Sprint 59: Secure credential intake sessions.
--
-- Adds short-lived, single-use credential intake sessions used to collect API
-- keys, bearer tokens, MCP credentials, webhook secrets, basic-auth passwords,
-- custom headers, and client-credentials secrets through a no-store web page.
--
-- Secrets are never stored in this table. Only the hashed one-time token and
-- non-secret session metadata are stored here. Submitted credentials are stored
-- encrypted in user_app_connections.

CREATE TABLE IF NOT EXISTS `credential_intake_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(36) NOT NULL,
  `app_key` VARCHAR(64) NOT NULL,
  `auth_type` ENUM('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','custom_headers','client_credentials') NOT NULL,
  `display_label` VARCHAR(128) NULL,
  `mcp_endpoint` VARCHAR(512) NULL,
  `webhook_url` VARCHAR(512) NULL,
  `api_base_url` VARCHAR(512) NULL,
  `workspace_id` VARCHAR(36) NULL,
  `credential_schema_json` JSON NULL,
  `metadata_json` JSON NULL,
  `status` ENUM('pending','used','expired','revoked','error') NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `connection_id` VARCHAR(36) NULL,
  `created_by` VARCHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_credential_intake_session_id` (`session_id`),
  UNIQUE KEY `uq_credential_intake_token_hash` (`token_hash`),
  KEY `idx_credential_intake_user` (`user_id`, `tenant_id`),
  KEY `idx_credential_intake_app` (`app_key`, `auth_type`),
  KEY `idx_credential_intake_status` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `user_app_connections`
  MODIFY `auth_type` ENUM('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','custom_headers','client_credentials') NOT NULL;
