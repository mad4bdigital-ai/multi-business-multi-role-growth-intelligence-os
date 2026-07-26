-- Sprint 68: Session insight promotion foundation.
-- Adds a governed review/promotion request ledger for session_insight_candidates.
-- Foundation only: no runtime retrieval, no automatic policy/canonical/backlog writes.

CREATE TABLE IF NOT EXISTS `session_insight_promotions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `promotion_id` VARCHAR(96) NOT NULL,
  `promotion_hash` CHAR(64) NOT NULL COMMENT 'Writer-provided SHA-256 identity over insight_id, target_surface, target_ref, promotion_type.',
  `insight_id` VARCHAR(96) NOT NULL,
  `source_session_id` VARCHAR(64) NULL,
  `source_summary_id` VARCHAR(96) NULL,
  `tenant_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(255) NULL,
  `workspace_key` VARCHAR(128) NULL,
  `promotion_type` VARCHAR(64) NOT NULL COMMENT 'Dynamic type, e.g. backlog_item, policy_candidate, canonical_doc_update, runtime_rule_candidate.',
  `target_surface` VARCHAR(96) NOT NULL,
  `target_ref` VARCHAR(255) NULL,
  `target_scope_type` VARCHAR(64) NULL,
  `target_scope_ref` VARCHAR(255) NULL,
  `proposal_title` VARCHAR(255) NOT NULL,
  `proposal_text` TEXT NOT NULL,
  `decision_status` ENUM('draft','review_required','approved','rejected','promoted','superseded') NOT NULL DEFAULT 'review_required',
  `approval_status` ENUM('not_required','review_required','approved','rejected') NOT NULL DEFAULT 'review_required',
  `promotion_status` ENUM('queued','blocked','ready','promoted','rejected','superseded') NOT NULL DEFAULT 'queued',
  `risk_level` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `confidence` DECIMAL(5,4) NOT NULL DEFAULT 0.5000,
  `requires_human_approval` TINYINT(1) NOT NULL DEFAULT 1,
  `promotion_allowed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Explicit runtime gate; must remain false until governed approval/executor exists.',
  `promotion_executor_key` VARCHAR(128) NULL,
  `approved_by` VARCHAR(255) NULL,
  `approved_at` TIMESTAMP NULL DEFAULT NULL,
  `rejected_by` VARCHAR(255) NULL,
  `rejected_at` TIMESTAMP NULL DEFAULT NULL,
  `promoted_by` VARCHAR(255) NULL,
  `promoted_at` TIMESTAMP NULL DEFAULT NULL,
  `evidence_json` LONGTEXT NULL CHECK (JSON_VALID(`evidence_json`) OR `evidence_json` IS NULL),
  `scope_links_json` LONGTEXT NULL CHECK (JSON_VALID(`scope_links_json`) OR `scope_links_json` IS NULL),
  `decision_notes` TEXT NULL,
  `metadata_json` LONGTEXT NULL CHECK (JSON_VALID(`metadata_json`) OR `metadata_json` IS NULL),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_promotion_id` (`promotion_id`),
  UNIQUE KEY `uq_session_insight_promotion_hash` (`promotion_hash`),
  KEY `idx_session_insight_promotion_insight` (`insight_id`, `decision_status`, `promotion_status`),
  KEY `idx_session_insight_promotion_source` (`source_session_id`, `source_summary_id`),
  KEY `idx_session_insight_promotion_tenant_workspace` (`tenant_id`, `workspace_key`, `decision_status`),
  KEY `idx_session_insight_promotion_target` (`target_surface`, `target_ref`(128), `promotion_status`),
  KEY `idx_session_insight_promotion_scope` (`target_scope_type`, `target_scope_ref`(128), `decision_status`),
  CONSTRAINT `fk_session_insight_promotions_candidate`
    FOREIGN KEY (`insight_id`) REFERENCES `session_insight_candidates` (`insight_id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_promotion_issues` AS
SELECT
  p.promotion_id,
  p.insight_id,
  p.target_surface,
  p.promotion_type,
  'promotion_without_candidate' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('promotion_id', p.promotion_id, 'insight_id', p.insight_id, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotions` p
LEFT JOIN `session_insight_candidates` c ON c.insight_id = p.insight_id
WHERE c.insight_id IS NULL
UNION ALL
SELECT
  p.promotion_id,
  p.insight_id,
  p.target_surface,
  p.promotion_type,
  'promoted_without_approval' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('promotion_id', p.promotion_id, 'approval_status', p.approval_status, 'decision_status', p.decision_status, 'promotion_status', p.promotion_status, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotions` p
WHERE (p.decision_status = 'promoted' OR p.promotion_status = 'promoted' OR p.promotion_allowed = 1)
  AND p.approval_status <> 'approved'
UNION ALL
SELECT
  p.promotion_id,
  p.insight_id,
  p.target_surface,
  p.promotion_type,
  'promotion_allowed_without_executor' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('promotion_id', p.promotion_id, 'promotion_allowed', p.promotion_allowed, 'promotion_executor_key', p.promotion_executor_key, 'secrets_included', false) AS evidence_json
FROM `session_insight_promotions` p
WHERE p.promotion_allowed = 1
  AND TRIM(COALESCE(p.promotion_executor_key, '')) = ''
UNION ALL
SELECT
  p.promotion_id,
  p.insight_id,
  p.target_surface,
  p.promotion_type,
  'secret_flag_set_on_promotion' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('promotion_id', p.promotion_id, 'secrets_included', p.secrets_included) AS evidence_json
FROM `session_insight_promotions` p
WHERE p.secrets_included <> 0
UNION ALL
SELECT
  p.promotion_id,
  p.insight_id,
  p.target_surface,
  p.promotion_type,
  'missing_proposal_text' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT('promotion_id', p.promotion_id, 'title_length', CHAR_LENGTH(COALESCE(p.proposal_title, '')), 'text_length', CHAR_LENGTH(COALESCE(p.proposal_text, '')), 'secrets_included', false) AS evidence_json
FROM `session_insight_promotions` p
WHERE TRIM(COALESCE(p.proposal_title, '')) = '' OR TRIM(COALESCE(p.proposal_text, '')) = '';
