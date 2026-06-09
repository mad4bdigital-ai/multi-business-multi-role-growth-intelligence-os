-- Sprint 68: Session insight candidates foundation.
-- Converts session summaries into typed, reviewable memory-feed candidates in a later extractor PR.
-- Foundation only: schema + diagnostics. No automatic extraction, promotion, or runtime retrieval behavior is introduced here.

CREATE TABLE IF NOT EXISTS `session_insight_candidates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `insight_id` VARCHAR(96) NOT NULL,
  `candidate_hash` CHAR(64) NOT NULL COMMENT 'Writer-provided SHA-256 identity over source_summary/source_session/insight_type/title/statement.',
  `source_session_id` VARCHAR(64) NULL,
  `source_summary_id` VARCHAR(96) NULL,
  `source_turn_range` VARCHAR(96) NULL,
  `source_asset_id` VARCHAR(255) NULL,
  `tenant_id` VARCHAR(64) NULL,
  `user_id` VARCHAR(255) NULL,
  `workspace_key` VARCHAR(128) NULL,
  `insight_type` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `statement_text` TEXT NOT NULL,
  `evidence_json` LONGTEXT NULL CHECK (JSON_VALID(`evidence_json`) OR `evidence_json` IS NULL),
  `suggested_scopes_json` LONGTEXT NULL CHECK (JSON_VALID(`suggested_scopes_json`) OR `suggested_scopes_json` IS NULL),
  `target_surface` VARCHAR(96) NULL,
  `target_ref` VARCHAR(255) NULL,
  `confidence` DECIMAL(5,4) NOT NULL DEFAULT 0.5000,
  `risk_level` ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `approval_status` ENUM('not_required','review_required','approved','rejected') NOT NULL DEFAULT 'review_required',
  `promotion_status` ENUM('candidate','queued','promoted','rejected','superseded') NOT NULL DEFAULT 'candidate',
  `lifecycle_status` ENUM('active','inactive','archived','superseded') NOT NULL DEFAULT 'active',
  `metadata_json` LONGTEXT NULL CHECK (JSON_VALID(`metadata_json`) OR `metadata_json` IS NULL),
  `secrets_included` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(255) NULL,
  `approved_by` VARCHAR(255) NULL,
  `approved_at` TIMESTAMP NULL DEFAULT NULL,
  `promoted_by` VARCHAR(255) NULL,
  `promoted_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_session_insight_id` (`insight_id`),
  UNIQUE KEY `uq_session_insight_candidate_hash` (`candidate_hash`),
  KEY `idx_session_insight_source_session` (`source_session_id`, `lifecycle_status`),
  KEY `idx_session_insight_source_summary` (`source_summary_id`, `lifecycle_status`),
  KEY `idx_session_insight_tenant_workspace` (`tenant_id`, `workspace_key`, `lifecycle_status`),
  KEY `idx_session_insight_user` (`user_id`(128), `lifecycle_status`),
  KEY `idx_session_insight_type_status` (`insight_type`, `promotion_status`, `approval_status`, `lifecycle_status`),
  KEY `idx_session_insight_target` (`target_surface`, `target_ref`(128), `promotion_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_session_insight_candidate_issues` AS
SELECT
  c.insight_id,
  c.source_session_id,
  c.source_summary_id,
  c.insight_type,
  'missing_source_reference' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'insight_id', c.insight_id,
    'source_session_id', c.source_session_id,
    'source_summary_id', c.source_summary_id,
    'secrets_included', false
  ) AS evidence_json
FROM `session_insight_candidates` c
WHERE c.source_session_id IS NULL AND c.source_summary_id IS NULL
UNION ALL
SELECT
  c.insight_id,
  c.source_session_id,
  c.source_summary_id,
  c.insight_type,
  'missing_title_or_statement' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'insight_id', c.insight_id,
    'title_length', CHAR_LENGTH(COALESCE(c.title, '')),
    'statement_length', CHAR_LENGTH(COALESCE(c.statement_text, '')),
    'secrets_included', false
  ) AS evidence_json
FROM `session_insight_candidates` c
WHERE TRIM(COALESCE(c.title, '')) = '' OR TRIM(COALESCE(c.statement_text, '')) = ''
UNION ALL
SELECT
  c.insight_id,
  c.source_session_id,
  c.source_summary_id,
  c.insight_type,
  'invalid_confidence' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'insight_id', c.insight_id,
    'confidence', c.confidence,
    'secrets_included', false
  ) AS evidence_json
FROM `session_insight_candidates` c
WHERE c.confidence < 0 OR c.confidence > 1
UNION ALL
SELECT
  c.insight_id,
  c.source_session_id,
  c.source_summary_id,
  c.insight_type,
  'promoted_without_approval' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'insight_id', c.insight_id,
    'approval_status', c.approval_status,
    'promotion_status', c.promotion_status,
    'secrets_included', false
  ) AS evidence_json
FROM `session_insight_candidates` c
WHERE c.promotion_status = 'promoted' AND c.approval_status <> 'approved'
UNION ALL
SELECT
  c.insight_id,
  c.source_session_id,
  c.source_summary_id,
  c.insight_type,
  'secret_flag_set_on_insight_candidate' AS issue_code,
  'fail' AS severity,
  JSON_OBJECT(
    'insight_id', c.insight_id,
    'secrets_included', c.secrets_included
  ) AS evidence_json
FROM `session_insight_candidates` c
WHERE c.secrets_included <> 0;
