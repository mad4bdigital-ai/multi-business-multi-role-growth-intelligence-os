-- Sprint 68: WordPress schema overlay contract prerequisite
-- Purpose:
--   Add the nullable endpoint relationship key consumed by the later registry
--   synchronization migration before its first ordered UPDATE target use.
-- Safety:
--   Additive, idempotent schema-only bridge for local Staging replay. No data,
--   secret, credential, token, provider, Production, or runtime operation.

ALTER TABLE `endpoints`
  ADD COLUMN IF NOT EXISTS `required_variable_contracts` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `schema_overlay_mode` VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS `schema_overlay_parent_action_key` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `provider_agnostic` VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS `allowed_actor_roles` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `allowed_governance_levels` TEXT NULL
  AFTER `schema_overlay_status`;
