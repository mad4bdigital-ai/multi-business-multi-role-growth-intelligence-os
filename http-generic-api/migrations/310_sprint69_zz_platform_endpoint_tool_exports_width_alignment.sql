-- Staging-local additive compatibility bridge for immutable migration 311 and later endpoint writers.
-- endpoint_key is VARCHAR(255) and the governed export prefix adds 16 characters.
-- Preserve the complete export/tool domain before every INSERT...SELECT writer.
-- No data DML, provider access, credential access, or runtime mutation; secrets_included=false.

ALTER TABLE IF EXISTS `platform_endpoint_tool_exports`
  MODIFY COLUMN `export_key` VARCHAR(271) NOT NULL,
  MODIFY COLUMN `tool_name` VARCHAR(271) NOT NULL;
