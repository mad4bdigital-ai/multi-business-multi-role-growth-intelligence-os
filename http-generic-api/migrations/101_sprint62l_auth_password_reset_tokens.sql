-- Sprint 62l: password reset support for platform auth surfaces
-- Token hashes are stored; raw reset tokens are only used to compose queued email content.

CREATE TABLE IF NOT EXISTS `auth_password_reset_tokens` (
  `reset_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `status` ENUM('pending','used','expired','revoked') NOT NULL DEFAULT 'pending',
  `requested_ip` VARCHAR(64) NULL,
  `requested_user_agent` VARCHAR(255) NULL,
  `expires_at` DATETIME NOT NULL,
  `used_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`reset_id`),
  UNIQUE KEY `uq_auth_password_reset_token_hash` (`token_hash`),
  KEY `idx_auth_password_reset_email_status` (`email`, `status`, `expires_at`),
  KEY `idx_auth_password_reset_user_status` (`user_id`, `status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `auth_email_outbox` (
  `email_id` VARCHAR(64) NOT NULL,
  `purpose` VARCHAR(64) NOT NULL,
  `recipient_email` VARCHAR(255) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `body_text` TEXT NOT NULL,
  `body_html` MEDIUMTEXT NULL,
  `status` ENUM('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
  `provider` VARCHAR(64) NULL,
  `provider_message_id` VARCHAR(255) NULL,
  `metadata_json` JSON NULL,
  `last_error` TEXT NULL,
  `sent_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`email_id`),
  KEY `idx_auth_email_outbox_status` (`status`, `purpose`, `created_at`),
  KEY `idx_auth_email_outbox_recipient` (`recipient_email`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
