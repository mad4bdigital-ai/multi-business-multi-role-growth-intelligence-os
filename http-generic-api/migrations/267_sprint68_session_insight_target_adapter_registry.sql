-- Sprint 68: Session insight target adapter registry foundation.
--
-- Adds read-only registry rows for future target-specific adapters that may later
-- consume capability-gated session insight apply requests.
--
-- Foundation only: adapters are skeletons, apply_supported=0, no executor route,
-- no backlog/policy/canonical/provider/credential/external writes, and no secrets.

CREATE TABLE IF NOT EXISTS `session_insight_promotion_target_adapters` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `adapter_key` VARCHAR(128) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `target_operation` VARCHAR(128) NOT NULL,
  `adapter_family` VARCHAR(128) NOT NULL,
  `implementation_status` ENUM('skeleton','implemented','deprecated') NOT NULL DEFAULT 'skeleton',
  `execution_mode` ENUM('registry_only','dry_run','apply') NOT NULL DEFAULT 'registry_only',
  `apply_supported` TINYINT(1) NOT NULL DEFAULT 0,
  `capability_key_required` VARCHAR(128) NOT NULL,
  `capability_envelope_required` TINYINT(1) NOT NULL DEFAULT 1,
  `dry_run_tool_key` VARCHAR(128) NULL,
  `apply_tool_key` VARCHAR(128) NULL,
  `policy_key` VARCHAR(128) NOT NULL,
  `validator_commands_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`validator_commands_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `status` ENUM('active','inactive','deprecated') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_target_adapter_key` (`adapter_key`),
  UNIQUE KEY `uq_session_insight_target_adapter_mapping` (`promotion_type`, `target_surface`),
  KEY `idx_session_insight_target_adapter_surface` (`target_surface`, `status`),
  KEY `idx_session_insight_target_adapter_family` (`adapter_family`, `implementation_status`),
  CONSTRAINT `chk_session_insight_target_adapter_skeleton_no_apply` CHECK (`apply_supported` = 0),
  CONSTRAINT `chk_session_insight_target_adapter_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_target_adapter_issues` AS
SELECT
  a.adapter_key,
  a.promotion_type,
  a.target_surface,
  'adapter_claims_apply_supported_in_foundation' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_key', a.adapter_key, 'apply_supported', a.apply_supported, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_target_adapters` a
WHERE a.apply_supported <> 0
UNION ALL
SELECT
  a.adapter_key,
  a.promotion_type,
  a.target_surface,
  'adapter_not_skeleton_in_foundation' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_key', a.adapter_key, 'implementation_status', a.implementation_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_target_adapters` a
WHERE a.implementation_status <> 'skeleton'
UNION ALL
SELECT
  a.adapter_key,
  a.promotion_type,
  a.target_surface,
  'adapter_apply_tool_registered_too_early' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_key', a.adapter_key, 'apply_tool_key', a.apply_tool_key, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_target_adapters` a
WHERE TRIM(COALESCE(a.apply_tool_key, '')) <> ''
UNION ALL
SELECT
  a.adapter_key,
  a.promotion_type,
  a.target_surface,
  'adapter_missing_capability_gate' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_key', a.adapter_key, 'capability_envelope_required', a.capability_envelope_required, 'capability_key_required', a.capability_key_required, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_target_adapters` a
WHERE a.capability_envelope_required <> 1
   OR TRIM(COALESCE(a.capability_key_required, '')) = ''
UNION ALL
SELECT
  a.adapter_key,
  a.promotion_type,
  a.target_surface,
  'adapter_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('adapter_key', a.adapter_key, 'secrets_included', a.secrets_included) AS evidence_json
FROM `session_insight_promotion_target_adapters` a
WHERE a.secrets_included <> 0
UNION ALL
SELECT
  CONCAT('missing_adapter.', r.promotion_type, '.', r.target_surface) AS adapter_key,
  r.promotion_type,
  r.target_surface,
  'apply_request_missing_target_adapter' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('promotion_type', r.promotion_type, 'target_surface', r.target_surface, 'apply_request_count', COUNT(*), 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_apply_requests` r
LEFT JOIN `session_insight_promotion_target_adapters` a
  ON a.promotion_type = r.promotion_type
 AND a.target_surface = r.target_surface
 AND a.status = 'active'
WHERE r.secrets_included = 0
GROUP BY r.promotion_type, r.target_surface, a.adapter_key
HAVING a.adapter_key IS NULL;

CREATE OR REPLACE VIEW `v_session_insight_apply_request_adapter_readiness` AS
SELECT
  r.apply_request_id,
  r.preview_id,
  r.promotion_id,
  r.promotion_type,
  r.target_surface,
  r.requested_operation,
  r.request_status,
  r.execution_allowed,
  r.execution_status,
  a.adapter_key,
  a.display_name AS adapter_display_name,
  a.adapter_family,
  a.implementation_status,
  a.apply_supported,
  a.capability_key_required,
  a.capability_envelope_required,
  a.apply_tool_key,
  CASE
    WHEN r.execution_allowed <> 0 THEN 'invalid_apply_request_execution_allowed'
    WHEN a.adapter_key IS NULL THEN 'blocked_missing_target_adapter'
    WHEN a.apply_supported <> 0 THEN 'blocked_adapter_claims_apply_supported'
    WHEN a.implementation_status <> 'skeleton' THEN 'blocked_adapter_not_skeleton'
    WHEN a.capability_envelope_required <> 1 THEN 'blocked_missing_capability_gate'
    ELSE 'mapped_skeleton_blocked_for_capability_envelope'
  END AS adapter_readiness_status,
  JSON_OBJECT(
    'apply_request_id', r.apply_request_id,
    'adapter_key', a.adapter_key,
    'capability_envelope_required', true,
    'target_adapter_required', true,
    'execution_allowed', false,
    'backlog_policy_canonical_write_executed', false,
    'provider_call_executed', false,
    'credential_payload_read', false,
    'external_write_executed', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_promotion_apply_requests` r
LEFT JOIN `session_insight_promotion_target_adapters` a
  ON a.promotion_type = r.promotion_type
 AND a.target_surface = r.target_surface
 AND a.status = 'active'
WHERE r.secrets_included = 0;

INSERT INTO `session_insight_promotion_target_adapters` (
  `adapter_key`, `display_name`, `promotion_type`, `target_surface`, `target_operation`,
  `adapter_family`, `implementation_status`, `execution_mode`, `apply_supported`,
  `capability_key_required`, `capability_envelope_required`, `dry_run_tool_key`, `apply_tool_key`,
  `policy_key`, `validator_commands_json`, `safety_contract_json`, `status`, `notes`, `secrets_included`
) VALUES
  ('session_insight.runtime_repair_backlog.skeleton_adapter', 'Runtime Repair Backlog Skeleton Adapter', 'runtime_repair_backlog_item', 'runtime_repair_backlog', 'would_create_runtime_repair_backlog_item', 'runtime_repair_backlog_executor', 'skeleton', 'registry_only', 0, 'session_insight_runtime_repair_backlog_apply', 1, 'session_insight_promotion_executor_dry_run', NULL, 'session_insight_target_adapter_registry_policy_v1', JSON_ARRAY('node test-session-insight-target-adapter-registry-service.mjs'), JSON_OBJECT('registry_only',true,'apply_supported',false,'capability_envelope_required',true,'target_adapter_implementation_required',true,'runtime_promotion_executed',false,'backlog_policy_canonical_write_executed',false,'provider_call_executed',false,'credential_payload_read',false,'external_write_executed',false,'raw_transcript_included',false,'secrets_included',false), 'active', 'Skeleton registry row only. No runtime repair backlog write is implemented.', 0),
  ('session_insight.development_backlog.skeleton_adapter', 'Development Backlog Skeleton Adapter', 'development_backlog_item', 'development_backlog', 'would_create_development_backlog_item', 'development_backlog_executor', 'skeleton', 'registry_only', 0, 'session_insight_development_backlog_apply', 1, 'session_insight_promotion_executor_dry_run', NULL, 'session_insight_target_adapter_registry_policy_v1', JSON_ARRAY('node test-session-insight-target-adapter-registry-service.mjs'), JSON_OBJECT('registry_only',true,'apply_supported',false,'capability_envelope_required',true,'target_adapter_implementation_required',true,'runtime_promotion_executed',false,'backlog_policy_canonical_write_executed',false,'provider_call_executed',false,'credential_payload_read',false,'external_write_executed',false,'raw_transcript_included',false,'secrets_included',false), 'active', 'Skeleton registry row only. No development backlog write is implemented.', 0),
  ('session_insight.integration_backlog.skeleton_adapter', 'Integration Backlog Skeleton Adapter', 'integration_backlog_item', 'integration_backlog', 'would_create_integration_backlog_item', 'integration_backlog_executor', 'skeleton', 'registry_only', 0, 'session_insight_integration_backlog_apply', 1, 'session_insight_promotion_executor_dry_run', NULL, 'session_insight_target_adapter_registry_policy_v1', JSON_ARRAY('node test-session-insight-target-adapter-registry-service.mjs'), JSON_OBJECT('registry_only',true,'apply_supported',false,'capability_envelope_required',true,'target_adapter_implementation_required',true,'runtime_promotion_executed',false,'backlog_policy_canonical_write_executed',false,'provider_call_executed',false,'credential_payload_read',false,'external_write_executed',false,'raw_transcript_included',false,'secrets_included',false), 'active', 'Skeleton registry row only. No integration backlog write is implemented.', 0)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `target_operation` = VALUES(`target_operation`),
  `adapter_family` = VALUES(`adapter_family`),
  `implementation_status` = 'skeleton',
  `execution_mode` = 'registry_only',
  `apply_supported` = 0,
  `capability_key_required` = VALUES(`capability_key_required`),
  `capability_envelope_required` = 1,
  `dry_run_tool_key` = VALUES(`dry_run_tool_key`),
  `apply_tool_key` = NULL,
  `policy_key` = VALUES(`policy_key`),
  `validator_commands_json` = VALUES(`validator_commands_json`),
  `safety_contract_json` = VALUES(`safety_contract_json`),
  `status` = 'active',
  `notes` = VALUES(`notes`),
  `secrets_included` = 0,
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_target_adapter_registry_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_target_adapter_registry_foundation_only',
         'tool','session_insight_target_adapter_registry_list',
         'registry_only',true,
         'apply_supported',false,
         'requires_capability_envelope',true,
         'requires_target_adapter_implementation',true,
         'sets_promotion_allowed',false,
         'assigns_executor',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|promotion_target_adapter_registry|capability_gate_skeleton',
       'session_insight_promotion_target_adapters|session_insight_promotion_apply_requests|admin_platform_endpoint_tools',
       'TRUE',
       'Target adapter registry maps apply requests to skeleton adapters only. No target adapter execution is enabled.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_target_adapter_registry_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'session_insight_target_adapter_registry_list',
  'Session Insight Target Adapter Registry List',
  'Read target adapter skeleton registry and apply-request mapping readiness. Registry/readback only: never executes adapters, never writes backlog/policy/canonicals, never calls providers, never reads credentials, and never returns secrets.',
  'POST',
  '/platform/session-insight-promotions/target-adapters/list',
  NULL,
  JSON_OBJECT('type','object','properties',JSON_OBJECT('adapter_key',JSON_OBJECT('type','string'),'promotion_type',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'adapter_family',JSON_OBJECT('type','string'),'implementation_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('skeleton','implemented','deprecated')),'status',JSON_OBJECT('type','string','enum',JSON_ARRAY('active','inactive','deprecated')),'q',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
  NULL,
  'admin,session_memory,target_adapter_registry,read_only,no_execution,no_secrets',
  1,
  654
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`),
  `updated_at` = CURRENT_TIMESTAMP;
