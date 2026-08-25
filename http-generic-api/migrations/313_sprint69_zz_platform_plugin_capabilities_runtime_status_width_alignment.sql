-- Staging-local additive width alignment for the immutable migration 314 capability backfill.
-- The source view can expose runtime certification statuses up to VARCHAR(256).
-- No data DML, provider access, credential access, or runtime mutation; secrets_included=false.

ALTER TABLE `platform_plugin_capabilities`
  MODIFY COLUMN `runtime_status` VARCHAR(256) NOT NULL;
