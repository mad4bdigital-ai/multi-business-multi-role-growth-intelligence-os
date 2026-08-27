-- Staging-local additive compatibility repair for the act-as-user repository,
-- whose INSERT omits idempotency_tuple_hash. MariaDB validates a NOT NULL ordinary
-- column before the BEFORE INSERT trigger computes the materialized digest; this
-- binary sentinel exists only for that boundary and is immediately overwritten.
-- DDL-only; no data DML, provider access, credentials, runtime mutation, or exports.

ALTER TABLE IF EXISTS `act_as_user_sessions`
  MODIFY COLUMN `idempotency_tuple_hash` BINARY(32) NOT NULL DEFAULT 0x0000000000000000000000000000000000000000000000000000000000000000;
