-- Add delivery-attempt ledger for auth email outbox worker sends.
-- Additive schema migration. Does not send email or mutate existing auth_email_outbox rows.

CREATE TABLE IF NOT EXISTS auth_email_outbox_delivery_attempts (
  attempt_id CHAR(36) NOT NULL PRIMARY KEY,
  email_id CHAR(36) NOT NULL,
  attempt_number INT NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  provider VARCHAR(80) NOT NULL DEFAULT 'gmail_api',
  status ENUM('started','sent','failed','abandoned','dead_lettered') NOT NULL DEFAULT 'started',
  retry_count INT NOT NULL DEFAULT 0,
  sender_connection_id CHAR(36) NULL,
  provider_message_id VARCHAR(255) NULL,
  provider_thread_id VARCHAR(255) NULL,
  error_code VARCHAR(191) NULL,
  error_message TEXT NULL,
  lifecycle_event_id CHAR(36) NULL,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_auth_email_attempts_idempotency (idempotency_key),
  UNIQUE KEY uq_auth_email_attempts_email_number (email_id, attempt_number),
  KEY idx_auth_email_attempts_email (email_id),
  KEY idx_auth_email_attempts_status_started (status, started_at),
  KEY idx_auth_email_attempts_recipient_created (recipient_email, created_at),
  KEY idx_auth_email_attempts_lifecycle_event (lifecycle_event_id)
);
