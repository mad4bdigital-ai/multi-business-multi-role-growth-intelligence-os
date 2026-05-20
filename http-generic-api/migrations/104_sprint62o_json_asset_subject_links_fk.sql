-- Sprint 62o: enforce referential integrity for json_asset_subject_links
-- Fixes the MariaDB FK blocker by aligning child table charset/collation with json_assets before adding the FK.

ALTER TABLE `json_asset_subject_links`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Fail loudly if orphan links exist. The deployment should not add the FK until data is repaired.
SET @json_asset_subject_links_orphan_count := (
  SELECT COUNT(*)
  FROM `json_asset_subject_links` l
  LEFT JOIN `json_assets` ja ON ja.`asset_id` = l.`asset_id`
  WHERE ja.`asset_id` IS NULL
);

SET @json_asset_subject_links_orphan_guard := IF(
  @json_asset_subject_links_orphan_count = 0,
  'SELECT 1 AS json_asset_subject_links_orphan_check_passed',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''json_asset_subject_links contains orphan asset_id rows; repair before adding FK'''
);
PREPARE json_asset_subject_links_orphan_stmt FROM @json_asset_subject_links_orphan_guard;
EXECUTE json_asset_subject_links_orphan_stmt;
DEALLOCATE PREPARE json_asset_subject_links_orphan_stmt;

-- Add the FK only if it is not already present. MariaDB does not support ADD CONSTRAINT IF NOT EXISTS.
SET @json_asset_subject_links_fk_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'json_asset_subject_links'
    AND CONSTRAINT_NAME = 'fk_json_asset_subject_asset'
    AND REFERENCED_TABLE_NAME = 'json_assets'
    AND REFERENCED_COLUMN_NAME = 'asset_id'
);

SET @json_asset_subject_links_fk_sql := IF(
  @json_asset_subject_links_fk_exists = 0,
  'ALTER TABLE `json_asset_subject_links` ADD CONSTRAINT `fk_json_asset_subject_asset` FOREIGN KEY (`asset_id`) REFERENCES `json_assets` (`asset_id`) ON DELETE CASCADE',
  'SELECT 1 AS fk_json_asset_subject_asset_already_exists'
);
PREPARE json_asset_subject_links_fk_stmt FROM @json_asset_subject_links_fk_sql;
EXECUTE json_asset_subject_links_fk_stmt;
DEALLOCATE PREPARE json_asset_subject_links_fk_stmt;
