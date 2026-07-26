-- Sprint 68: Support Ticket external delivery dynamic recipient allowlist
-- Purpose: replace environment-backed live recipient allowlist checks with DB-backed,
-- tenant/provider-scoped allowlist rows. No recipients are enabled by default.
-- Safety: additive/idempotent, no secrets, no destructive statements.

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

CREATE OR REPLACE VIEW `v_external_delivery_recipient_allowlist_readiness` AS
SELECT
  `allowlist_id`,
  `tenant_id`,
  `adapter_key`,
  `channel`,
  `match_type`,
  `recipient_pattern`,
  `status`,
  CASE
    WHEN `status` <> 'active' THEN 'disabled'
    WHEN `expires_at` IS NOT NULL AND `expires_at` <= CURRENT_TIMESTAMP THEN 'expired'
    ELSE 'active'
  END AS `readiness_status`,
  `approval_hold_id`,
  `created_by`,
  `reason`,
  `expires_at`,
  0 AS `secret_value_included`,
  0 AS `secrets_included`
FROM `external_delivery_recipient_allowlist_registry`;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
) VALUES (
  'Support Ticket External Delivery Governance',
  'support_ticket_external_delivery_dynamic_recipient_allowlist_policy_v1',
  JSON_OBJECT(
    'allowlist_source', 'external_delivery_recipient_allowlist_registry',
    'environment_allowlist_forbidden', true,
    'no_default_recipients', true,
    'tenant_scoped_rows_supported', true,
    'platform_global_rows_supported', true,
    'adapter_scoped_rows_supported', true,
    'allowed_match_types', JSON_ARRAY('exact_email','domain','wildcard_domain'),
    'requires_active_row', true,
    'requires_not_expired', true,
    'forbids_secret_response', true,
    'secret_value_included', false,
    'secrets_included', false
  ),
  'TRUE',
  'support_ticket_external_delivery_live_recipient_allowlist',
  'external_delivery_recipient_allowlist_registry|supportTicketExternalLiveSendService',
  'TRUE',
  'Live Support Ticket external delivery recipient allowlist must be read dynamically from DB rows. Environment allowlists are not authoritative.'
)
ON DUPLICATE KEY UPDATE
  `policy_value`=VALUES(`policy_value`),
  `active`=VALUES(`active`),
  `execution_scope`=VALUES(`execution_scope`),
  `affects_layer`=VALUES(`affects_layer`),
  `blocking`=VALUES(`blocking`),
  `notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;
