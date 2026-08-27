-- Staging-local additive compatibility repair for writers that omit
-- root_ref_digest from INSERT column lists. The placeholder is valid against the
-- table's lowercase-hex CHECK constraint and is immediately replaced by the
-- existing BEFORE INSERT/UPDATE SHA2 trigger.
-- DDL-only; no data DML, provider access, credentials, runtime mutation, or exports.

ALTER TABLE IF EXISTS `storage_execution_leases`
  MODIFY COLUMN `root_ref_digest` CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';
