-- Staging-local additive compatibility repair for historical/runtime writers that
-- omit scope_key_hash from INSERT column lists. MariaDB checks NOT NULL ordinary
-- columns before BEFORE INSERT triggers; this binary sentinel only crosses that
-- validation boundary and is immediately replaced by the existing SHA2 trigger.
-- DDL-only; no data DML, provider access, credentials, runtime mutation, or exports.

ALTER TABLE IF EXISTS `growth_control_config_versions`
  MODIFY COLUMN `scope_key_hash` BINARY(32) NOT NULL DEFAULT 0x0000000000000000000000000000000000000000000000000000000000000000;
