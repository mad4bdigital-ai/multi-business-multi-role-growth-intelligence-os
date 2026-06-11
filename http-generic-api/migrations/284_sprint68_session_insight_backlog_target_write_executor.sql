-- Sprint 68: Session insight backlog target write executor.
--
-- Adds the first actual target-write surface for Session Insight promotions.
-- This writes only to internal SQL backlog tables after the capability-envelope
-- approval/readback/remaining-scope chain is complete. No provider calls, no
-- credential payload reads, no raw transcripts, no external writes, and no secrets.

CREATE TABLE IF NOT EXISTS `session_insight_backlog_target_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `target_item_id` VARCHAR(128) NOT NULL,
  `source_target_write_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `target_surface` ENUM('development_backlog','integration_backlog','runtime_repair_backlog') NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `acceptance_criteria_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`acceptance_criteria_json`)),
  `priority` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `target_item_status` ENUM('open','rolled_back') NOT NULL DEFAULT 'open',
  `source_payload_sha256` CHAR(64) NOT NULL,
  `metadata_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`metadata_json`)),
  `created_by` VARCHAR(255) NULL,
  `rolled_back_at` TIMESTAMP NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_backlog_target_item_id` (`target_item_id`),
  UNIQUE KEY `uq_session_insight_backlog_source_write` (`source_target_write_id`),
  KEY `idx_session_insight_backlog_surface_status` (`target_surface`, `target_item_status`, `created_at`),
  KEY `idx_session_insight_backlog_promotion` (`promotion_id`, `created_at`),
  CONSTRAINT `chk_session_insight_backlog_item_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `session_insight_backlog_target_writes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `target_write_id` VARCHAR(128) NOT NULL,
  `remaining_scope_completion_id` VARCHAR(128) NOT NULL,
  `adapter_execution_gate_id` VARCHAR(128) NOT NULL,
  `actual_request_id` VARCHAR(128) NOT NULL,
  `actual_capability_envelope_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `target_surface` ENUM('development_backlog','integration_backlog','runtime_repair_backlog') NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `target_item_id` VARCHAR(128) NOT NULL,
  `typed_confirm` VARCHAR(128) NOT NULL,
  `target_write_status` ENUM('target_write_executed','rolled_back') NOT NULL DEFAULT 'target_write_executed',
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 1,
  `target_write_executed` TINYINT(1) NOT NULL DEFAULT 1,
  `promotion_allowed` TINYINT(1) NOT NULL DEFAULT 1,
  `provider_call_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `credential_payload_read` TINYINT(1) NOT NULL DEFAULT 0,
  `external_write_executed` TINYINT(1) NOT NULL DEFAULT 0,
  `raw_transcript_included` TINYINT(1) NOT NULL DEFAULT 0,
  `source_remaining_scope_sha256` CHAR(64) NOT NULL,
  `source_payload_sha256` CHAR(64) NOT NULL,
  `write_payload_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`write_payload_json`)),
  `write_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`write_result_json`)),
  `rollback_plan_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`rollback_plan_json`)),
  `rollback_result_json` LONGTEXT NULL CHECK (`rollback_result_json` IS NULL OR JSON_VALID(`rollback_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `rolled_back_by` VARCHAR(255) NULL,
  `rolled_back_at` TIMESTAMP NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_backlog_target_write_id` (`target_write_id`),
  UNIQUE KEY `uq_session_insight_backlog_write_completion` (`remaining_scope_completion_id`),
  UNIQUE KEY `uq_session_insight_backlog_write_target_item` (`target_item_id`),
  KEY `idx_session_insight_backlog_write_surface` (`target_surface`, `target_write_status`, `created_at`),
  KEY `idx_session_insight_backlog_write_envelope` (`actual_capability_envelope_id`, `created_at`),
  CONSTRAINT `fk_session_insight_backlog_write_completion`
    FOREIGN KEY (`remaining_scope_completion_id`) REFERENCES `session_insight_capability_envelope_remaining_scope_completions` (`remaining_scope_completion_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `fk_session_insight_backlog_write_target_item`
    FOREIGN KEY (`target_item_id`) REFERENCES `session_insight_backlog_target_items` (`target_item_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_backlog_write_actual_write`
    CHECK (`target_write_allowed` = 1 AND `target_write_executed` = 1 AND `promotion_allowed` = 1),
  CONSTRAINT `chk_session_insight_backlog_write_no_external_or_secret`
    CHECK (`provider_call_executed` = 0 AND `credential_payload_read` = 0 AND `external_write_executed` = 0 AND `raw_transcript_included` = 0 AND `secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_backlog_target_write_issues` AS
SELECT
  w.target_write_id,
  w.remaining_scope_completion_id,
  w.target_surface,
  'target_write_secret_or_external_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('target_write_id', w.target_write_id, 'provider_call_executed', w.provider_call_executed, 'credential_payload_read', w.credential_payload_read, 'external_write_executed', w.external_write_executed, 'raw_transcript_included', w.raw_transcript_included, 'secrets_included', w.secrets_included) AS evidence_json
FROM `session_insight_backlog_target_writes` w
WHERE w.provider_call_executed <> 0
   OR w.credential_payload_read <> 0
   OR w.external_write_executed <> 0
   OR w.raw_transcript_included <> 0
   OR w.secrets_included <> 0
UNION ALL
SELECT
  w.target_write_id,
  w.remaining_scope_completion_id,
  w.target_surface,
  'target_write_missing_target_item' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('target_write_id', w.target_write_id, 'target_item_id', w.target_item_id, 'secrets_included', false) AS evidence_json
FROM `session_insight_backlog_target_writes` w
LEFT JOIN `session_insight_backlog_target_items` i ON i.target_item_id = w.target_item_id
WHERE i.target_item_id IS NULL
UNION ALL
SELECT
  w.target_write_id,
  w.remaining_scope_completion_id,
  w.target_surface,
  'target_write_source_completion_not_ready' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('target_write_id', w.target_write_id, 'completion_status', c.completion_status, 'completion_policy_status', c.completion_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_backlog_target_writes` w
JOIN `session_insight_capability_envelope_remaining_scope_completions` c ON c.remaining_scope_completion_id = w.remaining_scope_completion_id
WHERE c.completion_status <> 'remaining_scope_completed_as_gated_no_execution'
   OR c.completion_policy_status <> 'all_remaining_stages_gated_no_execution';

CREATE OR REPLACE VIEW `v_session_insight_backlog_target_write_readiness` AS
SELECT
  c.remaining_scope_completion_id,
  c.adapter_execution_gate_id,
  c.actual_request_id,
  c.promotion_id,
  c.insight_id,
  g.capability_plan_id,
  p.payload_preview_id,
  p.apply_request_id,
  p.target_surface,
  p.promotion_type,
  p.adapter_key,
  p.contract_key,
  c.actual_capability_envelope_id,
  latest.target_write_id,
  latest.target_item_id,
  latest.target_write_status,
  CASE
    WHEN c.completion_status <> 'remaining_scope_completed_as_gated_no_execution' THEN 'blocked_remaining_scope_not_completed'
    WHEN c.completion_policy_status <> 'all_remaining_stages_gated_no_execution' THEN 'blocked_remaining_scope_policy_not_ready'
    WHEN c.secrets_included <> 0 OR g.secrets_included <> 0 OR p.secrets_included <> 0 OR pp.secrets_included <> 0 THEN 'blocked_secret_flagged_source'
    WHEN pp.payload_status <> 'payload_preview_generated' THEN 'blocked_payload_preview_not_generated'
    WHEN JSON_EXTRACT(pp.validation_result_json, '$.valid_for_dry_run_contract') <> true THEN 'blocked_payload_contract_validation_failed'
    WHEN p.target_surface NOT IN ('development_backlog','integration_backlog','runtime_repair_backlog') THEN 'blocked_unknown_target_surface'
    WHEN latest.target_write_id IS NOT NULL THEN 'target_write_already_executed'
    ELSE 'ready_for_internal_backlog_target_write'
  END AS target_write_readiness_status,
  JSON_OBJECT(
    'remaining_scope_completion_id', c.remaining_scope_completion_id,
    'target_surface', p.target_surface,
    'target_write_id', latest.target_write_id,
    'internal_sql_target_write_supported', true,
    'provider_call_executed', false,
    'credential_payload_read', false,
    'external_write_executed', false,
    'raw_transcript_included', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_remaining_scope_completions` c
JOIN `session_insight_capability_envelope_adapter_execution_gates` g ON g.adapter_execution_gate_id = c.adapter_execution_gate_id
JOIN `session_insight_capability_envelope_plans` p ON p.capability_plan_id = g.capability_plan_id
JOIN `session_insight_promotion_payload_previews` pp ON pp.payload_preview_id = p.payload_preview_id
LEFT JOIN `session_insight_backlog_target_writes` latest ON latest.remaining_scope_completion_id = c.remaining_scope_completion_id
WHERE c.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_backlog_target_write_executor_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_backlog_target_write_executor_internal_sql_only',
         'tools',JSON_ARRAY('session_insight_backlog_target_write_execute','session_insight_backlog_target_write_list','session_insight_backlog_target_write_rollback'),
         'requires_typed_confirm','EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE',
         'rollback_typed_confirm','ROLLBACK_SESSION_INSIGHT_BACKLOG_TARGET_WRITE',
         'accepted_source','session_insight_capability_envelope_remaining_scope_completions',
         'target_table','session_insight_backlog_target_items',
         'target_write_allowed',true,
         'target_write_executed',true,
         'promotion_allowed',true,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|backlog_target_write|internal_sql_only',
       'session_insight_backlog_target_items|session_insight_backlog_target_writes|session_insight_capability_envelope_remaining_scope_completions|admin_platform_endpoint_tools',
       'TRUE',
       'Executes actual internal SQL backlog target writes only after capability-envelope approval/readback/remaining-scope completion. No provider, credential, raw transcript, external write, or secret surfaces are enabled.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_backlog_target_write_executor_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_backlog_target_write_execute',
    'Session Insight Backlog Target Write Execute',
    'Execute an actual internal SQL backlog target write from a completed Session Insight capability-envelope chain. Requires typed confirmation. No provider calls, no credential reads, no external writes, no raw transcripts, and no secrets.',
    'POST',
    '/platform/session-insight-promotions/backlog-target-writes/execute',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('remaining_scope_completion_id','typed_confirm'),'properties',JSON_OBJECT('remaining_scope_completion_id',JSON_OBJECT('type','string'),'typed_confirm',JSON_OBJECT('type','string','const','EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,actual_target_write,internal_sql,typed_confirm,no_provider,no_external_write,no_secrets',
    1,
    680
  ),
  (
    'session_insight_backlog_target_write_list',
    'Session Insight Backlog Target Write List',
    'List internal SQL backlog target writes and readback issues. Read-only.',
    'POST',
    '/platform/session-insight-promotions/backlog-target-writes/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('target_write_id',JSON_OBJECT('type','string'),'remaining_scope_completion_id',JSON_OBJECT('type','string'),'target_item_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,actual_target_write,read_only,no_secrets',
    1,
    681
  ),
  (
    'session_insight_backlog_target_write_rollback',
    'Session Insight Backlog Target Write Rollback',
    'Rollback an internal SQL backlog target write by marking the target item rolled_back. Requires typed confirmation. Does not delete data and does not call providers.',
    'POST',
    '/platform/session-insight-promotions/backlog-target-writes/rollback',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('target_write_id','typed_confirm'),'properties',JSON_OBJECT('target_write_id',JSON_OBJECT('type','string'),'typed_confirm',JSON_OBJECT('type','string','const','ROLLBACK_SESSION_INSIGHT_BACKLOG_TARGET_WRITE'),'rolled_back_by',JSON_OBJECT('type','string'),'rollback_reason',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,actual_target_write,rollback,typed_confirm,no_provider,no_external_write,no_secrets',
    1,
    682
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
