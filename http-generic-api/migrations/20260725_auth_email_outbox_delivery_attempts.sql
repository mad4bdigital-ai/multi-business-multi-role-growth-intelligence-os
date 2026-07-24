-- Add delivery-attempt ledger for auth email outbox worker sends.
-- Additive schema migration. Does not send email or mutate existing auth_email_outbox rows.

CREATE TABLE IF NOT EXISTS auth_email_outbox_delivery_attempts (
  attempt_id CHAR(36) NOT NULL PRIMARY KEY,
  email_id CHAR(36) NOT NULL,
  purpose VARCHAR(120) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  ticket_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  event_type VARCHAR(120) NULL,
  attempt_status ENUM('started','sent','failed','skipped') NOT NULL DEFAULT 'started',
  provider VARCHAR(80) NULL,
  provider_message_id VARCHAR(255) NULL,
  provider_thread_id VARCHAR(255) NULL,
  sender_connection_id CHAR(36) NULL,
  sender_account_label VARCHAR(255) NULL,
  error_code VARCHAR(255) NULL,
  error_message TEXT NULL,
  metadata_json JSON NULL,
  external_send_performed TINYINT(1) NOT NULL DEFAULT 0,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  KEY idx_auth_email_attempts_email (email_id),
  KEY idx_auth_email_attempts_ticket (ticket_id),
  KEY idx_auth_email_attempts_status_created (attempt_status, created_at),
  KEY idx_auth_email_attempts_recipient_created (recipient_email, created_at)
);
