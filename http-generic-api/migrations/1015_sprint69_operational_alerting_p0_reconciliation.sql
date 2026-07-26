-- Sprint 69: Operational alerting P0 reconciliation.
-- Additive/idempotent. Internal SQL only. No provider calls, external sends, or secret reads.
-- Goals:
--   1. retain one active grant per agent + skill + effective tenant/brand scope;
--   2. prevent future active duplicates while preserving revoked history;
--   3. suspend stale pending notifications until the recovery-aware sync re-evaluates them;
--   4. align rule descriptions with grouped approvals and recovery-aware execution evidence.

ALTER TABLE `agent_skill_grants`
  ADD COLUMN IF NOT EXISTS `active_effective_scope_key` VARCHAR(255)
  GENERATED ALWAYS AS (
    CASE
      WHEN `status` = 'active' THEN CONCAT_WS(
        '|',
        `agent_id`,
        `skill_id`,
        COALESCE(`tenant_id`, '__global__'),
        COALESCE(`brand_key`, '__global__')
      )
      ELSE NULL
    END
  ) PERSISTENT;

UPDATE `agent_skill_grants` AS `g`
JOIN (
  SELECT `keep_id`, `agent_id`, `skill_id`, `tenant_id`, `brand_key`
  FROM (
    SELECT
      MAX(`id`) AS `keep_id`,
      `agent_id`,
      `skill_id`,
      `tenant_id`,
      `brand_key`
    FROM `agent_skill_grants`
    WHERE `status` = 'active'
    GROUP BY `agent_id`, `skill_id`, `tenant_id`, `brand_key`
    HAVING COUNT(*) > 1
  ) AS `duplicate_groups`
) AS `dedupe`
  ON BINARY `g`.`agent_id` = BINARY `dedupe`.`agent_id`
 AND BINARY `g`.`skill_id` = BINARY `dedupe`.`skill_id`
 AND `g`.`tenant_id` <=> `dedupe`.`tenant_id`
 AND `g`.`brand_key` <=> `dedupe`.`brand_key`
SET
  `g`.`status` = 'revoked',
  `g`.`expires_at` = COALESCE(`g`.`expires_at`, UTC_TIMESTAMP())
WHERE `g`.`status` = 'active'
  AND `g`.`id` <> `dedupe`.`keep_id`;

CREATE UNIQUE INDEX IF NOT EXISTS `uq_agent_skill_grants_active_effective_scope`
  ON `agent_skill_grants` (`active_effective_scope_key`);

UPDATE `operational_alert_notification_outbox`
SET
  `delivery_status` = 'skipped',
  `error_code` = 'p0_reconciliation_required',
  `error_message` = 'Pending notification held until recovery-aware operational alert synchronization re-evaluates the source evidence.',
  `updated_at` = CURRENT_TIMESTAMP
WHERE `delivery_status` = 'pending';

UPDATE `operational_alert_rule_registry`
SET
  `condition_key` = 'requires_approval=1 grouped by agent_id+skill_id+effective_scope',
  `updated_at` = CURRENT_TIMESTAMP
WHERE `rule_key` = 'alert_skill_approval';

UPDATE `operational_alert_rule_registry`
SET
  `condition_key` = 'execution_status=failed AND no later success for the same operation fingerprint',
  `updated_at` = CURRENT_TIMESTAMP
WHERE `rule_key` = 'alert_execution_failed';
