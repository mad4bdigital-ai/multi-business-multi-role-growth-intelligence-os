-- Spec 016: operational OAuth 2.1 persistence for the remote MCP resource.
-- This migration is intentionally additive and does not enable the runtime.

CREATE TABLE IF NOT EXISTS `remote_mcp_oauth_clients` (
  `client_id` VARCHAR(128) NOT NULL,
  `client_name` VARCHAR(255) NOT NULL,
  `client_profile_key` VARCHAR(64) NOT NULL,
  `token_endpoint_auth_method` ENUM('none','client_secret_basic','client_secret_post') NOT NULL DEFAULT 'none',
  `client_secret_hash` VARCHAR(64) NULL,
  `redirect_uris_json` JSON NOT NULL,
  `allowed_scopes_json` JSON NOT NULL,
  `registration_access_token_hash` VARCHAR(64) NULL,
  `status` ENUM('active','disabled','revoked') NOT NULL DEFAULT 'active',
  `expires_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`client_id`),
  KEY `idx_remote_mcp_oauth_clients_status` (`status`, `client_profile_key`),
  KEY `idx_remote_mcp_oauth_clients_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `remote_mcp_oauth_authorization_codes` (
  `code_hash` VARCHAR(64) NOT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NULL,
  `redirect_uri` VARCHAR(2048) NOT NULL,
  `resource` VARCHAR(2048) NOT NULL,
  `scopes_json` JSON NOT NULL,
  `code_challenge` VARCHAR(128) NOT NULL,
  `code_challenge_method` ENUM('S256') NOT NULL,
  `status` ENUM('issued','consumed','expired','revoked') NOT NULL DEFAULT 'issued',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`code_hash`),
  KEY `idx_remote_mcp_oauth_codes_client_status` (`client_id`, `status`, `expires_at`),
  KEY `idx_remote_mcp_oauth_codes_user` (`user_id`, `created_at`),
  CONSTRAINT `fk_remote_mcp_oauth_codes_client`
    FOREIGN KEY (`client_id`) REFERENCES `remote_mcp_oauth_clients` (`client_id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `remote_mcp_oauth_grants` (
  `grant_id` CHAR(36) NOT NULL,
  `access_jti` VARCHAR(64) NOT NULL,
  `refresh_token_hash` VARCHAR(64) NOT NULL,
  `client_id` VARCHAR(128) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NULL,
  `resource` VARCHAR(2048) NOT NULL,
  `scopes_json` JSON NOT NULL,
  `status` ENUM('active','revoked','expired','rotated') NOT NULL DEFAULT 'active',
  `access_expires_at` DATETIME NOT NULL,
  `refresh_expires_at` DATETIME NOT NULL,
  `replaced_by_grant_id` CHAR(36) NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`grant_id`),
  UNIQUE KEY `uq_remote_mcp_oauth_grants_access_jti` (`access_jti`),
  UNIQUE KEY `uq_remote_mcp_oauth_grants_refresh_hash` (`refresh_token_hash`),
  KEY `idx_remote_mcp_oauth_grants_client_status` (`client_id`, `status`, `refresh_expires_at`),
  KEY `idx_remote_mcp_oauth_grants_user_status` (`user_id`, `status`, `refresh_expires_at`),
  CONSTRAINT `fk_remote_mcp_oauth_grants_client`
    FOREIGN KEY (`client_id`) REFERENCES `remote_mcp_oauth_clients` (`client_id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
