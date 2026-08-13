-- Tenant GPT SSO session lifecycle storage.
-- Additive only; this migration is intentionally not applied by this remediation.
CREATE TABLE IF NOT EXISTS `tenant_gpt_sso_sessions` (
  `sid` VARCHAR(128) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL,
  `client_id` VARCHAR(191) NOT NULL,
  `scopes_json` JSON NOT NULL,
  `status` ENUM('active','revoked','expired') NOT NULL DEFAULT 'active',
  `issued_at` DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sid`),
  KEY `idx_tenant_gpt_sso_user_status` (`user_id`,`status`),
  KEY `idx_tenant_gpt_sso_expiry` (`status`,`expires_at`),
  CONSTRAINT `fk_tenant_gpt_sso_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_tenant_gpt_sso_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Enable only after this table exists and readiness checks pass:
-- TENANT_GPT_SSO_SESSION_STORE_ENABLED=true
