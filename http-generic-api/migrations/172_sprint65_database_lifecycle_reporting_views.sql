-- Sprint 65: read-only database lifecycle reporting views.
--
-- These views summarize metadata already stored in
-- database_table_lifecycle_registry. They do not mutate, drop, archive, or
-- delete any runtime table. They provide operational visibility for the AI
-- Intelligence Runtime & Governance Layer.

CREATE OR REPLACE VIEW v_database_lifecycle_status_summary AS
SELECT
  usage_status,
  risk_level,
  COUNT(*) AS table_count,
  ROUND(SUM(COALESCE(size_mb, 0)), 3) AS total_size_mb,
  MAX(last_checked_at) AS last_checked_at
FROM database_table_lifecycle_registry
GROUP BY usage_status, risk_level;

CREATE OR REPLACE VIEW v_database_lifecycle_owner_coverage AS
SELECT
  owner_engine_key,
  COUNT(*) AS table_count,
  SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) AS high_risk_table_count,
  ROUND(SUM(COALESCE(size_mb, 0)), 3) AS total_size_mb,
  SUM(CASE WHEN usage_status = 'runtime_unclassified' THEN 1 ELSE 0 END) AS unclassified_table_count,
  SUM(CASE WHEN usage_status = 'planned_placeholder' THEN 1 ELSE 0 END) AS placeholder_table_count,
  MAX(last_checked_at) AS last_checked_at
FROM database_table_lifecycle_registry
GROUP BY owner_engine_key;

CREATE OR REPLACE VIEW v_database_lifecycle_growth_hotspots AS
SELECT
  table_name,
  table_family,
  owner_engine_key,
  usage_status,
  risk_level,
  approx_rows,
  size_mb,
  retention_class,
  retention_days,
  growth_policy,
  last_observed_write_at,
  last_checked_at
FROM database_table_lifecycle_registry
WHERE COALESCE(size_mb, 0) >= 5
   OR COALESCE(approx_rows, 0) >= 5000
ORDER BY COALESCE(size_mb, 0) DESC, COALESCE(approx_rows, 0) DESC;

CREATE OR REPLACE VIEW v_database_lifecycle_placeholder_review AS
SELECT
  table_name,
  table_family,
  owner_engine_key,
  usage_status,
  risk_level,
  approx_rows,
  size_mb,
  retention_class,
  retention_days,
  archive_strategy,
  cleanup_strategy,
  notes,
  last_checked_at
FROM database_table_lifecycle_registry
WHERE usage_status = 'planned_placeholder'
ORDER BY risk_level DESC, COALESCE(size_mb, 0) DESC, table_name ASC;

CREATE OR REPLACE VIEW v_database_lifecycle_high_risk_review AS
SELECT
  table_name,
  table_family,
  owner_engine_key,
  usage_status,
  risk_level,
  approx_rows,
  size_mb,
  retention_class,
  retention_days,
  archive_strategy,
  cleanup_strategy,
  linked_by_policy,
  linked_by_foreign_key,
  last_observed_write_at,
  last_checked_at
FROM database_table_lifecycle_registry
WHERE risk_level = 'high'
ORDER BY usage_status ASC, COALESCE(size_mb, 0) DESC, table_name ASC;

CREATE OR REPLACE VIEW v_database_lifecycle_credential_review AS
SELECT
  table_name,
  table_family,
  owner_engine_key,
  usage_status,
  risk_level,
  approx_rows,
  size_mb,
  retention_class,
  archive_strategy,
  cleanup_strategy,
  linked_by_policy,
  linked_by_foreign_key,
  last_checked_at
FROM database_table_lifecycle_registry
WHERE owner_engine_key = 'credential_governance_engine'
   OR table_family = 'credential_governance'
   OR table_name LIKE '%credential%'
   OR table_name LIKE '%secret%'
   OR table_name LIKE '%token%'
ORDER BY risk_level DESC, table_name ASC;

CREATE OR REPLACE VIEW v_database_lifecycle_backup_snapshot_review AS
SELECT
  table_name,
  table_family,
  owner_engine_key,
  usage_status,
  risk_level,
  approx_rows,
  size_mb,
  retention_class,
  retention_days,
  archive_strategy,
  cleanup_strategy,
  last_observed_write_at,
  last_checked_at
FROM database_table_lifecycle_registry
WHERE usage_status = 'backup_snapshot'
   OR owner_engine_key IN ('repair_archive_engine', 'backup_restore_lifecycle_engine')
ORDER BY risk_level DESC, COALESCE(size_mb, 0) DESC, table_name ASC;

UPDATE admin_platform_endpoint_tools
   SET description = 'Return database lifecycle reporting view summaries for owner coverage, hotspots, placeholders, high-risk tables, credentials, and backup snapshots. Read-only visibility only.',
       tags = 'platform_engine,database_lifecycle,reporting,read_only,no_drop,admin'
 WHERE tool_key = 'database_table_lifecycle_decision_brief';
