-- Staging-local safety alignment: preserve the historical repository-link actor
-- descriptor before the immutable 20260721 seed writer.
-- Additive DDL only; no provider calls, credentials, runtime dispatch, or data export.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
ALTER TABLE `workspace_app_links`
  MODIFY COLUMN `linked_by` VARCHAR(128) NULL;
