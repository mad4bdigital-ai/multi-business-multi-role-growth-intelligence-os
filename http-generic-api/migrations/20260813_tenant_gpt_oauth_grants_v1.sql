-- Tenant GPT OAuth grant persistence for staged refresh-token rotation.
-- This migration is intentionally additive and was NOT applied by this task.
-- Runtime issuance remains fail-closed behind TENANT_GPT_REFRESH_TOKENS_ENABLED=true.

CREATE TABLE IF NOT EXISTS `tenant_gpt_oauth_grants` (
  `grant_id` VARCHAR(64) NOT NULL,
  `access_jti` VARCHAR(128) NOT NULL,
  `refresh_token_hash` VARCHAR(64) NOT NULL,
  `client_id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `resource` VARCHAR(512) NOT NULL,
  `scopes_json` JSON NOT NULL,
  `status` ENUM('active','rotated','revoked') NOT NULL DEFAULT 'active',
  `access_expires_at` DATETIME NOT NULL,
  `refresh_expires_at` DATETIME NOT NULL,
  `replaced_by_grant_id` VARCHAR(64) NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`grant_id`),
  UNIQUE KEY `uq_tenant_gpt_oauth_grants_refresh_hash` (`refresh_token_hash`),
  KEY `idx_tenant_gpt_oauth_grants_client_status` (`client_id`, `status`, `refresh_expires_at`),
  KEY `idx_tenant_gpt_oauth_grants_subject_status` (`user_id`, `tenant_id`, `status`, `refresh_expires_at`),
  KEY `idx_tenant_gpt_oauth_grants_resource` (`resource`, `client_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
