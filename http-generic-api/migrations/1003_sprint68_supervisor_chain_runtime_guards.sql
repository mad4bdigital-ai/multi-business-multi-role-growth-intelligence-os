-- Sprint 68: durable supervisor chain lineage, bounded depth, and fallback evidence.

ALTER TABLE `agent_chain_events`
  ADD COLUMN IF NOT EXISTS `root_event_id` VARCHAR(36) NULL AFTER `event_id`,
  ADD COLUMN IF NOT EXISTS `parent_event_id` VARCHAR(36) NULL AFTER `root_event_id`,
  ADD COLUMN IF NOT EXISTS `chain_depth` SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER `parent_event_id`,
  ADD COLUMN IF NOT EXISTS `max_chain_depth` SMALLINT UNSIGNED NOT NULL DEFAULT 8 AFTER `chain_depth`,
  ADD COLUMN IF NOT EXISTS `workflow_path_json` JSON NULL AFTER `max_chain_depth`,
  ADD COLUMN IF NOT EXISTS `dispatched_run_id` VARCHAR(36) NULL AFTER `source_run_id`,
  ADD COLUMN IF NOT EXISTS `fallback_agent_id` VARCHAR(36) NULL AFTER `target_agent_id`,
  ADD COLUMN IF NOT EXISTS `failure_reason` VARCHAR(255) NULL AFTER `status`;

UPDATE `agent_chain_events`
SET `root_event_id` = `event_id`,
    `workflow_path_json` = JSON_ARRAY(`target_workflow_key`)
WHERE `root_event_id` IS NULL;

ALTER TABLE `agent_chain_events`
  ADD INDEX IF NOT EXISTS `idx_chain_root_depth` (`root_event_id`, `chain_depth`),
  ADD INDEX IF NOT EXISTS `idx_chain_dispatched_run` (`dispatched_run_id`);
