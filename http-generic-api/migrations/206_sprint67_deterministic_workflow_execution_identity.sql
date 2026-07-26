-- Sprint 67: Deterministic workflow execution identity
-- workflow_key is a family/compatibility key and may repeat. Persist workflow_id
-- when an exact runtime variant is selected so dispatch never relies on row order.

ALTER TABLE `execution_plans`
  ADD COLUMN IF NOT EXISTS `workflow_id` VARCHAR(191) NULL AFTER `workflow_key`;

CREATE INDEX IF NOT EXISTS `idx_execution_plans_workflow_id`
  ON `execution_plans` (`workflow_id`);
