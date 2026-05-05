-- Sprint 19: Authentication Credentials
CREATE TABLE IF NOT EXISTS `user_credentials` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(36) NOT NULL,
  `auth_provider` ENUM('platform', 'google') NOT NULL,
  `provider_id` VARCHAR(255) NULL,
  `password_hash` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_provider` (`user_id`, `auth_provider`),
  KEY `idx_provider_id` (`auth_provider`, `provider_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
