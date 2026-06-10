-- Sprint 68: Session insight payload preview review.
--
-- Adds review/list/approve/reject surfaces for generated contract payload previews.
-- Review decisions never execute adapters, never allow target writes, never set
-- promotion_allowed=1, and never write backlog/policy/canonical/provider/
-- credential/external systems. No raw transcripts. No secrets.

ALTER TABLE `session_insight_promotion_payload_previews`
  ADD COLUMN IF NOT EXISTS `payload_review_status` ENUM('review_required','approved','rejected','not_required') NOT NULL DEFAULT 'review_required' AFTER `payload_status`,
  ADD COLUMN IF NOT EXISTS `payload_decision_status` ENUM('review_required','approved','rejected','not_required') NOT NULL DEFAULT 'review_required' AFTER `payload_review_status`,
  ADD COLUMN IF NOT EXISTS `approved_by` VARCHAR(255) NULL AFTER `created_by`,
  ADD COLUMN IF NOT EXISTS `approved_at` TIMESTAMP NULL AFTER `approved_by`,
  ADD COLUMN IF NOT EXISTS `rejected_by` VARCHAR(255) NULL AFTER `approved_at`,
  ADD COLUMN IF NOT EXISTS `rejected_at` TIMESTAMP NULL AFTER `rejected_by`,
  ADD COLUMN IF NOT EXISTS `decision_notes` TEXT NULL AFTER `rejected_at`;

CREATE TABLE IF NOT EXISTS `session_insight_payload_preview_review_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_event_id` VARCHAR(128) NOT NULL,
  `payload_preview_id` VARCHAR(128) NOT NULL,
  `apply_request_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `event_type` ENUM('approved','rejected','review_note') NOT NULL,
  `payload_review_status_before` VARCHAR(40) NULL,
  `payload_decision_status_before` VARCHAR(40) NULL,
  `payload_review_status_after` VARCHAR(40) NULL,
  `payload_decision_status_after` VARCHAR(40) NULL,
  `reviewed_by` VARCHAR(255) NULL,
  `review_notes` TEXT NULL,
  `evidence_json` LONGTEXT NULL CHECK (`evidence_json` IS NULL OR JSON_VALID(`evidence_json`)),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_payload_review_event` (`review_event_id`),
  KEY `idx_session_insight_payload_review_preview` (`payload_preview_id`, `created_at`),
  KEY `idx_session_insight_payload_review_apply_request` (`apply_request_id`, `created_at`),
  CONSTRAINT `fk_session_insight_payload_review_preview`
    FOREIGN KEY (`payload_preview_id`) REFERENCES `session_insight_promotion_payload_previews` (`payload_preview_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_payload_review_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_payload_preview_review_queue` AS
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.preview_id,
  p.promotion_id,
  p.insight_id,
  p.adapter_key,
  p.contract_key,
  p.target_surface,
  p.promotion_type,
  p.payload_status,
  p.payload_mode,
  p.payload_review_status,
  p.payload_decision_status,
  p.execution_allowed,
  p.target_write_allowed,
  p.created_by,
  p.approved_by,
  p.approved_at,
  p.rejected_by,
  p.rejected_at,
  p.created_at,
  CASE
    WHEN p.payload_review_status = 'review_required'
     AND p.payload_decision_status = 'review_required'
     AND p.payload_status = 'payload_preview_generated'
     AND p.payload_mode = 'dry_run_payload_preview'
     AND p.execution_allowed = 0
     AND p.target_write_allowed = 0
     AND p.secrets_included = 0
    THEN 'reviewable'
    WHEN p.payload_review_status = 'approved'
     AND p.payload_decision_status = 'approved'
     AND p.execution_allowed = 0
     AND p.target_write_allowed = 0
    THEN 'approved_payload_preview_blocked_for_apply_adapter'
    WHEN p.payload_review_status = 'rejected' OR p.payload_decision_status = 'rejected'
    THEN 'rejected'
    ELSE 'not_reviewable'
  END AS review_state,
  JSON_OBJECT(
    'payload_preview_id', p.payload_preview_id,
    'apply_request_id', p.apply_request_id,
    'execution_allowed', false,
    'target_write_allowed', false,
    'adapter_apply_executed', false,
    'raw_transcript_included', false,
    'secrets_included', false
  ) AS review_evidence_json,
  0 AS secrets_included
FROM `session_insight_promotion_payload_previews` p
WHERE p.secrets_included = 0;

CREATE OR REPLACE VIEW `v_session_insight_payload_preview_review_issues` AS
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  'approved_payload_preview_claims_execution_or_target_write' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', p.payload_preview_id, 'payload_review_status', p.payload_review_status, 'execution_allowed', p.execution_allowed, 'target_write_allowed', p.target_write_allowed, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_payload_previews` p
WHERE p.payload_review_status = 'approved'
  AND (p.execution_allowed <> 0 OR p.target_write_allowed <> 0)
UNION ALL
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  'payload_preview_review_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', p.payload_preview_id, 'secrets_included', p.secrets_included) AS evidence_json
FROM `session_insight_promotion_payload_previews` p
WHERE p.secrets_included <> 0
UNION ALL
SELECT
  e.payload_preview_id,
  e.apply_request_id,
  e.promotion_id,
  'payload_preview_review_event_secret_flagged' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('review_event_id', e.review_event_id, 'payload_preview_id', e.payload_preview_id, 'secrets_included', e.secrets_included) AS evidence_json
FROM `session_insight_payload_preview_review_events` e
WHERE e.secrets_included <> 0
UNION ALL
SELECT
  p.payload_preview_id,
  p.apply_request_id,
  p.promotion_id,
  'payload_preview_approved_but_contract_invalid' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('payload_preview_id', p.payload_preview_id, 'validation_result_json', JSON_EXTRACT(p.validation_result_json, '$'), 'secrets_included', false) AS evidence_json
FROM `session_insight_promotion_payload_previews` p
WHERE p.payload_review_status = 'approved'
  AND JSON_EXTRACT(p.validation_result_json, '$.valid_for_dry_run_contract') <> true;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_payload_preview_review_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_payload_preview_review_only',
         'tools',JSON_ARRAY('session_insight_payload_preview_review_list','session_insight_payload_preview_review_decide'),
         'allowed_decisions',JSON_ARRAY('approve','reject'),
         'approval_sets_execution_allowed',false,
         'approval_sets_target_write_allowed',false,
         'adapter_apply_executed',false,
         'writes_backlog_policy_or_canonical',false,
         'provider_calls_allowed',false,
         'credential_payload_reads_allowed',false,
         'external_writes_allowed',false,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'TRUE',
       'session_memory|payload_preview_review|dry_run_contract',
       'session_insight_promotion_payload_previews|session_insight_payload_preview_review_events|admin_platform_endpoint_tools',
       'TRUE',
       'Payload preview review may approve/reject generated dry-run payloads only. Approval never enables target writes.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_payload_preview_review_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_payload_preview_review_list',
    'Session Insight Payload Preview Review List',
    'List generated payload previews for review. Read-only: never executes adapters, never writes target surfaces, never calls providers, never reads credentials, and never returns secrets.',
    'POST',
    '/platform/session-insight-promotions/payload-preview/review/list',
    NULL,
    JSON_OBJECT('type','object','properties',JSON_OBJECT('payload_preview_id',JSON_OBJECT('type','string'),'apply_request_id',JSON_OBJECT('type','string'),'promotion_id',JSON_OBJECT('type','string'),'promotion_type',JSON_OBJECT('type','string'),'target_surface',JSON_OBJECT('type','string'),'adapter_key',JSON_OBJECT('type','string'),'contract_key',JSON_OBJECT('type','string'),'payload_review_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('review_required','approved','rejected','not_required')),'q',JSON_OBJECT('type','string'),'include_payload',JSON_OBJECT('type','boolean','default',false),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)),'additionalProperties',false),
    NULL,
    'admin,session_memory,payload_preview_review,read_only,no_execution,no_secrets',
    1,
    657
  ),
  (
    'session_insight_payload_preview_review_decide',
    'Session Insight Payload Preview Review Decide',
    'Approve or reject a generated payload preview. Approval keeps execution_allowed=0 and target_write_allowed=0. No adapter execution and no target writes are performed.',
    'POST',
    '/platform/session-insight-promotions/payload-preview/review/decision',
    NULL,
    JSON_OBJECT('type','object','required',JSON_ARRAY('payload_preview_id','decision'),'properties',JSON_OBJECT('payload_preview_id',JSON_OBJECT('type','string'),'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approve','reject')),'reviewed_by',JSON_OBJECT('type','string'),'review_notes',JSON_OBJECT('type','string')),'additionalProperties',false),
    NULL,
    'admin,session_memory,payload_preview_review,decision,no_execution,no_secrets',
    1,
    658
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
