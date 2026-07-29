-- Add an append-only delivery-attempt ledger and active-claim guard for governed auth email outbox sends.
-- This migration does not send email, enable the delivery feature flag, or schedule a worker.

CREATE TABLE IF NOT EXISTS `auth_email_outbox_delivery_attempts` (
  `attempt_id` varchar(64) NOT NULL,
  `email_id` varchar(64) NOT NULL,
  `attempt_number` int unsigned NOT NULL,
  `idempotency_key` varchar(191) NOT NULL,
  `recipient_email` varchar(255) NOT NULL,
  `provider` varchar(64) NOT NULL DEFAULT 'gmail_api',
  `sender_connection_id` varchar(64) DEFAULT NULL,
  `status` enum('started','sent','failed','abandoned','dead_lettered') NOT NULL DEFAULT 'started',
  `active_claim` tinyint(1) GENERATED ALWAYS AS (CASE WHEN `status` = 'started' THEN 1 ELSE NULL END) STORED,
  `provider_message_id` varchar(255) DEFAULT NULL,
  `provider_thread_id` varchar(255) DEFAULT NULL,
  `error_code` varchar(191) DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `retry_count` int unsigned NOT NULL DEFAULT 0,
  `lifecycle_event_id` varchar(64) DEFAULT NULL,
  `started_at` datetime NOT NULL DEFAULT current_timestamp(),
  `completed_at` datetime DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`attempt_id`),
  UNIQUE KEY `uq_auth_email_outbox_attempt_number` (`email_id`,`attempt_number`),
  UNIQUE KEY `uq_auth_email_outbox_attempt_idempotency` (`idempotency_key`),
  UNIQUE KEY `uq_auth_email_outbox_active_claim` (`email_id`,`active_claim`),
  KEY `idx_auth_email_outbox_attempt_status` (`status`,`started_at`),
  KEY `idx_auth_email_outbox_attempt_recipient` (`recipient_email`,`started_at`),
  KEY `idx_auth_email_outbox_attempt_provider_message` (`provider`,`provider_message_id`),
  CONSTRAINT `fk_auth_email_outbox_attempt_email`
    FOREIGN KEY (`email_id`) REFERENCES `auth_email_outbox` (`email_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
