-- Add an internal delivery-attempt ledger and governed tools.
-- Additive only. This migration does not alter the outbox status enum, call Gmail, or send email.

CREATE TABLE IF NOT EXISTS `auth_email_delivery_attempts` (
  `attempt_id` CHAR(36) NOT NULL,
  `email_id` VARCHAR(64) NOT NULL,
  `purpose` VARCHAR(80) NOT NULL,
  `recipient_email` VARCHAR(320) NOT NULL,
  `provider` VARCHAR(64) NOT NULL DEFAULT 'gmail_api',
  `status` VARCHAR(32) NOT NULL DEFAULT 'started',
  `retry_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `provider_message_id` VARCHAR(255) NULL,
  `provider_thread_id` VARCHAR(255) NULL,
  `sender_connection_id` VARCHAR(64) NULL,
  `error_code` VARCHAR(191) NULL,
  `error_message` TEXT NULL,
  `lifecycle_event_id` VARCHAR(64) NULL,
  `metadata_json` JSON NULL,
  `started_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` TIMESTAMP NULL DEFAULT NULL,
  `sent_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`attempt_id`),
  UNIQUE KEY `uq_auth_email_delivery_attempt_retry` (`email_id`, `retry_count`),
  KEY `idx_auth_email_delivery_attempt_status` (`status`, `started_at`),
  KEY `idx_auth_email_delivery_attempt_email` (`email_id`, `started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'auth_email_delivery_attempts_status',
    'Auth Email Delivery Attempts Status',
    'Read bounded delivery-attempt ledger rows without returning message bodies, provider error text, or credentials.',
    'GET',
    '/admin/support/tickets/auth-email-outbox/attempts',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'email_id',JSON_OBJECT('type','string','format','uuid'),
        'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',50)
      ),
      'additionalProperties',false
    ),
    NULL,
    'admin,support,tickets,email,outbox,delivery_attempts,read_only,readback,no_secrets',
    1,
    474
  ),
  (
    'auth_email_outbox_targeted_dry_run',
    'Auth Email Outbox Targeted Dry Run',
    'Preview one exact queued auth email by email_id without sending.',
    'POST',
    '/admin/support/tickets/auth-email-outbox/targeted-dry-run',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT('email_id',JSON_OBJECT('type','string','format','uuid')),
      'required',JSON_ARRAY('email_id'),
      'additionalProperties',false
    ),
    NULL,
    'admin,support,tickets,email,outbox,dry_run,read_only,no_delivery,no_secrets',
    1,
    475
  ),
  (
    'auth_email_outbox_targeted_apply',
    'Auth Email Outbox Targeted Apply',
    'Deliver one exact eligible queued auth email by email_id. Requires the delivery feature flag and typed confirmation.',
    'POST',
    '/admin/support/tickets/auth-email-outbox/targeted-apply',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'email_id',JSON_OBJECT('type','string','format','uuid'),
        'confirm',JSON_OBJECT('type','string','enum',JSON_ARRAY('SEND_AUTH_EMAIL_OUTBOX')),
        'sender_connection_id',JSON_OBJECT('type','string','format','uuid')
      ),
      'required',JSON_ARRAY('email_id','confirm'),
      'additionalProperties',false
    ),
    NULL,
    'admin,support,tickets,email,outbox,mutation,external_send,approval_required,readback,same_cycle_readback,no_secrets',
    1,
    476
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
