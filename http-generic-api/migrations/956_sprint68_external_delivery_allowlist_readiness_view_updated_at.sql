-- Sprint 68: External delivery allowlist readiness view updated_at fix
-- Purpose: include created_at and updated_at in v_external_delivery_recipient_allowlist_readiness so
-- the admin control overview can sort dynamic allowlist rows without relying on base tables.
-- Safety: view-only, no secrets, no data mutation.

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
  `created_at`,
  `updated_at`,
  0 AS `secret_value_included`,
  0 AS `secrets_included`
FROM `external_delivery_recipient_allowlist_registry`;
