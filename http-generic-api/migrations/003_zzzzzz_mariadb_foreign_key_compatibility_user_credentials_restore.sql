-- MariaDB 11.4 FK compatibility restore bridge for user_credentials.
-- Additive DDL only: the earlier prepare bridge removes the baseline FK;
-- this bridge aligns both key columns and restores the canonical relationship.
ALTER TABLE `users`
  MODIFY COLUMN `user_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL;

ALTER TABLE `user_credentials`
  MODIFY COLUMN `user_id` VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL;

ALTER TABLE `user_credentials`
  ADD CONSTRAINT `user_credentials_ibfk_1`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;
