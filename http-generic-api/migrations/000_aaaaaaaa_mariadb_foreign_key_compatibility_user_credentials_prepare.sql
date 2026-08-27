-- MariaDB 11.4 FK compatibility prepare bridge for the immutable baseline user_credentials FK.
-- Additive DDL only: temporarily remove the baseline FK so the parent and child
-- key collations can be normalized before the immutable 000_zzzzzz bridge runs.
ALTER TABLE `user_credentials`
  DROP FOREIGN KEY IF EXISTS `user_credentials_ibfk_1`;
