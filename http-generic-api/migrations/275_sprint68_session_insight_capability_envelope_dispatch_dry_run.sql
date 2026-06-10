-- Sprint 68: Session insight capability envelope dispatch dry-run.
--
-- Adds a dry-run-only dispatch payload ledger for approved request gates. This
-- never calls capability resolution, never creates approval holds, never creates
-- actual capability envelopes, never executes adapters, never enables target
-- writes, and never sets promotion_allowed=1. No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_dispatch_dry_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `dispatch_dry_run_id` VARCHAR(128) NOT NULL,
  `request_gate_id` VARCHAR(128) NOT NULL,
  `capability_plan_id` VARCHAR(128) NOT NULL,
  `payload_preview_id` VARCHAR(128) NOT NULL,
  `apply_request_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `target_surface` VARCHAR(96) NOT NULL,
  `promotion_type` VARCHAR(64) NOT NULL,
  `capability_key` VARCHAR(128) NOT NULL,
  `operation_intent` VARCHAR(128) NOT NULL,
  `runtime_surface` VARCHAR(128) NOT NULL,
  `dispatch_status` ENUM('dispatch_dry_run_generated','superseded','rejected') NOT NULL DEFAULT 'dispatch_dry_run_generated',
  `dispatch_mode` ENUM('dry_run_no_dispatch') NOT NULL DEFAULT 'dry_run_no_dispatch',
  `actual_capability_envelope_requested` TINYINT(1) NOT NULL DEFAULT 0,
  `actual_capability_envelope_id` VARCHAR(128) NULL,
  `approval_hold_created` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `dispatch_payload_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`dispatch_payload_json`)),
  `validation_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`validation_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_capability_dispatch_dry_run_id` (`dispatch_dry_run_id`),
  KEY `idx_session_insight_capability_dispatch_request_gate` (`request_gate_id`, `created_at`),
  KEY `idx_session_insight_capability_dispatch_plan` (`capability_plan_id`, `created_at`),
  KEY `idx_session_insight_capability_dispatch_status` (`dispatch_status`, `dispatch_mode`),
  CONSTRAINT `fk_session_insight_capability_dispatch_request_gate`
    FOREIGN KEY (`request_gate_id`) REFERENCES `session_insight_capability_envelope_request_gates` (`request_gate_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_capability_dispatch_no_execution`
    CHECK (`actual_capability_envelope_requested` = 0 AND `actual_capability_envelope_id` IS NULL AND `approval_hold_created` = 0 AND `execution_allowed` = 0 AND `target_write_allowed` = 0),
  CONSTRAINT `chk_session_insight_capability_dispatch_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_dispatch_dry_run_issues` AS
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  'dispatch_dry_run_claims_actual_envelope_or_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_dry_run_id', d.dispatch_dry_run_id, 'actual_capability_envelope_requested', d.actual_capability_envelope_requested, 'actual_capability_envelope_id', d.actual_capability_envelope_id, 'approval_hold_created', d.approval_hold_created, 'execution_allowed', d.execution_allowed, 'target_write_allowed', d.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
WHERE d.actual_capability_envelope_requested <> 0
   OR d.actual_capability_envelope_id IS NOT NULL
   OR d.approval_hold_created <> 0
   OR d.execution_allowed <> 0
   OR d.target_write_allowed <> 0
UNION ALL
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  'dispatch_dry_run_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_dry_run_id', d.dispatch_dry_run_id, 'secrets_included', d.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
WHERE d.secrets_included <> 0
UNION ALL
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  'dispatch_dry_run_source_gate_not_approved' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_dry_run_id', d.dispatch_dry_run_id, 'request_review_status', g.request_review_status, 'request_policy_status', g.request_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
JOIN `session_insight_capability_envelope_request_gates` g
  ON g.request_gate_id = d.request_gate_id
WHERE g.request_review_status <> 'request_approved'
   OR g.request_policy_status <> 'request_approved_but_not_dispatched'
UNION ALL
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  'dispatch_dry_run_claims_real_dispatch' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_dry_run_id', d.dispatch_dry_run_id, 'dispatch_payload_json', JSON_EXTRACT(d.dispatch_payload_json, '$'), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
WHERE JSON_EXTRACT(d.dispatch_payload_json, '$.dispatch_not_called') <> true
   OR JSON_EXTRACT(d.dispatch_payload_json, '$.actual_capability_envelope_requested') <> false
   OR JSON_EXTRACT(d.dispatch_payload_json, '$.approval_hold_created') <> false
   OR JSON_EXTRACT(d.dispatch_payload_json, '$.adapter_apply_executed') <> false;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_dispatch_dry_run_readiness` AS
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  g.promotion_id,
  g.promotion_type,
  g.target_surface,
  g.capability_key,
  g.operation_intent,
  g.runtime_surface,
  g.request_review_status,
  g.request_policy_status,
  latest.dispatch_dry_run_id,
  latest.dispatch_status,
  latest.dispatch_mode,
  latest.actual_capability_envelope_requested,
  latest.approval_hold_created,
  latest.execution_allowed,
  latest.target_write_allowed,
  CASE
    WHEN g.request_review_status <> 'request_approved' OR g.request_policy_status <> 'request_approved_but_not_dispatched' THEN 'blocked_request_gate_not_approved_for_dispatch_dry_run'
    WHEN latest.dispatch_dry_run_id IS NULL THEN 'ready_for_dispatch_dry_run'
    WHEN latest.actual_capability_envelope_requested <> 0 OR latest.approval_hold_created <> 0 OR latest.execution_allowed <> 0 OR latest.target_write_allowed <> 0 THEN 'invalid_dispatch_dry_run_claims_execution'
    ELSE 'dispatch_dry_run_generated_no_dispatch'
  END AS dispatch_dry_run_readiness_status,
  JSON_OBJECT(
    'request_gate_id', g.request_gate_id,
    'dispatch_dry_run_id', latest.dispatch_dry_run_id,
    'capability_key', g.capability_key,
    'operation_intent', g.operation_intent,
    'runtime_surface', g.runtime_surface,
    'dry_run_only', true,
    'actual_capability_envelope_requested', false,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_request_gates` g
LEFT JOIN (
  SELECT d.*
    FROM `session_insight_capability_envelope_dispatch_dry_runs` d
    JOIN (
      SELECT request_gate_id, MAX(id) AS max_id
        FROM `session_insight_capability_envelope_dispatch_dry_runs`
       WHERE secrets_included = 0
       GROUP BY request_gate_id
    ) mx ON mx.max_id = d.id
) latest ON latest.request_gate_id = g.request_gate_id
WHERE g.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_dispatch_dry_run_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_dispatch_dry_run_only',
         'tools',JSON_ARRAY('session_insight_capability_envelope_dispatch_dry_run_create','session_insight_capability_envelope_dispatch_dry_run_list'),
         'accepted_source','session_insight_capability_envelope_request_gates',
         'requires_request_review_status','request_approved',
         'requires_request_policy_status','request_approved_but_not_dispatched',
         'calls_capability_resolution',false,
         'creates_actual_capability_envelope',false,
         'creates_approval_hold',false,
         'adapter_apply_executed',false,
         'sets_promotion_allowed',false,
         'sets_execution_allowed',false,
         'sets_target_write_allowed',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|capability_envelope_dispatch_dry_run|request_gate_approved',
       'session_insight_capability_envelope_dispatch_dry_runs|session_insight_capability_envelope_request_gates|admin_platform_endpoint_tools',
       'TRUE',
       'Capability envelope dispatch dry-run generates dispatch payloads without calling capability resolution or creating approval holds.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_dispatch_dry_run_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_capability_envelope_dispatch_dry_run_create',
    'Session Insight Capability Envelope Dispatch Dry Run Create',
    'Generate a dry-run dispatch payload for an approved capability envelope request gate. Does not call capability resolution, does not create approval holds, and never executes adapters or target writes.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-dispatch-dry-runs/create',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('request_gate_id'),'properties',JSON_OBJECT('request_gate_id',JSON_OBJECT('type','string'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_dispatch_dry_run,dry_run,no_dispatch,no_execution,no_secrets',
    1,
    665
  ),
  (
    'session_insight_capability_envelope_dispatch_dry_run_list',
    'Session Insight Capability Envelope Dispatch Dry Run List',
    'List dry-run dispatch payloads. Read-only and does not call capability resolution, does not create approval holds, and never executes adapters or target writes.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-dispatch-dry-runs/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('dispatch_dry_run_id',JSON_OBJECT('type','string'),'request_gate_id',JSON_OBJECT('type','string'),'capability_plan_id',JSON_OBJECT('type','string'),'payload_preview_id',JSON_OBJECT('type','string'),'apply_request_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'capability_key',JSON_OBJECT('type','string'),'dispatch_status',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_dispatch_dry_run,read_only,no_dispatch,no_execution,no_secrets',
    1,
    666
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
