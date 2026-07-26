-- Sprint 69: credential intake binding, redirect policy, and authority snapshot.
-- Additive only. Existing sessions remain valid as legacy sessions until expiry.

ALTER TABLE `app_integrations`
  ADD COLUMN IF NOT EXISTS `credential_intake_redirect_allowlist_json` JSON NULL
    AFTER `default_action_grants`;

ALTER TABLE `credential_intake_sessions`
  ADD COLUMN IF NOT EXISTS `connection_target_ref` VARCHAR(255) NULL AFTER `workspace_id`,
  ADD COLUMN IF NOT EXISTS `purpose` VARCHAR(160) NULL AFTER `connection_target_ref`,
  ADD COLUMN IF NOT EXISTS `allowed_redirect_uri` VARCHAR(1024) NULL AFTER `purpose`,
  ADD COLUMN IF NOT EXISTS `binding_digest` CHAR(64) NULL AFTER `allowed_redirect_uri`,
  ADD COLUMN IF NOT EXISTS `authority_snapshot_hash` CHAR(64) NULL AFTER `binding_digest`,
  ADD COLUMN IF NOT EXISTS `authority_snapshot_version` VARCHAR(64) NULL AFTER `authority_snapshot_hash`,
  ADD COLUMN IF NOT EXISTS `revoked_reason` VARCHAR(128) NULL AFTER `authority_snapshot_version`;

CREATE INDEX IF NOT EXISTS `idx_credential_intake_binding`
  ON `credential_intake_sessions` (`tenant_id`, `app_key`, `binding_digest`);

CREATE INDEX IF NOT EXISTS `idx_credential_intake_target_status`
  ON `credential_intake_sessions` (`connection_target_ref`, `status`, `expires_at`);
