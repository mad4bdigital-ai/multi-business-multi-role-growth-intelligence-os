-- Sprint 68: Execution log runtime evidence envelope.
-- Purpose: make execution_log prove which agent/skill/app/workflow/role/policies were used.
-- No secrets, credential payloads, prompts, schemas, webhook URLs, or provider payloads are stored here.

ALTER TABLE `execution_log`
  ADD COLUMN IF NOT EXISTS `agent_id` VARCHAR(64) NULL AFTER `app_key`,
  ADD COLUMN IF NOT EXISTS `agent_key` VARCHAR(191) NULL AFTER `agent_id`,
  ADD COLUMN IF NOT EXISTS `skill_id` VARCHAR(64) NULL AFTER `agent_key`,
  ADD COLUMN IF NOT EXISTS `skill_key` VARCHAR(191) NULL AFTER `skill_id`,
  ADD COLUMN IF NOT EXISTS `workflow_id` VARCHAR(191) NULL AFTER `skill_key`,
  ADD COLUMN IF NOT EXISTS `workflow_key` VARCHAR(191) NULL AFTER `workflow_id`,
  ADD COLUMN IF NOT EXISTS `workflow_binding_key` VARCHAR(191) NULL AFTER `workflow_key`,
  ADD COLUMN IF NOT EXISTS `app_connection_id` VARCHAR(64) NULL AFTER `workflow_binding_key`,
  ADD COLUMN IF NOT EXISTS `plugin_key` VARCHAR(191) NULL AFTER `app_connection_id`,
  ADD COLUMN IF NOT EXISTS `role_keys` TEXT NULL AFTER `plugin_key`,
  ADD COLUMN IF NOT EXISTS `policy_keys` TEXT NULL AFTER `role_keys`,
  ADD COLUMN IF NOT EXISTS `agent_evidence_json` LONGTEXT NULL AFTER `policy_keys`,
  ADD COLUMN IF NOT EXISTS `skill_evidence_json` LONGTEXT NULL AFTER `agent_evidence_json`,
  ADD COLUMN IF NOT EXISTS `app_evidence_json` LONGTEXT NULL AFTER `skill_evidence_json`,
  ADD COLUMN IF NOT EXISTS `workflow_evidence_json` LONGTEXT NULL AFTER `app_evidence_json`,
  ADD COLUMN IF NOT EXISTS `role_evidence_json` LONGTEXT NULL AFTER `workflow_evidence_json`,
  ADD COLUMN IF NOT EXISTS `policy_evidence_json` LONGTEXT NULL AFTER `role_evidence_json`,
  ADD COLUMN IF NOT EXISTS `authorization_evidence_json` LONGTEXT NULL AFTER `policy_evidence_json`,
  ADD COLUMN IF NOT EXISTS `runtime_evidence_json` LONGTEXT NULL AFTER `authorization_evidence_json`,
  ADD COLUMN IF NOT EXISTS `execution_evidence_status` VARCHAR(64) NULL AFTER `runtime_evidence_json`;

CREATE INDEX IF NOT EXISTS `idx_execution_log_agent_skill`
  ON `execution_log` (`agent_id`, `skill_key`, `execution_status`);

CREATE INDEX IF NOT EXISTS `idx_execution_log_workflow_evidence`
  ON `execution_log` (`workflow_key`, `workflow_binding_key`, `execution_status`);

CREATE INDEX IF NOT EXISTS `idx_execution_log_app_evidence`
  ON `execution_log` (`app_key`, `app_connection_id`, `execution_status`);

CREATE INDEX IF NOT EXISTS `idx_execution_log_policy_evidence`
  ON `execution_log` (`tenant_id`, `user_id`, `execution_evidence_status`);

CREATE OR REPLACE VIEW `v_execution_log_runtime_evidence_readiness` AS
SELECT
  'execution_log_runtime_evidence' AS `readiness_key`,
  CASE
    WHEN SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `tenant_id` IS NOT NULL AND `user_id` IS NOT NULL AND (`policy_keys` IS NULL OR `policy_keys` = '') THEN 1 ELSE 0 END) > 0 THEN 'fail'
    WHEN SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `runtime_evidence_json` IS NOT NULL AND JSON_VALID(`runtime_evidence_json`) = 0 THEN 1 ELSE 0 END) > 0 THEN 'fail'
    ELSE 'pass'
  END AS `readiness_status`,
  COUNT(*) AS `checked_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' THEN 1 ELSE 0 END) AS `complete_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`agent_id` IS NOT NULL OR `agent_key` IS NOT NULL) THEN 1 ELSE 0 END) AS `agent_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`skill_id` IS NOT NULL OR `skill_key` IS NOT NULL) THEN 1 ELSE 0 END) AS `skill_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`app_key` IS NOT NULL OR `app_connection_id` IS NOT NULL OR `plugin_key` IS NOT NULL) THEN 1 ELSE 0 END) AS `app_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`workflow_id` IS NOT NULL OR `workflow_key` IS NOT NULL OR `workflow_binding_key` IS NOT NULL) THEN 1 ELSE 0 END) AS `workflow_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`role_keys` IS NOT NULL AND `role_keys` <> '') THEN 1 ELSE 0 END) AS `role_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`policy_keys` IS NOT NULL AND `policy_keys` <> '') THEN 1 ELSE 0 END) AS `policy_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `tenant_id` IS NOT NULL AND `user_id` IS NOT NULL AND (`policy_keys` IS NULL OR `policy_keys` = '') THEN 1 ELSE 0 END) AS `missing_policy_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `runtime_evidence_json` IS NOT NULL AND JSON_VALID(`runtime_evidence_json`) = 0 THEN 1 ELSE 0 END) AS `invalid_runtime_evidence_json_rows`,
  0 AS `secrets_included`
FROM `execution_log`;

CREATE OR REPLACE VIEW `v_execution_log_runtime_evidence_recent` AS
SELECT
  `id`,
  `created_at`,
  `execution_trace_id_writeback`,
  `execution_status`,
  `execution_evidence_status`,
  `tenant_id`,
  `workspace_id`,
  `user_id`,
  `actor_id`,
  `actor_type`,
  `role_keys`,
  `policy_keys`,
  `parent_action_key`,
  `endpoint_key`,
  `tool_key`,
  `action_key`,
  `app_key`,
  `app_connection_id`,
  `plugin_key`,
  `agent_id`,
  `agent_key`,
  `skill_id`,
  `skill_key`,
  `workflow_id`,
  `workflow_key`,
  `workflow_binding_key`,
  `resource_type`,
  `resource_id`,
  `target_type`,
  `target_id`,
  `correlation_id`,
  JSON_VALID(COALESCE(`runtime_evidence_json`, '{}')) AS `runtime_evidence_json_valid`,
  0 AS `secrets_included`
FROM `execution_log`
ORDER BY `id` DESC
LIMIT 200;

INSERT INTO `execution_policies`
  (`policy_key`, `policy_group`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
VALUES
  ('execution_log_runtime_evidence_policy_v1',
   'Execution Evidence Governance',
   JSON_OBJECT(
     'purpose', 'Execution log rows must carry normalized runtime evidence for agent, skill, app, workflow, role, and policy usage.',
     'required_dimensions', JSON_ARRAY('tenant_id','workspace_id','user_id','role_keys','policy_keys'),
     'runtime_surfaces', JSON_ARRAY('agent','skill','app','workflow','policy','role'),
     'secrets_allowed', false
   ),
   'TRUE',
   'execution_log|runtime_evidence|authorized_access',
   'executionEvidenceLogger|execution_log|releaseReadiness',
   'TRUE',
   'Adds complete non-secret execution evidence to execution_log for runtime attribution and governance readback.')
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
