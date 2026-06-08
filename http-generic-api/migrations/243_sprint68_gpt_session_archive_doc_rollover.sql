-- Sprint 68: GPT session archive Google Doc rollover metadata
-- Keeps Google Docs readable by rolling the human transcript to Part N while
-- JSONL remains the full-fidelity sidecar. Idempotent and additive only.

ALTER TABLE `customer_sessions`
  ADD COLUMN IF NOT EXISTS `drive_doc_part_index` SMALLINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Current human-readable transcript Google Doc part number.' AFTER `drive_doc_url`,
  ADD COLUMN IF NOT EXISTS `drive_doc_part_count` SMALLINT UNSIGNED NOT NULL DEFAULT 1
    COMMENT 'Highest human-readable transcript Google Doc part created for this session.' AFTER `drive_doc_part_index`,
  ADD COLUMN IF NOT EXISTS `drive_doc_rollover_threshold_chars` INT UNSIGNED NULL
    COMMENT 'Optional per-session Google Doc rollover threshold in characters.' AFTER `drive_doc_part_count`;

ALTER TABLE `gpt_session_turns`
  ADD COLUMN IF NOT EXISTS `drive_doc_part` SMALLINT UNSIGNED NULL
    COMMENT 'Transcript Google Doc part number that contains this turn anchor.' AFTER `drive_doc_id`;

UPDATE `customer_sessions`
   SET `drive_doc_part_index` = COALESCE(NULLIF(`drive_doc_part_index`, 0), 1),
       `drive_doc_part_count` = GREATEST(COALESCE(NULLIF(`drive_doc_part_count`, 0), 1), COALESCE(NULLIF(`drive_doc_part_index`, 0), 1))
 WHERE `drive_doc_id` IS NOT NULL;

UPDATE `gpt_session_turns`
   SET `drive_doc_part` = COALESCE(NULLIF(`drive_doc_part`, 0), 1)
 WHERE `drive_doc_id` IS NOT NULL
   AND `drive_doc_part` IS NULL;
