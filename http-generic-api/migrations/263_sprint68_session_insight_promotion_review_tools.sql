-- Sprint 68: Session insight promotion review tools.
--
-- Adds a review event ledger, a sanitized review queue view, and admin tool
-- registry rows for listing and approve/reject decisions on review-gated
-- session insight promotion proposals.
--
-- Review decisions never execute promotions, never assign executors, never set
-- promotion_allowed=1, never write backlog/policy/canonical surfaces, and never
-- include raw transcripts or secrets.
--
-- Idempotent. Additive only. No secrets.

CREATE TABLE IF NOT EXISTS `session_insight_promotion_review_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `review_event_id` VARCHAR(128) NOT NULL,
  `promotion_id` VARCHAR(96) NOT NULL,
  `insight_id` VARCHAR(96) NOT NULL,
  `event_type` ENUM('approved','rejected','review_note') NOT NULL,
  `decision_status_before` VARCHAR(40) NULL,
  `approval_status_before` VARCHAR(40) NULL,
  `promotion_status_before` VARCHAR(40) NULL,
  `decision_status_after` VARCHAR(40) NULL,
  `approval_status_after` VARCHAR(40) NULL,
  `promotion_status_after` VARCHAR(40) NULL,
  `reviewed_by` VARCHAR(255) NULL,
  `review_notes` TEXT NULL,
  `evidence_json` LONGTEXT NULL CHECK (`evidence_json` IS NULL OR JSON_VALID(`evidence_json`)),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_promotion_review_event` (`review_event_id`),
  KEY `idx_session_insight_promotion_review_promotion` (`promotion_id`, `created_at`),
  KEY `idx_session_insight_promotion_review_insight` (`insight_id`, `created_at`),
  CONSTRAINT `fk_session_insight_promotion_review_promotion`
    FOREIGN KEY (`promotion_id`) REFERENCES `session_insight_promotions` (`promotion_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT `chk_session_insight_promotion_review_no_secrets` CHECK (`secrets_included` = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_promotion_review_queue` AS
SELECT
  p.promotion_id,
  p.insight_id,
  c.insight_type,
  p.source_session_id,
  p.source_summary_id,
  p.tenant_id,
  p.user_id,
  p.workspace_key,
  p.promotion_type,
  p.target_surface,
  p.target_ref,
  p.target_scope_type,
  p.target_scope_ref,
  p.proposal_title,
  p.proposal_text,
  p.decision_status,
  p.approval_status,
  p.promotion_status,
  p.risk_level,
  p.confidence,
  p.requires_human_approval,
  p.promotion_allowed,
  p.promotion_executor_key,
  p.created_at,
  p.updated_at,
  CASE
    WHEN p.decision_status = 'review_required'
     AND p.approval_status = 'review_required'
     AND p.promotion_status = 'queued'
     AND p.secrets_included = 0
     AND p.promotion_allowed = 0
    THEN 'reviewable'
    WHEN p.approval_status = 'approved' AND p.promotion_status = 'ready' AND p.promotion_allowed = 0
    THEN 'approved_pending_executor_layer'
    WHEN p.approval_status = 'rejected' OR p.promotion_status = 'rejected'
    THEN 'rejected'
    ELSE 'not_reviewable'
  END AS review_state,
  JSON_OBJECT(
    'promotion_id', p.promotion_id,
    'insight_id', p.insight_id,
    'promotion_allowed', p.promotion_allowed,
    'executor_assigned', COALESCE(NULLIF(p.promotion_executor_key, ''), '') <> '',
    'raw_transcript_included', false,
    'secrets_included', false
  ) AS review_evidence_json,
  0 AS secrets_included
FROM `session_insight_promotions` p
LEFT JOIN `session_insight_candidates` c ON c.insight_id = p.insight_id
WHERE p.secrets_included = 0;

INSERT INTO `execution_policies` (
  `policy_group`, `policy_key`, `policy_value`, `active`,
  `execution_scope`, `affects_layer`, `blocking`, `notes`
)
SELECT 'Session Memory Governance', 'session_insight_promotion_review_policy_v1',
       JSON_OBJECT(
         'rule','session_insight_promotion_review_only',
         'tools',JSON_ARRAY('session_insight_promotion_review_list','session_insight_promotion_review_decide'),
         'allowed_decisions',JSON_ARRAY('approve','reject'),
         'approval_sets_promotion_allowed',false,
         'runtime_promotion_executed',false,
         'writes_backlog_policy_or_canonical',false,
         'executor_layer_required',true,
         'raw_transcript_included',false,
         'secrets_included',false
       ),
       'session_memory|promotion_review|insight_governance',
       'session_insight_promotions|session_insight_promotion_review_events|admin_platform_endpoint_tools',
       'TRUE',
       'Review tools may approve or reject proposals only. Runtime promotion remains disabled until a separate executor layer is added.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Session Memory Governance'
     AND `policy_key`='session_insight_promotion_review_policy_v1'
);

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
  (
    'session_insight_promotion_review_list',
    'Session Insight Promotion Review List',
    'List sanitized review-gated session insight promotion proposals. Read-only. Does not execute promotions, does not return secrets, and does not include raw transcripts.',
    'POST',
    '/platform/session-insight-promotions/review/list',
    NULL,
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'promotion_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('queued','ready','rejected','promoted','superseded')),
        'approval_status',JSON_OBJECT('type','string','enum',JSON_ARRAY('review_required','approved','rejected','not_required')),
        'promotion_type',JSON_OBJECT('type','string'),
        'target_surface',JSON_OBJECT('type','string'),
        'tenant_id',JSON_OBJECT('type','string'),
        'workspace_key',JSON_OBJECT('type','string'),
        'target_scope_type',JSON_OBJECT('type','string'),
        'target_scope_ref',JSON_OBJECT('type','string'),
        'q',JSON_OBJECT('type','string'),
        'include_evidence',JSON_OBJECT('type','boolean','default',false),
        'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',25)
      ),
      'additionalProperties',false
    ),
    NULL,
    'admin,session_memory,promotion_review,read_only,no_execution,no_secrets',
    1,
    650
  ),
  (
    'session_insight_promotion_review_decide',
    'Session Insight Promotion Review Decide',
    'Approve or reject a queued session insight promotion proposal. Approval keeps promotion_allowed=0 and promotion_executor_key=NULL. No runtime promotion and no backlog/policy/canonical writes are executed.',
    'POST',
    '/platform/session-insight-promotions/review/decision',
    NULL,
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('promotion_id','decision'),
      'properties',JSON_OBJECT(
        'promotion_id',JSON_OBJECT('type','string'),
        'decision',JSON_OBJECT('type','string','enum',JSON_ARRAY('approve','reject')),
        'reviewed_by',JSON_OBJECT('type','string'),
        'review_notes',JSON_OBJECT('type','string')
      ),
      'additionalProperties',false
    ),
    NULL,
    'admin,session_memory,promotion_review,decision,no_runtime_promotion,no_secrets',
    1,
    651
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
