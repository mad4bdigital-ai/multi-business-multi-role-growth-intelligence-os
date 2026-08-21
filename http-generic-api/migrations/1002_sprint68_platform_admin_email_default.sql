-- Sprint 68: official platform admin mailbox for Support Ticket external delivery.
-- This is additive: it defines defaults and allowlist readiness, but live_send remains gated by approval,
-- credential_ref, idempotency, adapter dispatch flags, and provider policies.
-- The migration is self-contained because lexicographic replay orders 1002 before 909.

CREATE TABLE IF NOT EXISTS `external_delivery_recipient_allowlist_registry` (
  `allowlist_id` VARCHAR(36) NOT NULL,
  `tenant_id` VARCHAR(64) NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  `adapter_key` VARCHAR(160) NOT NULL DEFAULT '*',
  `channel` VARCHAR(64) NOT NULL DEFAULT 'email',
  `match_type` VARCHAR(32) NOT NULL DEFAULT 'exact_email',
  `recipient_pattern` VARCHAR(320) NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `approval_hold_id` VARCHAR(64) NULL,
  `created_by` VARCHAR(128) NULL,
  `reason` VARCHAR(512) NULL,
  `expires_at` DATETIME NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`allowlist_id`),
  UNIQUE KEY `uq_external_delivery_allowlist_scope_pattern` (`tenant_id`, `adapter_key`, `channel`, `match_type`, `recipient_pattern`),
  KEY `idx_external_delivery_allowlist_lookup` (`tenant_id`, `adapter_key`, `channel`, `status`, `expires_at`),
  KEY `idx_external_delivery_allowlist_status` (`status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note, created_at, updated_at)
VALUES
  ('support_ticket.platform_admin_email',
   JSON_OBJECT('email','info@mad4b.com','role','platform_admin_notifications','direction','receive_and_send_admin_notifications','adapter_key','hostinger_smtp_adapter','channel','email','secrets_included',false),
   'active',
   'Official platform admin mailbox for Support Ticket admin notifications.',
   CURRENT_TIMESTAMP,
   CURRENT_TIMESTAMP),
  ('external_delivery.platform_admin_email',
   JSON_OBJECT('email','info@mad4b.com','role','platform_admin_notifications','direction','receive_and_send_admin_notifications','adapter_key','hostinger_smtp_adapter','channel','email','secrets_included',false),
   'active',
   'Official external delivery admin mailbox for provider-gated admin notifications.',
   CURRENT_TIMESTAMP,
   CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO external_delivery_recipient_allowlist_registry
  (allowlist_id, tenant_id, adapter_key, channel, match_type, recipient_pattern, status, approval_hold_id, reason, expires_at, created_by, created_at, updated_at)
VALUES
  (UUID(), '00000000-0000-0000-0000-000000000000', 'hostinger_smtp_adapter', 'email', 'exact_email', 'info@mad4b.com', 'active', NULL,
   'Official platform admin mailbox for Support Ticket admin notifications. Live sends remain gated.', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 90 DAY), 'migration_1002_platform_admin_email_default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  status = 'active',
  reason = VALUES(reason),
  expires_at = GREATEST(COALESCE(expires_at, VALUES(expires_at)), VALUES(expires_at)),
  updated_at = CURRENT_TIMESTAMP;
