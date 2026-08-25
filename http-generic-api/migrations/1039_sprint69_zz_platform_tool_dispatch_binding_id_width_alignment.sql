-- Staging-local additive compatibility bridge for immutable migration 1040.
-- The superseded-branch cleanup binding prefix plus endpoint_key requires the full
-- declared 293-character domain after migration 1038's earlier 128-character ALTER.
-- No data DML, provider access, credential access, or runtime mutation; secrets_included=false.

ALTER TABLE IF EXISTS `platform_tool_dispatch_bindings`
  MODIFY COLUMN `binding_id` VARCHAR(293) NOT NULL;
