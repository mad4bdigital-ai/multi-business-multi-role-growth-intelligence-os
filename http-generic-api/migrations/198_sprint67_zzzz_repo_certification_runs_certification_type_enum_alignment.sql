-- Sprint 67: align certification-type enum before the path-scope certification writer.
-- Additive schema-only bridge; preserve all existing enum values and rows.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

ALTER TABLE repo_certification_runs
  MODIFY COLUMN certification_type ENUM(
    'manifest',
    'eval',
    'security',
    'sandbox',
    'license',
    'supply_chain',
    'provider',
    'path_scope'
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
