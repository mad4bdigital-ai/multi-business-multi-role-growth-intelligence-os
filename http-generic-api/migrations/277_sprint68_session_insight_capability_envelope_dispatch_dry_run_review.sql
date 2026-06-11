-- Sprint 68: Session insight capability envelope dispatch dry-run review.
--
-- Adds an explicit review/decision gate for capability envelope dispatch dry-runs.
-- Approval is still not dispatch: no capability resolution call, no approval hold,
-- no actual capability envelope, no adapter execution, no target write, and no
-- promotion_allowed=1. No raw transcripts. No secrets.

ALTER TABLE `session_insight_capability_envelope_dispatch_dry_runs`
  ADD COLUMN IF NOT EXISTS `dispatch_review_status` ENUM('dispatch_dry_run_review_required','dispatch_dry_run_approved','dispatch_dry_run_rejected') NOT NULL DEFAULT 'dispatch_dry_run_review_required' AFTER `dispatch_mode`,
  ADD COLUMN IF NOT EXISTS `dispatch_policy_status` ENUM('blocked_until_dispatch_dry_run_approved','dispatch_dry_run_approved_but_not_dispatched','rejected') NOT NULL DEFAULT 'blocked_until_dispatch_dry_run_approved' AFTER `dispatch_review_status`,
  ADD COLUMN IF NOT EXISTS `reviewed_by` VARCHAR(255) NULL AFTER `created_by`,
  ADD COLUMN IF NOT EXISTS `reviewed_at` TIMESTAMP NULL AFTER `reviewed_by`,
  ADD COLUMN IF NOT EXISTS `review_notes` TEXT NULL AFTER `reviewed_at`;

CREATE TABLE IF NOT EXISTS `session_insight_dispatch_dry_run_review_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_event_id` VARCHAR(128) NOT NULL,
  `dispatch_dry_run_id` VARCHAR(128) NOT NULL,
  `request_gate_id` VARCHAR(128) NOT NULL,
  `capability_plan_id` VARCHAR(128) NOT NULL,
  `payload_preview_id` VARCHAR(128) NOT NULL,
  `apply_request_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `event_type` ENUM('dispatch_dry_run_approved','dispatch_dry_run_rejected','review_note') NOT NULL,
  `dispatch_review_status_before` VARCHAR(64) NULL,
  `dispatch_policy_status_before` VARCHAR(96) NULL,
  `dispatch_status_before` VARCHAR(64) NULL,
  `dispatch_review_status_after` VARCHAR(64) NULL,
  `dispatch_policy_status_after` VARCHAR(96) NULL,
  `dispatch_status_after` VARCHAR(64) NULL,
  `reviewed_by` VARCHAR(255) NULL,
  `review_notes` TEXT NULL,
  `evidence_json` LONGTEXT NULL CHECK (`evidence_json` IS NULL OR JSON_VALID(`evidence_json`)),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_capability_dispatch_review_event` (`review_event_id`),
  KEY `idx_session_insight_capability_dispatch_review_dry_run` (`dispatch_dry_run_id`, `created_at`),
  KEY `idx_session_insight_capability_dispatch_review_gate` (`request_gate_id`, `created_at`),
  KEY `idx_session_insight_capability_dispatch_review_plan` (`capability_plan_id`, `created_at`),
  CONSTRAINT `fk_session_insight_capability_dispatch_review_dry_run`
    FOREIGN KEY (`dispatch_dry_run_id`) REFERENCES `session_insight_capability_envelope_dispatch_dry_runs` (`dispatch_dry_run_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_capability_dispatch_review_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_dispatch_dry_run_review_queue` AS
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  d.apply_request_id,
  d.promotion_id,
  d.insight_id,
  d.target_surface,
  d.promotion_type,
  d.capability_key,
  d.operation_intent,
  d.runtime_surface,
  d.dispatch_status,
  d.dispatch_mode,
  d.dispatch_review_status,
  d.dispatch_policy_status,
  d.actual_capability_envelope_requested,
  d.actual_capability_envelope_id,
  d.approval_hold_created,
  d.execution_allowed,
  d.target_write_allowed,
  d.created_by,
  d.reviewed_by,
  d.reviewed_at,
  d.created_at,
  g.request_review_status,
  g.request_policy_status,
  CASE
    WHEN d.dispatch_status = 'dispatch_dry_run_generated'
     AND d.dispatch_mode = 'dry_run_no_dispatch'
     AND d.dispatch_review_status = 'dispatch_dry_run_review_required'
     AND d.dispatch_policy_status = 'blocked_until_dispatch_dry_run_approved'
     AND d.actual_capability_envelope_requested = 0
     AND d.actual_capability_envelope_id IS NULL
     AND d.approval_hold_created = 0
     AND d.execution_allowed = 0
     AND d.target_write_allowed = 0
     AND d.secrets_included = 0
     AND g.request_review_status = 'request_approved'
     AND g.request_policy_status = 'request_approved_but_not_dispatched'
    THEN 'reviewable'
    WHEN d.dispatch_review_status = 'dispatch_dry_run_approved'
     AND d.dispatch_policy_status = 'dispatch_dry_run_approved_but_not_dispatched'
     AND d.actual_capability_envelope_requested = 0
     AND d.approval_hold_created = 0
     AND d.execution_allowed = 0
     AND d.target_write_allowed = 0
    THEN 'approved_but_not_dispatched'
    WHEN d.dispatch_review_status = 'dispatch_dry_run_rejected'
      OR d.dispatch_policy_status = 'rejected'
      OR d.dispatch_status = 'rejected'
    THEN 'rejected'
    ELSE 'not_reviewable'
  END AS review_state,
  JSON_OBJECT(
    'dispatch_dry_run_id', d.dispatch_dry_run_id,
    'request_gate_id', d.request_gate_id,
    'capability_plan_id', d.capability_plan_id,
    'review_only', true,
    'dispatch_not_called', true,
    'actual_capability_envelope_requested', false,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS review_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
JOIN `session_insight_capability_envelope_request_gates` g
  ON g.request_gate_id = d.request_gate_id
WHERE d.secrets_included = 0
  AND g.secrets_included = 0;

CREATE OR REPLACE VIEW `v_session_insight_dispatch_dry_run_review_issues` AS
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  'approved_dispatch_dry_run_claims_actual_envelope_or_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_dry_run_id', d.dispatch_dry_run_id, 'dispatch_review_status', d.dispatch_review_status, 'actual_capability_envelope_requested', d.actual_capability_envelope_requested, 'actual_capability_envelope_id', d.actual_capability_envelope_id, 'approval_hold_created', d.approval_hold_created, 'execution_allowed', d.execution_allowed, 'target_write_allowed', d.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
WHERE d.dispatch_review_status = 'dispatch_dry_run_approved'
  AND (d.actual_capability_envelope_requested <> 0
    OR d.actual_capability_envelope_id IS NOT NULL
    OR d.approval_hold_created <> 0
    OR d.execution_allowed <> 0
    OR d.target_write_allowed <> 0)
UNION ALL
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  'dispatch_dry_run_review_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_dry_run_id', d.dispatch_dry_run_id, 'secrets_included', d.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
WHERE d.secrets_included <> 0
UNION ALL
SELECT
  e.dispatch_dry_run_id,
  e.request_gate_id,
  e.capability_plan_id,
  e.payload_preview_id,
  'dispatch_dry_run_review_event_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('review_event_id', e.review_event_id, 'dispatch_dry_run_id', e.dispatch_dry_run_id, 'secrets_included', e.secrets_included) AS evidence_json
FROM `session_insight_dispatch_dry_run_review_events` e
WHERE e.secrets_included <> 0
UNION ALL
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  'approved_dispatch_dry_run_not_approved_but_not_dispatched' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_dry_run_id', d.dispatch_dry_run_id, 'dispatch_review_status', d.dispatch_review_status, 'dispatch_policy_status', d.dispatch_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
WHERE d.dispatch_review_status = 'dispatch_dry_run_approved'
  AND d.dispatch_policy_status <> 'dispatch_dry_run_approved_but_not_dispatched'
UNION ALL
SELECT
  d.dispatch_dry_run_id,
  d.request_gate_id,
  d.capability_plan_id,
  d.payload_preview_id,
  'approved_dispatch_dry_run_source_gate_not_approved' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('dispatch_dry_run_id', d.dispatch_dry_run_id, 'request_gate_id', g.request_gate_id, 'request_review_status', g.request_review_status, 'request_policy_status', g.request_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
JOIN `session_insight_capability_envelope_request_gates` g
  ON g.request_gate_id = d.request_gate_id
WHERE d.dispatch_review_status = 'dispatch_dry_run_approved'
  AND (g.request_review_status <> 'request_approved'
    OR g.request_policy_status <> 'request_approved_but_not_dispatched');

CREATE OR REPLACE VIEW `v_session_insight_actual_request_readiness` AS
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
  d.actual_capability_envelope_requested,
  d.approval_hold_created,
  d.execution_allowed,
  d.target_write_allowed,
  CASE
    WHEN d.dispatch_review_status <> 'dispatch_dry_run_approved' THEN 'blocked_dispatch_dry_run_not_approved'
    WHEN d.dispatch_policy_status <> 'dispatch_dry_run_approved_but_not_dispatched' THEN 'blocked_dispatch_policy_not_approved_but_not_dispatched'
    WHEN d.actual_capability_envelope_requested <> 0 OR d.approval_hold_created <> 0 OR d.execution_allowed <> 0 OR d.target_write_allowed <> 0 THEN 'invalid_dispatch_dry_run_claims_dispatch_or_execution'
    ELSE 'ready_for_actual_capability_envelope_request_preflight'
  END AS actual_request_readiness_status,
  JSON_OBJECT(
    'dispatch_dry_run_id', d.dispatch_dry_run_id,
    'request_gate_id', d.request_gate_id,
    'capability_plan_id', d.capability_plan_id,
    'capability_key', d.capability_key,
    'operation_intent', d.operation_intent,
    'runtime_surface', d.runtime_surface,
    'actual_dispatch_not_implemented', true,
    'actual_capability_envelope_requested', false,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS actual_request_readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_dispatch_dry_runs` d
WHERE d.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_dispatch_dry_run_review_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_dispatch_dry_run_review_only',
         'tool','session_insight_capability_envelope_dispatch_dry_run_review_decide',
         'allowed_decisions',JSON_ARRAY('approve','reject'),
         'approval_dispatches_actual_capability_envelope',false,
         'approval_creates_approval_hold',false,
         'approval_sets_execution_allowed',false,
         'approval_sets_target_write_allowed',false,
         'sets_promotion_allowed',false,
         'assigns_executor',false,
         'adapter_apply_executed',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|capability_envelope_dispatch_dry_run_review|review_gate',
       'session_insight_capability_envelope_dispatch_dry_runs|session_insight_dispatch_dry_run_review_events|admin_platform_endpoint_tools',
       'TRUE',
       'Capability envelope dispatch dry-run review can approve/reject a dry-run but approval never dispatches capability resolution.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_dispatch_dry_run_review_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'session_insight_capability_envelope_dispatch_dry_run_review_decide',
  'Session Insight Capability Envelope Dispatch Dry Run Review Decide',
  'Approve or reject a capability envelope dispatch dry-run. Approval is not dispatch: it never calls capability resolution, never creates approval holds, never requests actual capability envelopes, and never executes adapters or target writes.',
  'POST',
  '/platform/session-insight-promotions/capability-envelope-dispatch-dry-runs/review/decision',
  NULL,
  JSON_OBJECT('type','object','required',JSON_ARRAY('dispatch_dry_run_id','decision'),'properties',JSON_OBJECT('dispatch_dry_run_id',JSON_OBJECT('type','string'),'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approve','reject')),'reviewed_by',JSON_OBJECT('type','string'),'review_notes',JSON_OBJECT('type','string')),'additionalProperties',false),
  NULL,
  'admin,session_memory,capability_envelope_dispatch_dry_run_review,decision,no_dispatch,no_execution,no_secrets',
  1,
  667
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
