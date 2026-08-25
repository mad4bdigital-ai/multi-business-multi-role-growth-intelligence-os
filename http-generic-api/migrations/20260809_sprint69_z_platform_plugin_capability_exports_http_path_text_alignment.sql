-- Staging-local safety alignment: preserve endpoint path/function descriptors
-- before the immutable 20260810 semantic shadow projection.
-- Additive DDL only; no provider calls, credentials, runtime dispatch, or data export.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false
ALTER TABLE `platform_plugin_capability_exports`
  MODIFY COLUMN `http_path` TEXT NULL;
