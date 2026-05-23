-- Sprint 62v: session summary autosweep metadata.
-- Summaries remain compact and summary-only; full transcript text stays in Drive archives.

ALTER TABLE `session_summaries`
  ADD COLUMN IF NOT EXISTS `tags_json` JSON NULL AFTER `integration_needs`,
  ADD COLUMN IF NOT EXISTS `summary_sha256` VARCHAR(64) NULL AFTER `summary_text`,
  ADD COLUMN IF NOT EXISTS `summary_version` VARCHAR(64) NULL AFTER `session_model`,
  ADD COLUMN IF NOT EXISTS `summary_status` VARCHAR(64) NOT NULL DEFAULT 'ready' AFTER `summary_version`,
  ADD COLUMN IF NOT EXISTS `summary_source` VARCHAR(64) NULL AFTER `summary_status`,
  ADD COLUMN IF NOT EXISTS `source_turn_count` INT NULL AFTER `turn_count`,
  ADD COLUMN IF NOT EXISTS `source_last_turn_at` DATETIME NULL AFTER `source_turn_count`,
  ADD COLUMN IF NOT EXISTS `source_drive_jsonl_id` VARCHAR(255) NULL AFTER `source_last_turn_at`,
  ADD COLUMN IF NOT EXISTS `source_drive_doc_id` VARCHAR(255) NULL AFTER `source_drive_jsonl_id`;

CREATE INDEX IF NOT EXISTS `idx_session_summaries_source_turns`
  ON `session_summaries` (`session_id`, `source_turn_count`, `created_at`);
