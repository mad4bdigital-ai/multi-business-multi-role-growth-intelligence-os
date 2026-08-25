-- Restore the canonical generated-column invariant after the last known explicit current_contract_key writer.
-- No data DML, provider access, credential access, runtime mutation, or Production action; secrets_included=false.

ALTER TABLE IF EXISTS `platform_capability_readback_contracts`
  MODIFY COLUMN `current_contract_key` VARCHAR(191)
    GENERATED ALWAYS AS (CASE WHEN `is_current` = 1 THEN `contract_key` ELSE NULL END) STORED;
