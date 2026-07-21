-- Durable, single-use OAuth authorization-code state for Tenant GPT.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS `tenant_gpt_oauth_authorization_codes` (
  `code_jti_hash` CHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NULL,
  `client_id` VARCHAR(191) NOT NULL,
  `redirect_uri_hash` CHAR(64) NOT NULL,
  `status` ENUM('issued','consumed','expired','revoked') NOT NULL DEFAULT 'issued',
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`code_jti_hash`),
  KEY `idx_tenant_gpt_oauth_codes_status_expiry` (`status`, `expires_at`),
  KEY `idx_tenant_gpt_oauth_codes_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
