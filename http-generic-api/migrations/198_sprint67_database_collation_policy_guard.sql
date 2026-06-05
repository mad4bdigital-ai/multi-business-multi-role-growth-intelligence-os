-- Sprint 67: Database collation policy guard
-- Establishes a blocking database-level rule for future DDL: normal text columns
-- must use utf8mb4_unicode_ci, and JSON-like longtext columns may use
-- utf8mb4_bin only when policy allows it. Existing legacy mismatches are tracked
-- through an exception registry so future unregistered drift is actionable.

CREATE TABLE IF NOT EXISTS database_collation_policy_registry (
  policy_key VARCHAR(128) NOT NULL PRIMARY KEY,
  target_character_set VARCHAR(64) NOT NULL,
  target_collation VARCHAR(128) NOT NULL,
  json_allowed_collation VARCHAR(128) NOT NULL DEFAULT 'utf8mb4_bin',
  policy_status ENUM('active','draft','archived') NOT NULL DEFAULT 'active',
  blocking TINYINT(1) NOT NULL DEFAULT 1,
  applies_to_schema VARCHAR(128) NOT NULL DEFAULT 'current_database',
  allowed_exception_rules_json JSON NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS database_collation_policy_exception_registry (
  exception_id VARCHAR(36) NOT NULL PRIMARY KEY,
  policy_key VARCHAR(128) NOT NULL,
  table_name VARCHAR(128) NOT NULL,
  column_name VARCHAR(128) NOT NULL,
  allowed_collation VARCHAR(128) NOT NULL,
  reason VARCHAR(512) NOT NULL,
  status ENUM('active','expired','archived') NOT NULL DEFAULT 'active',
  expires_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_collation_exception (policy_key, table_name, column_name, allowed_collation, status)
) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO database_collation_policy_registry
(policy_key, target_character_set, target_collation, json_allowed_collation, policy_status, blocking, applies_to_schema, allowed_exception_rules_json, notes)
VALUES
('default_utf8mb4_unicode_ci', 'utf8mb4', 'utf8mb4_unicode_ci', 'utf8mb4_bin', 'active', 1, 'current_database',
 JSON_OBJECT(
   'normal_text_columns', JSON_OBJECT('required_collation','utf8mb4_unicode_ci'),
   'json_like_columns', JSON_OBJECT('allowed_collations', JSON_ARRAY('utf8mb4_bin','utf8mb4_unicode_ci'), 'column_name_patterns', JSON_ARRAY('_json','json_','path_param_keys','input_schema','fixed_body','allowed_actions','allowed_args','mcp_server_info','default_action_grants')),
   'legacy_exceptions', JSON_OBJECT('must_be_registered', true, 'default_expiry_days', 90),
   'ddl_guard', JSON_OBJECT('new_tables_must_use_default_charset','utf8mb4', 'new_tables_must_use_default_collation','utf8mb4_unicode_ci')
 ),
 'Unified database collation policy. New DDL must use DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci. JSON-like longtext may use utf8mb4_bin only when explicitly justified. Cross-table join keys must not use mixed collations.'
)
ON DUPLICATE KEY UPDATE
  target_character_set=VALUES(target_character_set),
  target_collation=VALUES(target_collation),
  json_allowed_collation=VALUES(json_allowed_collation),
  policy_status=VALUES(policy_status),
  blocking=VALUES(blocking),
  applies_to_schema=VALUES(applies_to_schema),
  allowed_exception_rules_json=VALUES(allowed_exception_rules_json),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

DROP VIEW IF EXISTS v_database_collation_policy_violations;
CREATE VIEW v_database_collation_policy_violations AS
SELECT
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.COLUMN_NAME AS column_name,
  c.COLUMN_TYPE AS column_type,
  c.DATA_TYPE AS data_type,
  c.CHARACTER_SET_NAME AS character_set_name,
  c.COLLATION_NAME AS collation_name,
  p.target_character_set,
  p.target_collation,
  CASE
    WHEN c.CHARACTER_SET_NAME <> p.target_character_set THEN 'wrong_character_set'
    WHEN (
      c.COLUMN_NAME REGEXP '(^|_)json$|_json$|json_' OR
      c.COLUMN_NAME IN ('path_param_keys','input_schema','fixed_body','allowed_actions','allowed_args','mcp_server_info','default_action_grants')
    ) AND c.COLLATION_NAME NOT IN (p.json_allowed_collation, p.target_collation) THEN 'wrong_json_collation'
    WHEN NOT (
      c.COLUMN_NAME REGEXP '(^|_)json$|_json$|json_' OR
      c.COLUMN_NAME IN ('path_param_keys','input_schema','fixed_body','allowed_actions','allowed_args','mcp_server_info','default_action_grants')
    ) AND c.COLLATION_NAME <> p.target_collation THEN 'wrong_text_collation'
    ELSE 'ok'
  END AS violation_type,
  CASE WHEN e.exception_id IS NOT NULL THEN 1 ELSE 0 END AS has_active_exception,
  e.reason AS exception_reason
FROM information_schema.COLUMNS c
JOIN database_collation_policy_registry p
  ON p.policy_key='default_utf8mb4_unicode_ci'
 AND p.policy_status='active'
LEFT JOIN database_collation_policy_exception_registry e
  ON e.policy_key=p.policy_key
 AND e.table_name=c.TABLE_NAME
 AND e.column_name=c.COLUMN_NAME
 AND e.allowed_collation=c.COLLATION_NAME
 AND e.status='active'
 AND (e.expires_at IS NULL OR e.expires_at > CURRENT_TIMESTAMP)
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.CHARACTER_SET_NAME IS NOT NULL
  AND (
    c.CHARACTER_SET_NAME <> p.target_character_set
    OR (
      (
        c.COLUMN_NAME REGEXP '(^|_)json$|_json$|json_' OR
        c.COLUMN_NAME IN ('path_param_keys','input_schema','fixed_body','allowed_actions','allowed_args','mcp_server_info','default_action_grants')
      ) AND c.COLLATION_NAME NOT IN (p.json_allowed_collation, p.target_collation)
    )
    OR (
      NOT (
        c.COLUMN_NAME REGEXP '(^|_)json$|_json$|json_' OR
        c.COLUMN_NAME IN ('path_param_keys','input_schema','fixed_body','allowed_actions','allowed_args','mcp_server_info','default_action_grants')
      ) AND c.COLLATION_NAME <> p.target_collation
    )
  );

DROP VIEW IF EXISTS v_database_collation_policy_status;
CREATE VIEW v_database_collation_policy_status AS
SELECT
  p.policy_key,
  p.target_character_set,
  p.target_collation,
  p.json_allowed_collation,
  p.policy_status,
  p.blocking,
  COUNT(v.column_name) AS violation_count,
  COALESCE(SUM(CASE WHEN v.has_active_exception=1 THEN 1 ELSE 0 END),0) AS exception_count,
  COALESCE(SUM(CASE WHEN v.has_active_exception=0 THEN 1 ELSE 0 END),0) AS actionable_violation_count,
  CASE WHEN COALESCE(SUM(CASE WHEN v.has_active_exception=0 THEN 1 ELSE 0 END),0)=0 THEN 'pass' ELSE 'warn' END AS status
FROM database_collation_policy_registry p
LEFT JOIN v_database_collation_policy_violations v
  ON p.policy_key='default_utf8mb4_unicode_ci'
WHERE p.policy_key='default_utf8mb4_unicode_ci'
GROUP BY p.policy_key, p.target_character_set, p.target_collation, p.json_allowed_collation, p.policy_status, p.blocking;

INSERT INTO database_collation_policy_exception_registry
(exception_id, policy_key, table_name, column_name, allowed_collation, reason, status, expires_at)
SELECT UUID(), 'default_utf8mb4_unicode_ci', table_name, column_name, collation_name,
       CONCAT('pre_existing_legacy_collation_detected_before_enforcement:', violation_type),
       'active', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 90 DAY)
FROM v_database_collation_policy_violations v
WHERE v.has_active_exception=0
  AND NOT EXISTS (
    SELECT 1 FROM database_collation_policy_exception_registry e
     WHERE e.policy_key='default_utf8mb4_unicode_ci'
       AND e.table_name=v.table_name
       AND e.column_name=v.column_name
       AND e.allowed_collation=v.collation_name
       AND e.status='active'
  );

UPDATE execution_policies
SET policy_value = JSON_OBJECT(
    'rule','unified_database_collation_required',
    'target_character_set','utf8mb4',
    'target_collation','utf8mb4_unicode_ci',
    'json_allowed_collation','utf8mb4_bin',
    'new_ddl_requirement','All new tables and textual columns must use utf8mb4_unicode_ci unless explicitly registered as a JSON/binary collation exception.',
    'join_key_requirement','Cross-table join keys must not use mixed collations. Fix by aligning table/column collation, not by permanent BINARY workarounds.',
    'exception_policy',JSON_OBJECT('registry_table','database_collation_policy_exception_registry','legacy_exception_expiry_days',90,'future_unregistered_mismatch_blocks_release',true),
    'readback_views',JSON_ARRAY('v_database_collation_policy_violations','v_database_collation_policy_status')
  ),
  active='true',
  execution_scope='database_schema_governance',
  affects_layer='migrations,ddl,registry,release_readiness,workspace_authority,capability_vault',
  blocking='true',
  notes='Database DDL must use one default charset/collation: utf8mb4/utf8mb4_unicode_ci. JSON-like columns may use utf8mb4_bin only by policy. Legacy mismatches are registered as expiring exceptions; new unregistered mismatches are actionable violations.',
  updated_at=CURRENT_TIMESTAMP
WHERE policy_group='database_schema_governance'
  AND policy_key='unified_collation_required';

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
SELECT 'database_schema_governance', 'unified_collation_required',
  JSON_OBJECT(
    'rule','unified_database_collation_required',
    'target_character_set','utf8mb4',
    'target_collation','utf8mb4_unicode_ci',
    'json_allowed_collation','utf8mb4_bin',
    'new_ddl_requirement','All new tables and textual columns must use utf8mb4_unicode_ci unless explicitly registered as a JSON/binary collation exception.',
    'join_key_requirement','Cross-table join keys must not use mixed collations. Fix by aligning table/column collation, not by permanent BINARY workarounds.',
    'exception_policy',JSON_OBJECT('registry_table','database_collation_policy_exception_registry','legacy_exception_expiry_days',90,'future_unregistered_mismatch_blocks_release',true),
    'readback_views',JSON_ARRAY('v_database_collation_policy_violations','v_database_collation_policy_status')
  ),
  'true',
  'database_schema_governance',
  'migrations,ddl,registry,release_readiness,workspace_authority,capability_vault',
  'true',
  'Database DDL must use one default charset/collation: utf8mb4/utf8mb4_unicode_ci. JSON-like columns may use utf8mb4_bin only by policy. Legacy mismatches are registered as expiring exceptions; new unregistered mismatches are actionable violations.'
WHERE NOT EXISTS (
  SELECT 1 FROM execution_policies
  WHERE policy_group='database_schema_governance'
    AND policy_key='unified_collation_required'
);

INSERT INTO runtime_dispatch_certification_registry
  (certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status,
   smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run,
   requires_audit_evidence, requires_readback, notes)
VALUES
  ('database_collation_unified_required_v1', 'database_collation_policy', 'database_schema_governance', 'admin_control.db', 'B', 'active_policy_registered',
   'read v_database_collation_policy_status and require actionable_violation_count=0 before DDL or release readiness',
   1, 0, 1, 1, 1, 1,
   'Unified database collation guard: target utf8mb4_unicode_ci, JSON-like exception utf8mb4_bin, block future unregistered mixed-collation schema artifacts.')
ON DUPLICATE KEY UPDATE
  surface_key=VALUES(surface_key), surface_family=VALUES(surface_family), tool_or_action_key=VALUES(tool_or_action_key),
  risk_class=VALUES(risk_class), certification_status=VALUES(certification_status), smoke_strategy=VALUES(smoke_strategy),
  dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed), requires_resource_authority=VALUES(requires_resource_authority),
  requires_dry_run=VALUES(requires_dry_run), requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback),
  notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO readiness_checks
(check_id, tenant_id, check_key, check_status, detail)
VALUES
('db-collation-policy-guard-v1', 'e989a841-fce0-4ced-be76-463e8202a066', 'database_collation_policy', 'pass',
 'Unified collation policy active: target utf8mb4_unicode_ci; unregistered actionable violations must be zero; legacy mismatches are tracked as expiring exceptions.')
ON DUPLICATE KEY UPDATE
  tenant_id=VALUES(tenant_id), check_status=VALUES(check_status), detail=VALUES(detail), checked_at=CURRENT_TIMESTAMP;
