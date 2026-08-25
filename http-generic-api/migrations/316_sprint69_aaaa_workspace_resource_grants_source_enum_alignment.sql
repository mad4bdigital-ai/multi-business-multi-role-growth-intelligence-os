-- Sprint 69: align the workspace grant source enum before the safe-branch backfill writer.
-- Additive schema-only bridge; preserve all existing enum values and rows.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

ALTER TABLE workspace_resource_grants
  MODIFY COLUMN source ENUM(
    'membership_default',
    'invitation_accept',
    'access_request_approval',
    'owner_assignment',
    'admin_repair',
    'system_sync',
    'workspace_registry_membership_backfill'
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL DEFAULT 'owner_assignment';
