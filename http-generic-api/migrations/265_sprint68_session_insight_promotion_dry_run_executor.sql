-- Sprint 68: Session insight promotion dry-run executor.
--
-- Adds a preview/audit table, diagnostics view, policy seed, and admin tool
-- for dry-run execution previews of approved session insight promotion proposals.
--
-- This migration does not create backlog, policy, canonical, provider, credential,
-- or external writes. It never sets promotion_allowed=1 and never assigns a runtime
-- executor. It only records safe preview/audit artifacts.
--
-- Idempotent. Additive only. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_promotion_execution_previews` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `preview_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `execution_mode` ENUM('dry_run') NOT NULL DEFAULT 'dry_run',
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_status` ENUM('preview_generated','blocked','superseded') NOT NULL DEFAULT 'preview_generated',
  `proposed_write_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`proposed_write_json`)),
  `blockers_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`blockers_json`)),
  `dry_run_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`dry_run_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_promotion_execution_preview` (`preview_id`),
  KEY `idx_session_insight_promotion_execution_preview_promotion` (`promotion_id`, `created_at`),
  KEY `idx_session_insight_promotion_execution_preview_insight` (`insight_id`, `created_at`),
  KEY `idx_session_insight_promotion_execution_preview_surface` (`target_surface`, `execution_status`),
  CONSTRAINT `fk_session_insight_promotion_execution_preview_promotion`
    FOREIGN KEY (`promotion_id`) REFERENCES `session_insight_promotions` (`promotion_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_promotion_execution_preview_no_execution` CHECK (`execution_allowed` = 0),
  CONSTRAINT `chk_session_insight_promotion_execution_preview_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_promotion_execution_preview_issues` AS
SELECT
  e.preview_id,
  e.promotion_id,
  e.insight_id,
  e.promotion_type,
  e.target_surface,
  'execution_allowed_in_dry_run_preview' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('preview_id', e.preview_id, 'promotion_id', e.promotion_id, 'execution_allowed', e.execution_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_execution_previews` e
WHERE e.execution_allowed <> 0
UNION ALL
SELECT
  e.preview_id,
  e.promotion_id,
  e.insight_id,
  e.promotion_type,
  e.target_surface,
  'secret_flag_set_on_execution_preview' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('preview_id', e.preview_id, 'promotion_id', e.promotion_id, 'secrets_included', e.secrets_included) AS evidence_json
FROM `session_insight_promotion_execution_previews` e
WHERE e.secrets_included <> 0
UNION ALL
SELECT
  e.preview_id,
  e.promotion_id,
  e.insight_id,
  e.promotion_type,
  e.target_surface,
  'preview_without_approved_ready_promotion' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('preview_id', e.preview_id, 'promotion_id', e.promotion_id, 'approval_status', p.approval_status, 'promotion_status', p.promotion_status, 'decision_status', p.decision_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_execution_previews` e
LEFT JOIN `session_insight_promotions` p ON p.promotion_id = e.promotion_id
WHERE p.promotion_id IS NULL
   OR p.approval_status <> 'approved'
   OR p.decision_status <> 'approved'
   OR p.promotion_status <> 'ready'
UNION ALL
SELECT
  e.preview_id,
  e.promotion_id,
  e.insight_id,
  e.promotion_type,
  e.target_surface,
  'preview_claims_runtime_effect' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('preview_id', e.preview_id, 'promotion_id', e.promotion_id, 'safety_contract_json', JSON_EXTRACT(e.safety_contract_json, '$'), 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_execution_previews` e
WHERE JSON_EXTRACT(e.safety_contract_json, '$.runtime_promotion_executed') <> false
   OR JSON_EXTRACT(e.safety_contract_json, '$.backlog_policy_canonical_write_executed') <> false
   OR JSON_EXTRACT(e.safety_contract_json, '$.provider_call_executed') <> false
   OR JSON_EXTRACT(e.safety_contract_json, '$.external_write_executed') <> false;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_promotion_dry_run_executor_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_promotion_executor_dry_run_only',
         'tool','session_insight_promotion_executor_dry_run',
         'accepted_source_state','approved_ready',
         'execution_allowed',false,
         'sets_promotion_allowed',false,
         'assigns_executor',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'session_memory|promotion_executor|dry_run_preview',
       'session_insight_promotions|session_insight_promotion_execution_previews|admin_platform_endpoint_tools',
       'TRUE',
       'Dry-run executor previews approved/ready proposals only. It records preview/audit artifacts and never performs runtime promotion.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_promotion_dry_run_executor_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'session_insight_promotion_executor_dry_run',
  'Session Insight Promotion Executor Dry Run',
  'Preview where approved/ready session insight promotion proposals would go. Dry-run only: records optional preview audit rows, never executes promotions, never writes backlog/policy/canonicals, never calls providers, never reads credentials, and never returns secrets.',
  'POST',
  '/platform/session-insight-promotions/executor/dry-run',
  NULL,
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'promotion_id',JSON_OBJECT('type','string'),
      'promotion_type',JSON_OBJECT('type','string'),
      'target_surface',JSON_OBJECT('type','string'),
      'tenant_id',JSON_OBJECT('type','string'),
      'workspace_key',JSON_OBJECT('type','string'),
      'target_scope_type',JSON_OBJECT('type','string'),
      'target_scope_ref',JSON_OBJECT('type','string'),
      'record_preview',JSON_OBJECT('type','boolean','default',false),
      'created_by',JSON_OBJECT('type','string'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,session_memory,promotion_executor,dry_run,read_only,no_execution,no_secrets',
  1,
  652
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
