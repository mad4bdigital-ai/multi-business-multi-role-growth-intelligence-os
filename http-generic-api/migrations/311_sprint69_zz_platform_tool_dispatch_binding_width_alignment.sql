-- Staging-local additive compatibility bridge for later dispatch-binding writers.
-- Keep export_key aligned with the 16-character github_api_mcp__ prefix plus endpoint_key.
-- binding_id remains governed by the later 1038/1039 bridge sequence.
-- No data DML, provider access, credential access, or runtime mutation; secrets_included=false.

ALTER TABLE IF EXISTS `platform_tool_dispatch_bindings`
  MODIFY COLUMN `export_key` VARCHAR(271) NULL;
