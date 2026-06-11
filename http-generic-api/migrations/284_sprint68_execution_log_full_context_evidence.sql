-- Sprint 68: Execution log full context evidence.
-- Extends execution_log runtime evidence beyond agent/skill/app/workflow to include
-- brand core, business activity/type/profile, connector/permission, resource/budget authority,
-- engine/model/logic/knowledge attribution. No secrets or credential payloads are stored.

ALTER TABLE `execution_log`
  ADD COLUMN IF NOT EXISTS `brand_name` VARCHAR(191) NULL AFTER `brand_key`,
  ADD COLUMN IF NOT EXISTS `brand_core_status` VARCHAR(64) NULL AFTER `brand_name`,
  ADD COLUMN IF NOT EXISTS `brand_core_asset_keys` TEXT NULL AFTER `brand_core_status`,
  ADD COLUMN IF NOT EXISTS `brand_evidence_json` LONGTEXT NULL AFTER `brand_core_asset_keys`,
  ADD COLUMN IF NOT EXISTS `business_activity_type_key` VARCHAR(191) NULL AFTER `activity_type`,
  ADD COLUMN IF NOT EXISTS `activity_key` VARCHAR(191) NULL AFTER `business_activity_type_key`,
  ADD COLUMN IF NOT EXISTS `business_type_key` VARCHAR(191) NULL AFTER `activity_key`,
  ADD COLUMN IF NOT EXISTS `knowledge_profile_key` VARCHAR(191) NULL AFTER `business_type_key`,
  ADD COLUMN IF NOT EXISTS `business_activity_evidence_json` LONGTEXT NULL AFTER `knowledge_profile_key`,
  ADD COLUMN IF NOT EXISTS `business_type_evidence_json` LONGTEXT NULL AFTER `business_activity_evidence_json`,
  ADD COLUMN IF NOT EXISTS `installation_id` VARCHAR(64) NULL AFTER `connected_system_id`,
  ADD COLUMN IF NOT EXISTS `permission_grant_id` VARCHAR(64) NULL AFTER `installation_id`,
  ADD COLUMN IF NOT EXISTS `permission_key` VARCHAR(191) NULL AFTER `permission_grant_id`,
  ADD COLUMN IF NOT EXISTS `connector_family` VARCHAR(191) NULL AFTER `permission_key`,
  ADD COLUMN IF NOT EXISTS `provider_family` VARCHAR(191) NULL AFTER `connector_family`,
  ADD COLUMN IF NOT EXISTS `connected_system_evidence_json` LONGTEXT NULL AFTER `provider_family`,
  ADD COLUMN IF NOT EXISTS `permission_evidence_json` LONGTEXT NULL AFTER `connected_system_evidence_json`,
  ADD COLUMN IF NOT EXISTS `resource_authority_binding_id` VARCHAR(64) NULL AFTER `permission_evidence_json`,
  ADD COLUMN IF NOT EXISTS `resource_authority_evidence_json` LONGTEXT NULL AFTER `resource_authority_binding_id`,
  ADD COLUMN IF NOT EXISTS `budget_authority_id` VARCHAR(64) NULL AFTER `resource_authority_evidence_json`,
  ADD COLUMN IF NOT EXISTS `budget_authority_evidence_json` LONGTEXT NULL AFTER `budget_authority_id`,
  ADD COLUMN IF NOT EXISTS `engine_key` VARCHAR(191) NULL AFTER `budget_authority_evidence_json`,
  ADD COLUMN IF NOT EXISTS `engine_policy_key` VARCHAR(191) NULL AFTER `engine_key`,
  ADD COLUMN IF NOT EXISTS `engine_evidence_json` LONGTEXT NULL AFTER `engine_policy_key`,
  ADD COLUMN IF NOT EXISTS `model_key` VARCHAR(191) NULL AFTER `engine_evidence_json`,
  ADD COLUMN IF NOT EXISTS `model_provider_key` VARCHAR(191) NULL AFTER `model_key`,
  ADD COLUMN IF NOT EXISTS `model_run_id` VARCHAR(191) NULL AFTER `model_provider_key`,
  ADD COLUMN IF NOT EXISTS `model_evidence_json` LONGTEXT NULL AFTER `model_run_id`,
  ADD COLUMN IF NOT EXISTS `logic_key` VARCHAR(191) NULL AFTER `model_evidence_json`,
  ADD COLUMN IF NOT EXISTS `logic_pack_key` VARCHAR(191) NULL AFTER `logic_key`,
  ADD COLUMN IF NOT EXISTS `logic_evidence_json` LONGTEXT NULL AFTER `logic_pack_key`,
  ADD COLUMN IF NOT EXISTS `knowledge_evidence_json` LONGTEXT NULL AFTER `logic_evidence_json`;

CREATE INDEX IF NOT EXISTS `idx_execution_log_brand_activity_evidence`
  ON `execution_log` (`brand_key`, `business_activity_type_key`, `execution_evidence_status`);

CREATE INDEX IF NOT EXISTS `idx_execution_log_permission_authority_evidence`
  ON `execution_log` (`tenant_id`, `connected_system_id`, `permission_key`, `execution_evidence_status`);

CREATE INDEX IF NOT EXISTS `idx_execution_log_engine_model_evidence`
  ON `execution_log` (`engine_key`, `model_key`, `execution_evidence_status`);

CREATE OR REPLACE VIEW `v_execution_log_full_context_evidence_readiness` AS
SELECT
  'execution_log_full_context_evidence' AS `readiness_key`,
  CASE
    WHEN SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `runtime_evidence_json` IS NOT NULL AND JSON_VALID(`runtime_evidence_json`) = 0 THEN 1 ELSE 0 END) > 0 THEN 'fail'
    WHEN SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `brand_evidence_json` IS NOT NULL AND JSON_VALID(`brand_evidence_json`) = 0 THEN 1 ELSE 0 END) > 0 THEN 'fail'
    WHEN SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `business_activity_evidence_json` IS NOT NULL AND JSON_VALID(`business_activity_evidence_json`) = 0 THEN 1 ELSE 0 END) > 0 THEN 'fail'
    WHEN SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `connected_system_evidence_json` IS NOT NULL AND JSON_VALID(`connected_system_evidence_json`) = 0 THEN 1 ELSE 0 END) > 0 THEN 'fail'
    WHEN SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `permission_evidence_json` IS NOT NULL AND JSON_VALID(`permission_evidence_json`) = 0 THEN 1 ELSE 0 END) > 0 THEN 'fail'
    ELSE 'pass'
  END AS `readiness_status`,
  COUNT(*) AS `checked_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' THEN 1 ELSE 0 END) AS `complete_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`brand_key` IS NOT NULL OR `brand_id` IS NOT NULL) THEN 1 ELSE 0 END) AS `brand_dimension_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `brand_evidence_json` IS NOT NULL THEN 1 ELSE 0 END) AS `brand_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`business_activity_type_key` IS NOT NULL OR `activity_key` IS NOT NULL OR `activity_type` IS NOT NULL) THEN 1 ELSE 0 END) AS `business_activity_dimension_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `business_activity_evidence_json` IS NOT NULL THEN 1 ELSE 0 END) AS `business_activity_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`connected_system_id` IS NOT NULL OR `installation_id` IS NOT NULL OR `permission_key` IS NOT NULL) THEN 1 ELSE 0 END) AS `permission_dimension_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`connected_system_evidence_json` IS NOT NULL OR `permission_evidence_json` IS NOT NULL) THEN 1 ELSE 0 END) AS `permission_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`resource_authority_binding_id` IS NOT NULL OR `resource_authority_evidence_json` IS NOT NULL) THEN 1 ELSE 0 END) AS `resource_authority_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`budget_authority_id` IS NOT NULL OR `budget_authority_evidence_json` IS NOT NULL) THEN 1 ELSE 0 END) AS `budget_authority_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`engine_key` IS NOT NULL OR `engine_evidence_json` IS NOT NULL) THEN 1 ELSE 0 END) AS `engine_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`model_key` IS NOT NULL OR `model_run_id` IS NOT NULL OR `model_evidence_json` IS NOT NULL) THEN 1 ELSE 0 END) AS `model_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND (`logic_key` IS NOT NULL OR `logic_pack_key` IS NOT NULL OR `logic_evidence_json` IS NOT NULL) THEN 1 ELSE 0 END) AS `logic_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `knowledge_evidence_json` IS NOT NULL THEN 1 ELSE 0 END) AS `knowledge_evidence_rows`,
  SUM(CASE WHEN `execution_evidence_status` = 'complete' AND `runtime_evidence_json` IS NOT NULL AND JSON_VALID(`runtime_evidence_json`) = 0 THEN 1 ELSE 0 END) AS `invalid_runtime_evidence_json_rows`,
  0 AS `secrets_included`
FROM `execution_log`;

CREATE OR REPLACE VIEW `v_execution_log_full_context_evidence_recent` AS
SELECT
  `id`, `created_at`, `execution_trace_id_writeback`, `execution_status`, `execution_evidence_status`,
  `tenant_id`, `workspace_id`, `user_id`, `actor_id`, `actor_type`, `role_keys`, `policy_keys`,
  `brand_id`, `brand_key`, `brand_name`, `brand_core_status`, `brand_core_asset_keys`,
  `activity_id`, `activity_type`, `business_activity_type_key`, `activity_key`, `business_type_key`, `knowledge_profile_key`,
  `connected_system_id`, `installation_id`, `permission_grant_id`, `permission_key`, `connector_family`, `provider_family`,
  `resource_authority_binding_id`, `budget_authority_id`,
  `engine_key`, `engine_policy_key`, `model_key`, `model_provider_key`, `model_run_id`, `logic_key`, `logic_pack_key`,
  `agent_key`, `skill_key`, `app_key`, `app_connection_id`, `plugin_key`, `workflow_key`, `workflow_binding_key`,
  JSON_VALID(COALESCE(`runtime_evidence_json`, '{}')) AS `runtime_evidence_json_valid`,
  0 AS `secrets_included`
FROM `execution_log`
ORDER BY `id` DESC
LIMIT 200;

INSERT INTO `execution_policies`
  (`policy_key`, `policy_group`, `policy_value`, `active`, `execution_scope`, `affects_layer`, `blocking`, `notes`)
VALUES
  ('execution_log_full_context_evidence_policy_v1',
   'Execution Evidence Governance',
   JSON_OBJECT(
     'purpose', 'Execution log rows must carry non-secret evidence for brand, business activity, permissions, authorities, engines, models, logic, and knowledge.',
     'required_context_groups', JSON_ARRAY('brand','business_activity','permission_authority','runtime_intelligence'),
     'secrets_allowed', false
   ),
   'TRUE',
   'execution_log|runtime_evidence|brand_core|business_activity|resource_authority|engine_model_logic',
   'executionEvidenceLogger|execution_log|releaseReadiness',
   'TRUE',
   'Extends execution evidence beyond runtime surfaces into full governed context attribution.')
ON DUPLICATE KEY UPDATE
  `policy_value` = VALUES(`policy_value`),
  `active` = VALUES(`active`),
  `execution_scope` = VALUES(`execution_scope`),
  `affects_layer` = VALUES(`affects_layer`),
  `blocking` = VALUES(`blocking`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;
