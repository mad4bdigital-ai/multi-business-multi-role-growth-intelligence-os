-- Sprint 68: Session insight capability envelope request review.
--
-- Adds approve/reject review for capability envelope request gates. Approval is
-- explicitly not dispatch: no capability resolution call, no approval hold, no
-- actual capability envelope, no adapter execution, no target write, and no
-- promotion_allowed=1. No raw transcripts. No secrets.

ALTER TABLE `session_insight_capability_envelope_request_gates`
  ADD COLUMN IF NOT EXISTS `reviewed_by` VARCHAR(255) NULL AFTER `created_by`,
  ADD COLUMN IF NOT EXISTS `reviewed_at` TIMESTAMP NULL AFTER `reviewed_by`,
  ADD COLUMN IF NOT EXISTS `review_notes` TEXT NULL AFTER `reviewed_at`;

CREATE TABLE IF NOT EXISTS `session_insight_capability_envelope_request_gate_review_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_event_id` VARCHAR(128) NOT NULL,
  `request_gate_id` VARCHAR(128) NOT NULL,
  `capability_plan_id` VARCHAR(128) NOT NULL,
  `payload_preview_id` VARCHAR(128) NOT NULL,
  `apply_request_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `event_type` ENUM('request_approved','request_rejected','review_note') NOT NULL,
  `request_review_status_before` VARCHAR(40) NULL,
  `request_policy_status_before` VARCHAR(80) NULL,
  `request_review_status_after` VARCHAR(40) NULL,
  `request_policy_status_after` VARCHAR(80) NULL,
  `reviewed_by` VARCHAR(255) NULL,
  `review_notes` TEXT NULL,
  `evidence_json` LONGTEXT NULL CHECK (`evidence_json` IS NULL OR JSON_VALID(`evidence_json`)),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_capability_request_review_event` (`review_event_id`),
  KEY `idx_session_insight_capability_request_review_gate` (`request_gate_id`, `created_at`),
  KEY `idx_session_insight_capability_request_review_plan` (`capability_plan_id`, `created_at`),
  CONSTRAINT `fk_session_insight_capability_request_review_gate`
    FOREIGN KEY (`request_gate_id`) REFERENCES `session_insight_capability_envelope_request_gates` (`request_gate_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_capability_request_review_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_request_review_queue` AS
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  g.promotion_id,
  g.insight_id,
  g.target_surface,
  g.promotion_type,
  g.capability_key,
  g.operation_intent,
  g.runtime_surface,
  g.request_gate_status,
  g.request_review_status,
  g.request_policy_status,
  g.actual_capability_envelope_requested,
  g.actual_capability_envelope_id,
  g.approval_hold_created,
  g.execution_allowed,
  g.target_write_allowed,
  g.created_by,
  g.reviewed_by,
  g.reviewed_at,
  g.created_at,
  CASE
    WHEN g.request_review_status = 'request_review_required'
     AND g.request_policy_status = 'blocked_until_request_gate_approved'
     AND g.actual_capability_envelope_requested = 0
     AND g.actual_capability_envelope_id IS NULL
     AND g.approval_hold_created = 0
     AND g.execution_allowed = 0
     AND g.target_write_allowed = 0
     AND g.secrets_included = 0
    THEN 'reviewable'
    WHEN g.request_review_status = 'request_approved'
     AND g.request_policy_status = 'request_approved_but_not_dispatched'
     AND g.actual_capability_envelope_requested = 0
     AND g.approval_hold_created = 0
     AND g.execution_allowed = 0
     AND g.target_write_allowed = 0
    THEN 'approved_but_not_dispatched'
    WHEN g.request_review_status = 'request_rejected' OR g.request_policy_status = 'rejected'
    THEN 'rejected'
    ELSE 'not_reviewable'
  END AS review_state,
  JSON_OBJECT(
    'request_gate_id', g.request_gate_id,
    'capability_plan_id', g.capability_plan_id,
    'review_only', true,
    'actual_capability_envelope_requested', false,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS review_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_request_gates` g
WHERE g.secrets_included = 0;

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_request_review_issues` AS
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  'approved_request_gate_claims_actual_envelope_or_execution' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('request_gate_id', g.request_gate_id, 'request_review_status', g.request_review_status, 'actual_capability_envelope_requested', g.actual_capability_envelope_requested, 'actual_capability_envelope_id', g.actual_capability_envelope_id, 'approval_hold_created', g.approval_hold_created, 'execution_allowed', g.execution_allowed, 'target_write_allowed', g.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_request_gates` g
WHERE g.request_review_status = 'request_approved'
  AND (g.actual_capability_envelope_requested <> 0
    OR g.actual_capability_envelope_id IS NOT NULL
    OR g.approval_hold_created <> 0
    OR g.execution_allowed <> 0
    OR g.target_write_allowed <> 0)
UNION ALL
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  'request_review_gate_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('request_gate_id', g.request_gate_id, 'secrets_included', g.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_request_gates` g
WHERE g.secrets_included <> 0
UNION ALL
SELECT
  e.request_gate_id,
  e.capability_plan_id,
  e.payload_preview_id,
  e.apply_request_id,
  'request_review_event_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('review_event_id', e.review_event_id, 'request_gate_id', e.request_gate_id, 'secrets_included', e.secrets_included) AS evidence_json
FROM `session_insight_capability_envelope_request_gate_review_events` e
WHERE e.secrets_included <> 0
UNION ALL
SELECT
  g.request_gate_id,
  g.capability_plan_id,
  g.payload_preview_id,
  g.apply_request_id,
  'approved_request_gate_not_approved_but_not_dispatched' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('request_gate_id', g.request_gate_id, 'request_review_status', g.request_review_status, 'request_policy_status', g.request_policy_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_capability_envelope_request_gates` g
WHERE g.request_review_status = 'request_approved'
  AND g.request_policy_status <> 'request_approved_but_not_dispatched';

CREATE OR REPLACE VIEW `v_session_insight_capability_envelope_request_dispatch_readiness` AS
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
  g.request_gate_status,
  g.request_review_status,
  g.request_policy_status,
  g.actual_capability_envelope_requested,
  g.approval_hold_created,
  g.execution_allowed,
  g.target_write_allowed,
  CASE
    WHEN g.request_review_status <> 'request_approved' THEN 'blocked_request_gate_not_approved'
    WHEN g.actual_capability_envelope_requested <> 0 OR g.approval_hold_created <> 0 OR g.execution_allowed <> 0 OR g.target_write_allowed <> 0 THEN 'invalid_request_gate_claims_dispatch_or_execution'
    ELSE 'request_gate_approved_but_dispatch_not_implemented'
  END AS dispatch_readiness_status,
  JSON_OBJECT(
    'request_gate_id', g.request_gate_id,
    'capability_plan_id', g.capability_plan_id,
    'capability_key', g.capability_key,
    'operation_intent', g.operation_intent,
    'runtime_surface', g.runtime_surface,
    'dispatch_not_implemented', true,
    'actual_capability_envelope_requested', false,
    'approval_hold_created', false,
    'adapter_apply_executed', false,
    'execution_allowed', false,
    'target_write_allowed', false,
    'secrets_included', false
  ) AS dispatch_readiness_evidence_json,
  0 AS secrets_included
FROM `session_insight_capability_envelope_request_gates` g
WHERE g.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_capability_envelope_request_review_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_capability_envelope_request_review_only',
         'tool','session_insight_capability_envelope_request_gate_review_decide',
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
       'session_memory|capability_envelope_request_review|review_gate',
       'session_insight_capability_envelope_request_gates|session_insight_capability_envelope_request_gate_review_events|admin_platform_endpoint_tools',
       'TRUE',
       'Capability envelope request gate review can approve/reject a request gate but approval never dispatches capability resolution.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_capability_envelope_request_review_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES (
  'session_insight_capability_envelope_request_gate_review_decide',
  'Session Insight Capability Envelope Request Gate Review Decide',
  'Approve or reject a capability envelope request gate. Approval is not dispatch: it never calls capability resolution, never creates approval holds, never requests actual capability envelopes, and never executes adapters or target writes.',
  'POST',
  '/platform/session-insight-promotions/capability-envelope-request-gates/review/decision',
  NULL,
  JSON_OBJECT('type','object','required',JSON_ARRAY('request_gate_id','decision'),'properties',JSON_OBJECT('request_gate_id',JSON_OBJECT('type','string'),'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approve','reject')),'reviewed_by',JSON_OBJECT('type','string'),'review_notes',JSON_OBJECT('type','string')),'additionalProperties',false),
  NULL,
  'admin,session_memory,capability_envelope_request_review,decision,no_dispatch,no_execution,no_secrets',
  1,
  664
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
