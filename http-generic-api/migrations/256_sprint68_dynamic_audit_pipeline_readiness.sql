-- Sprint 68: Dynamic Audit pipeline readiness views.
-- Summary-only monitoring for audit_log -> event bus -> rollup lag.

CREATE OR REPLACE VIEW `v_dynamic_audit_pipeline_counts` AS
SELECT
  (SELECT COUNT(*) FROM `audit_log`) AS audit_log_total,
  (SELECT COUNT(*) FROM `platform_audit_event_bus` WHERE `source_family` = 'audit_log') AS event_bus_audit_log_total,
  (SELECT COUNT(*) FROM `db_change_audit_events`) AS db_change_rollup_total,
  (SELECT COUNT(*) FROM `asset_audit_events`) AS asset_rollup_total,
  (SELECT COUNT(*) FROM `checkpoint_auto_rollups`) AS checkpoint_rollup_total,
  (SELECT COUNT(*) FROM `platform_audit_event_bus` e
    WHERE e.source_family = 'audit_log'
      AND NOT EXISTS (SELECT 1 FROM `db_change_audit_events` d WHERE d.source_event_key COLLATE utf8mb4_unicode_ci = e.event_key COLLATE utf8mb4_unicode_ci)
      AND NOT EXISTS (SELECT 1 FROM `asset_audit_events` a WHERE a.source_event_key COLLATE utf8mb4_unicode_ci = e.event_key COLLATE utf8mb4_unicode_ci)
      AND NOT EXISTS (SELECT 1 FROM `checkpoint_auto_rollups` c WHERE c.source_event_key COLLATE utf8mb4_unicode_ci = e.event_key COLLATE utf8mb4_unicode_ci)
  ) AS event_bus_unrolled_total,
  GREATEST(0, (SELECT COUNT(*) FROM `audit_log`) - (SELECT COUNT(*) FROM `platform_audit_event_bus` WHERE `source_family` = 'audit_log')) AS audit_log_to_event_bus_gap,
  0 AS raw_payload_stored,
  0 AS raw_before_after_stored,
  0 AS secrets_included;

CREATE OR REPLACE VIEW `v_dynamic_audit_pipeline_quality` AS
SELECT
  'event_bus' AS surface,
  COUNT(*) AS checked_rows,
  SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.raw_payload_stored')) <> 'false'
             OR JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.raw_before_after_stored')) <> 'false'
             OR JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.secrets_included')) <> 'false'
           THEN 1 ELSE 0 END) AS bad_evidence_rows,
  (SELECT COUNT(*) FROM (SELECT event_key FROM `platform_audit_event_bus` GROUP BY event_key HAVING COUNT(*) > 1) x) AS duplicate_key_rows
FROM `platform_audit_event_bus`
WHERE `source_family` = 'audit_log'
UNION ALL
SELECT
  'db_change_rollup', COUNT(*),
  SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.raw_payload_stored')) <> 'false'
             OR JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.raw_before_after_stored')) <> 'false'
             OR JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.secrets_included')) <> 'false'
           THEN 1 ELSE 0 END),
  (SELECT COUNT(*) FROM (SELECT source_event_key FROM `db_change_audit_events` WHERE source_event_key IS NOT NULL GROUP BY source_event_key HAVING COUNT(*) > 1) x)
FROM `db_change_audit_events`
UNION ALL
SELECT
  'asset_rollup', COUNT(*),
  SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.raw_payload_stored')) <> 'false'
             OR JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.raw_before_after_stored')) <> 'false'
             OR JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.secrets_included')) <> 'false'
           THEN 1 ELSE 0 END),
  (SELECT COUNT(*) FROM (SELECT source_event_key FROM `asset_audit_events` WHERE source_event_key IS NOT NULL GROUP BY source_event_key HAVING COUNT(*) > 1) x)
FROM `asset_audit_events`
UNION ALL
SELECT
  'checkpoint_rollup', COUNT(*),
  SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.raw_payload_stored')) <> 'false'
             OR JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.raw_before_after_stored')) <> 'false'
             OR JSON_UNQUOTE(JSON_EXTRACT(evidence_json,'$.secrets_included')) <> 'false'
           THEN 1 ELSE 0 END),
  (SELECT COUNT(*) FROM (SELECT source_event_key FROM `checkpoint_auto_rollups` WHERE source_event_key IS NOT NULL GROUP BY source_event_key HAVING COUNT(*) > 1) x)
FROM `checkpoint_auto_rollups`;

CREATE OR REPLACE VIEW `v_dynamic_audit_pipeline_readiness` AS
SELECT
  'dynamic_audit_pipeline' AS readiness_key,
  CASE
    WHEN (SELECT COALESCE(SUM(bad_evidence_rows),0) + COALESCE(SUM(duplicate_key_rows),0) FROM `v_dynamic_audit_pipeline_quality`) > 0 THEN 'fail'
    WHEN c.audit_log_to_event_bus_gap > 1000 OR c.event_bus_unrolled_total > 5000 THEN 'warn'
    ELSE 'pass'
  END AS readiness_status,
  c.audit_log_total,
  c.event_bus_audit_log_total,
  c.audit_log_to_event_bus_gap,
  c.event_bus_unrolled_total,
  c.db_change_rollup_total,
  c.asset_rollup_total,
  c.checkpoint_rollup_total,
  (SELECT COALESCE(SUM(bad_evidence_rows),0) FROM `v_dynamic_audit_pipeline_quality`) AS bad_evidence_rows,
  (SELECT COALESCE(SUM(duplicate_key_rows),0) FROM `v_dynamic_audit_pipeline_quality`) AS duplicate_key_rows,
  CASE
    WHEN c.audit_log_to_event_bus_gap > 1000 THEN 'audit_log_to_event_bus_gap_high'
    WHEN c.event_bus_unrolled_total > 5000 THEN 'event_bus_rollup_lag_high'
    WHEN (SELECT COALESCE(SUM(bad_evidence_rows),0) FROM `v_dynamic_audit_pipeline_quality`) > 0 THEN 'bad_evidence_flags'
    WHEN (SELECT COALESCE(SUM(duplicate_key_rows),0) FROM `v_dynamic_audit_pipeline_quality`) > 0 THEN 'duplicate_keys'
    ELSE 'ready'
  END AS readiness_reason,
  'audit_log_event_bus_bridge_tick,audit_event_rollup_builder_tick' AS recommended_tick_aliases,
  0 AS secrets_included
FROM `v_dynamic_audit_pipeline_counts` c;
