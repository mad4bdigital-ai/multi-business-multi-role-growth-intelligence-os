-- Staging/runtime action registry contract reconciliation.
--
-- The runtime reads these governance/OAuth metadata columns directly from
-- `actions`, but older local Staging databases can predate the columns even
-- when later application code is present. Keep the repair additive and
-- idempotent so canonical schema replay converges without destructive reset.
--
-- Safety: schema-only; no data copy, secret value, provider call, Production
-- mutation, user/grant mutation, DROP, or broad authority change.

ALTER TABLE `actions`
  ADD COLUMN IF NOT EXISTS `allowed_actor_roles` TEXT NULL AFTER `team_allowed`,
  ADD COLUMN IF NOT EXISTS `allowed_governance_levels` TEXT NULL AFTER `allowed_actor_roles`,
  ADD COLUMN IF NOT EXISTS `oauth_secret_storage_type` VARCHAR(100) NULL AFTER `oauth_client_secret_ref`,
  ADD COLUMN IF NOT EXISTS `oauth_last_validated_at` DATETIME NULL AFTER `oauth_binding_status`;
