-- Staging-local additive compatibility repair for historical writers that omit the
-- materialized SHA-256 column from INSERT column lists. MariaDB validates a NOT NULL
-- ordinary column before BEFORE INSERT triggers execute, so the explicit sentinel is
-- required only to cross that validation boundary; the existing trigger immediately
-- replaces it with SHA2(NEW.endpoint_url, 256).
-- DDL-only; no data DML, provider access, credentials, runtime mutation, or exports.

ALTER TABLE IF EXISTS `local_connector_device_routes`
  MODIFY COLUMN `endpoint_url_sha256` CHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000';
