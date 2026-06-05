-- Sprint 67: Runtime policy resolver monitoring and legacy mirror classification.
-- Additive diagnostics only. No destructive SQL.

CREATE OR REPLACE VIEW v_execution_association_monitoring_summary AS
WITH monitoring_baseline AS (
  SELECT COALESCE(
    (SELECT MAX(applied_at)
       FROM governed_migration_ledger
      WHERE migration_file = '198_sprint67_runtime_policy_resolver_monitoring_and_mirror_classification.sql'),
    DATE_SUB(NOW(), INTERVAL 24 HOUR)
  ) AS baseline_at
)
SELECT 'post_baseline_logic_null' AS check_key, COUNT(*) AS issue_count
  FROM execution_log, monitoring_baseline
 WHERE created_at >= monitoring_baseline.baseline_at
   AND logic_association_status IS NULL
UNION ALL
SELECT 'post_baseline_logic_unknown' AS check_key, COUNT(*) AS issue_count
  FROM execution_log, monitoring_baseline
 WHERE created_at >= monitoring_baseline.baseline_at
   AND logic_association_status = 'unknown'
UNION ALL
SELECT 'post_baseline_engine_null' AS check_key, COUNT(*) AS issue_count
  FROM execution_log, monitoring_baseline
 WHERE created_at >= monitoring_baseline.baseline_at
   AND engine_association_status IS NULL
UNION ALL
SELECT 'post_baseline_engine_unknown' AS check_key, COUNT(*) AS issue_count
  FROM execution_log, monitoring_baseline
 WHERE created_at >= monitoring_baseline.baseline_at
   AND engine_association_status = 'unknown';

CREATE OR REPLACE VIEW v_runtime_policy_resolver_rule_coverage AS
SELECT
  ep.id AS execution_policy_id,
  ep.policy_group,
  ep.policy_key,
  ep.active,
  ep.blocking,
  ep.execution_scope,
  ep.affects_layer,
  r.rule_key,
  r.policy_key AS target_policy_key,
  r.task_class,
  r.resource_kind,
  r.status AS rule_status,
  CASE WHEN r.rule_key IS NULL THEN 'missing_target_rule' ELSE 'target_rule_present' END AS coverage_status
FROM execution_policies ep
LEFT JOIN platform_engine_policy_rules r
  ON JSON_VALID(r.condition_json)
 AND JSON_UNQUOTE(JSON_EXTRACT(r.condition_json, '$.execution_policy_group')) = ep.policy_group
 AND JSON_UNQUOTE(JSON_EXTRACT(r.condition_json, '$.execution_policy_key')) = ep.policy_key;

CREATE TABLE IF NOT EXISTS policy_logic_mirror_classification (
  classification_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_policy_id BIGINT UNSIGNED NOT NULL,
  policy_group VARCHAR(255) NULL,
  policy_key VARCHAR(255) NULL,
  logic_key VARCHAR(128) NULL,
  logic_type VARCHAR(40) NULL,
  policy_active VARCHAR(20) NULL,
  policy_blocking VARCHAR(20) NULL,
  has_target_rule_binding TINYINT(1) NOT NULL DEFAULT 0,
  classification VARCHAR(80) NOT NULL,
  recommended_target VARCHAR(191) NOT NULL,
  notes TEXT NULL,
  classified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (classification_id),
  UNIQUE KEY uq_policy_logic_mirror_classification_source (source_policy_id),
  KEY idx_policy_logic_mirror_classification_class (classification),
  KEY idx_policy_logic_mirror_classification_policy (policy_group, policy_key),
  KEY idx_policy_logic_mirror_classification_logic (logic_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO policy_logic_mirror_classification (
  source_policy_id, policy_group, policy_key, logic_key, logic_type,
  policy_active, policy_blocking, has_target_rule_binding,
  classification, recommended_target, notes
)
SELECT
  ep.id,
  ep.policy_group,
  ep.policy_key,
  ld.logic_key,
  ld.logic_type,
  ep.active,
  ep.blocking,
  CASE WHEN target_binding.binding_id IS NULL THEN 0 ELSE 1 END AS has_target_rule_binding,
  CASE
    WHEN ld.logic_key IS NULL THEN 'policy_without_legacy_logic_mirror'
    WHEN target_binding.binding_id IS NOT NULL THEN 'runtime_target_rule_backed'
    WHEN LOWER(COALESCE(ld.logic_type, '')) <> 'supervisory' THEN 'keep_as_logic_review'
    WHEN LOWER(COALESCE(ep.blocking, '')) IN ('true','1','yes','block','blocking') THEN 'migrate_to_platform_policy_rule_blocking'
    WHEN LOWER(COALESCE(ep.active, '')) IN ('true','1','yes','active','global') THEN 'migrate_to_platform_policy_rule_advisory'
    ELSE 'deprecated_or_inactive_mirror'
  END AS classification,
  CASE
    WHEN target_binding.target_policy_rule_key IS NOT NULL THEN target_binding.target_policy_rule_key
    WHEN LOWER(COALESCE(ld.logic_type, '')) <> 'supervisory' THEN 'logic_definitions'
    ELSE 'platform_engine_policy_rules'
  END AS recommended_target,
  CASE
    WHEN target_binding.binding_id IS NOT NULL THEN 'Already bound to target platform_engine_policy_rules representation; retain legacy mirror for traceability only.'
    WHEN ld.logic_key IS NULL THEN 'Execution policy has no exact legacy logic mirror; classify as policy-only runtime/source row.'
    WHEN LOWER(COALESCE(ld.logic_type, '')) <> 'supervisory' THEN 'Not a pure supervisory mirror; review before moving out of logic_definitions.'
    WHEN LOWER(COALESCE(ep.blocking, '')) IN ('true','1','yes','block','blocking') THEN 'Pure blocking policy mirror; candidate for platform_engine_policy_rules with compatibility fallback.'
    WHEN LOWER(COALESCE(ep.active, '')) IN ('true','1','yes','active','global') THEN 'Pure advisory/active policy mirror; candidate for platform_engine_policy_rules with compatibility fallback.'
    ELSE 'Inactive/deprecated mirror; retain until audit confirms it can be archived.'
  END AS notes
FROM execution_policies ep
LEFT JOIN logic_definitions ld
  ON JSON_VALID(ld.body_json)
 AND JSON_UNQUOTE(JSON_EXTRACT(ld.body_json, '$.source')) = 'legacy_execution_policies'
 AND CAST(JSON_UNQUOTE(JSON_EXTRACT(ld.body_json, '$.legacy_id')) AS UNSIGNED) = ep.id
LEFT JOIN policy_logic_bindings target_binding
  ON target_binding.source_policy_table = 'execution_policies'
 AND target_binding.source_policy_id = ep.id
 AND target_binding.binding_role = 'runtime_policy_target_rule'
 AND target_binding.binding_status = 'active'
ON DUPLICATE KEY UPDATE
  policy_group = VALUES(policy_group),
  policy_key = VALUES(policy_key),
  logic_key = VALUES(logic_key),
  logic_type = VALUES(logic_type),
  policy_active = VALUES(policy_active),
  policy_blocking = VALUES(policy_blocking),
  has_target_rule_binding = VALUES(has_target_rule_binding),
  classification = VALUES(classification),
  recommended_target = VALUES(recommended_target),
  notes = VALUES(notes),
  updated_at = NOW();

CREATE OR REPLACE VIEW v_policy_logic_mirror_classification_summary AS
SELECT classification, recommended_target, COUNT(*) AS row_count
  FROM policy_logic_mirror_classification
 GROUP BY classification, recommended_target
 ORDER BY classification, recommended_target;

CREATE OR REPLACE VIEW v_policy_logic_mirror_classification_detail AS
SELECT
  c.source_policy_id,
  c.policy_group,
  c.policy_key,
  c.logic_key,
  c.logic_type,
  c.policy_active,
  c.policy_blocking,
  c.has_target_rule_binding,
  c.classification,
  c.recommended_target,
  c.notes,
  c.updated_at
FROM policy_logic_mirror_classification c;
