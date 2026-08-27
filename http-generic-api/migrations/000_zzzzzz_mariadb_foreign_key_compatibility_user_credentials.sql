-- MariaDB 11.4 FK compatibility normalization for the canonical baseline table.
-- Additive DDL only: schema.sql remains immutable and its deferred FK is
-- created only after ordered migrations have completed.
ALTER TABLE `user_credentials`
  MODIFY COLUMN `user_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL;
