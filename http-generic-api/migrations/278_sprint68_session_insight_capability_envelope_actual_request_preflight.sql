-- Sprint 68: Session insight capability envelope actual request preflight.
--
-- Adds a preflight ledger for the first real capability envelope request step.
-- This layer validates an approved dispatch dry-run but still performs no real
-- dispatch: it does not call capability_resolution_envelope_create, does not
-- create approval holds, does not execute adapters, and never enables target
-- writes. No raw transcripts. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_actual_request_preflights` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actual_request_preflight_id` VARCHAR(128) NOT NULL,
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
  `preflight_status` ENUM('actual_request_preflight_passed','actual_request_preflight_blocked','superseded') NOT NULL DEFAULT 'actual_request_preflight_passed',
  `preflight_policy_status` ENUM('ready_for_actual_capability_envelope_request','blocked') NOT NULL DEFAULT 'ready_for_actual_capability_envelope_request',
  `actual_capability_envelope_requested` TINYINT(1) NOT NULL DEFAULT 0,
  `actual_capability_envelope_id` VARCHAR(128) NULL,
  `approval_hold_created` TINYINT(1) NOT NULL DEFAULT 0,
  `execution_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `target_write_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `source_dispatch_payload_sha256` CHAR(64) NOT NULL,
  `source_validation_sha256` CHAR(64) NOT NULL,
  `duplicate_live_envelope_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `preflight_result_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`preflight_result_json`)),
  `safety_contract_json` LONGTEXT NOT NULL CHECK (JSON_VALID(`safety_contract_json`)),
  `created_by` VARCHAR(255) NULL,
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_actual_request_preflight_id` (`actual_request_preflight_id`),
  KEY `idx_session_insight_actual_request_preflight_dispatch` (`dispatch_dry_run_id`, `created_at`),
  KEY `idx_session_insight_actual_request_preflight_gate` (`request_gate_id`, `created_at`),
  KEY `idx_session_insight_actual_request_preflight_status` (`preflight_status`, `preflight_policy_status`),
  CONSTRAINT `fk_session_insight_actual_request_preflight_dispatch`
    FOREIGN KEY (`dispatch_dry_run_id`) REFERENCES `session_insight_capability_envelope_dispatch_dry_runs` (`dispatch_dry_run_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_actual_request_preflight_no_execution`
    CHECK (`actual_capability_envelope_requested` = 0 AND `actual_capability_envelope_id` IS NULL AND `approval_hold_created` = 0 AND `execution_allowed` = 0 AND `target_write_allowed` = 0),
  CONSTRAINT `chk_session_insight_actual_request_preflight_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_actual_preflight_issues` AS
SELECT
  p.actual_request_preflight_id,
  p.dispatch_dry_run_id,
  p.request_gate_id,
  p.capability_plan_id,
  'actual_request_preflight_claims_actual_envelope_or_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_preflight_id', p.actual_request_preflight_id, 'actual_capability_envelope_requested', p.actual_capability_envelope_requested, 'actual_capability_envelope_id', p.actual_capability_envelope_id, 'approval_hold_created', p.approval_hold_created, 'execution_allowed', p.execution_allowed, 'target_write_allowed', p.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_request_preflights` p
WHERE p.actual_capability_envelope_requested <> 0
   OR p.actual_capability_envelope_id IS NOT NULL
   OR p.approval_hold_created <> 0
   OR p.execution_allowed <> 0
   OR p.target_write_allowed <> 0
UNION ALL
SELECT
  p.actual_request_preflight_id,
  p.dispatch_dry_run_id,
  p.request_gate_id,
  p.capability_plan_id,
  'actual_request_preflight_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_preflight_id', p.actual_request_preflight_id, 'secrets_included', p.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_actual_request_preflights` p
WHERE p.secrets_included <> 0
UNION ALL
SELECT
  p.actual_request_preflight_id,
  p.dispatch_dry_run_id,
  p.request_gate_id,
  p.capability_plan_id,
  'actual_request_preflight_source_dispatch_not_approved' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_preflight_id', p.actual_request_preflight_id, 'dispatch_review_status', d.dispatch_review_status, 'dispatch_policy_status', d.dispatch_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_request_preflights` p
JOIN `session_insight_capability_envelope_dispatch_dry_runs` d
  ON d.dispatch_dry_run_id = p.dispatch_dry_run_id
WHERE d.dispatch_review_status <> 'dispatch_dry_run_approved'
   OR d.dispatch_policy_status <> 'dispatch_dry_run_approved_but_not_dispatched'
UNION ALL
SELECT
  p.actual_request_preflight_id,
  p.dispatch_dry_run_id,
  p.request_gate_id,
  p.capability_plan_id,
  'actual_request_preflight_source_payload_changed' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_preflight_id', p.actual_request_preflight_id, 'stored_dispatch_payload_sha256', p.source_dispatch_payload_sha256, 'current_dispatch_payload_sha256', SHA2(d.dispatch_payload_json, 256), 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_request_preflights` p
JOIN `session_insight_capability_envelope_dispatch_dry_runs` d
  ON d.dispatch_dry_run_id = p.dispatch_dry_run_id
WHERE p.source_dispatch_payload_sha256 <> SHA2(d.dispatch_payload_json, 256)
UNION ALL
SELECT
  p.actual_request_preflight_id,
  p.dispatch_dry_run_id,
  p.request_gate_id,
  p.capability_plan_id,
  'actual_request_preflight_duplicate_live_envelope_detected' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('actual_request_preflight_id', p.actual_request_preflight_id, 'duplicate_live_envelope_count', p.duplicate_live_envelope_count, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_actual_request_preflights` p
WHERE p.duplicate_live_envelope_count <> 0;

CREATE OR REPLACE VIEW `v_session_insight_actual_preflight_readiness` AS
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  d.apply_request_id,
  d.promotion_id,
  d.promotion_type,
  d.target_surface,
  d.capability_key,
  d.operation_intent,
  d.runtime_surface,
  d.dispatch_review_status,
  d.dispatch_policy_status,
  latest.actual_request_preflight_id,
  latest.preflight_status,
  latest.preflight_policy_status,
  latest.duplicate_live_envelope_count,
  CASE
    WHEN d.dispatch_review_status <> 'dispatch_dry_run_approved' THEN 'blocked_dispatch_dry_run_not_approved'
    WHEN d.dispatch_policy_status <> 'dispatch_dry_run_approved_but_not_dispatched' THEN 'blocked_dispatch_policy_not_ready'
    WHEN latest.actual_request_preflight_id IS NULL THEN 'ready_for_actual_request_preflight'
    WHEN latest.preflight_status = 'actual_request_preflight_passed' AND latest.preflight_policy_status = 'ready_for_actual_capability_envelope_request' THEN 'actual_request_preflight_passed_no_dispatch'
    ELSE 'actual_request_preflight_blocked'
  END AS actual_request_preflight_readiness_status,
  JSON_OBJECT(
    'dispatch_dry_run_id', d.dispatch_dry_run_id,
    'actual_request_preflight_id', latest.actual_request_preflight_id,
    'capability_key', d.capability_key,
    'operation_intent', d.operation_intent,
    'runtime_surface', d.runtime_surface,
    'preflight_only', true,
    'actual_capability_envelope_requested', false,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
LEFT JOIN (
  SELECT p.*
    FROM `session_insight_capability_envelope_actual_request_preflights` p
    JOIN (
      SELECT dispatch_dry_run_id, MAX(id) AS max_id
        FROM `session_insight_capability_envelope_actual_request_preflights`
       WHERE secrets_included = 0
       GROUP BY dispatch_dry_run_id
    ) mx ON mx.max_id = p.id
) latest ON latest.dispatch_dry_run_id = d.dispatch_dry_run_id
WHERE d.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_actual_request_preflight_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_actual_request_preflight_only',
         'tools',JSON_ARRAY('session_insight_capability_envelope_actual_request_preflight_create','session_insight_capability_envelope_actual_request_preflight_list'),
         'accepted_source','session_insight_capability_envelope_dispatch_dry_runs',
         'requires_dispatch_review_status','dispatch_dry_run_approved',
         'requires_dispatch_policy_status','dispatch_dry_run_approved_but_not_dispatched',
         'calls_capability_resolution',false,
         'creates_actual_capability_envelope',false,
         'creates_approval_hold',false,
         'adapter_apply_executed',false,
         'sets_promotion_allowed',false,
         'sets_execution_allowed',false,
         'sets_target_write_allowed',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|capability_envelope_actual_request_preflight|dispatch_dry_run_approved',
       'session_insight_capability_envelope_actual_request_preflights|session_insight_capability_envelope_dispatch_dry_runs|admin_platform_endpoint_tools',
       'TRUE',
       'Actual capability envelope request preflight validates readiness but never calls capability resolution or creates actual envelopes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_actual_request_preflight_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_capability_envelope_actual_request_preflight_create',
    'Session Insight Capability Envelope Actual Request Preflight Create',
    'Create a preflight ledger for an approved dispatch dry-run before any actual capability envelope request. Does not call capability resolution and never creates approval holds or target writes.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-actual-requests/preflights/create',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('dispatch_dry_run_id'),'properties',JSON_OBJECT('dispatch_dry_run_id',JSON_OBJECT('type','string'),'created_by',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_actual_request_preflight,preflight,no_dispatch,no_execution,no_secrets',
    1,
    668
  ),
  (
    'session_insight_capability_envelope_actual_request_preflight_list',
    'Session Insight Capability Envelope Actual Request Preflight List',
    'List actual capability envelope request preflight rows. Read-only and no-dispatch.',
    'POST',
    '/platform/session-insight-promotions/capability-envelope-actual-requests/preflights/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('actual_request_preflight_id',JSON_OBJECT('type','string'),'dispatch_dry_run_id',JSON_OBJECT('type','string'),'request_gate_id',JSON_OBJECT('type','string'),'capability_plan_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'preflight_status',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,capability_envelope_actual_request_preflight,read_only,no_dispatch,no_execution,no_secrets',
    1,
    669
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
