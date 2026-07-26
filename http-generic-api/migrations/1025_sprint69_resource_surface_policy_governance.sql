-- Sprint 69: policy-driven Resource API surface governance.
-- Safety: additive registry plus metadata-only classification updates. No provider calls,
-- external sends, credential reads, hard deletion, table deletion, archive execution, or secret material.

CREATE TABLE IF NOT EXISTS platform_resource_surface_policy_registry (
  surface_kind ENUM('table','view','tool') NOT NULL,
  surface_ref VARCHAR(255) NOT NULL,
  exposure_class ENUM('resource_source','resource_read_model','resource_tool','internal_runtime','internal_registry','internal_log','internal_read_model','internal_tool','governance_ledger','planned_placeholder','recovery_snapshot') NOT NULL,
  resource_key VARCHAR(128) NULL,
  descriptor_requirement ENUM('required','not_applicable') NOT NULL DEFAULT 'not_applicable',
  operation_requirement ENUM('required','not_applicable') NOT NULL DEFAULT 'not_applicable',
  archive_requirement ENUM('physical_marker','lifecycle_policy','resource_state','not_applicable') NOT NULL DEFAULT 'not_applicable',
  version_requirement ENUM('optimistic_concurrency','resource_state','not_applicable') NOT NULL DEFAULT 'not_applicable',
  rationale VARCHAR(1000) NOT NULL,
  source_policy_key VARCHAR(191) NOT NULL DEFAULT 'platform_resource_api_coverage_policy_v1',
  status ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (surface_kind, surface_ref),
  KEY idx_resource_surface_policy_resource (resource_key, status),
  KEY idx_resource_surface_policy_exposure (exposure_class, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO database_table_lifecycle_registry
  (table_name,table_family,owner_engine_key,authority_model,usage_status,write_strategy,retention_class,archive_strategy,cleanup_strategy,growth_policy,linked_by_code,linked_by_policy,risk_level,status,notes,last_checked_at)
VALUES
  ('platform_resource_surface_policy_registry','resource_api_governance','database_table_lifecycle_engine','canonical','runtime_registry','platform_primary','platform_registry','archive_disabled_rows','review_superseded_policy_rows','low_growth',1,1,'medium','active','Explicit exposure and requirement decisions for tables, views, and tools.',CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE table_family=VALUES(table_family),owner_engine_key=VALUES(owner_engine_key),authority_model=VALUES(authority_model),usage_status=VALUES(usage_status),write_strategy=VALUES(write_strategy),retention_class=VALUES(retention_class),archive_strategy=VALUES(archive_strategy),cleanup_strategy=VALUES(cleanup_strategy),growth_policy=VALUES(growth_policy),linked_by_code=VALUES(linked_by_code),linked_by_policy=VALUES(linked_by_policy),risk_level=VALUES(risk_level),status=VALUES(status),notes=VALUES(notes),last_checked_at=VALUES(last_checked_at),updated_at=CURRENT_TIMESTAMP;

UPDATE platform_resource_type_registry
   SET source_tables_json=JSON_ARRAY('platform_resource_type_registry','platform_resource_operation_registry','platform_resource_coverage_runs','platform_resource_coverage_findings','platform_resource_surface_policy_registry'),updated_at=CURRENT_TIMESTAMP
 WHERE resource_key='resource_api_governance';

UPDATE platform_resource_type_registry
   SET operation_policy_json=JSON_SET(COALESCE(operation_policy_json,JSON_OBJECT()),'$.revisions','readback_guarded'),updated_at=CURRENT_TIMESTAMP
 WHERE resource_key IN ('assets','approvals');

UPDATE database_table_lifecycle_registry
   SET usage_status=CASE
         WHEN retention_class IN ('hot_then_archive','long_retention_archive','operational_audit','audit') OR table_name REGEXP '(_log|_events|_runs|_ledger|_history|_audit)$' THEN 'runtime_log'
         WHEN table_name REGEXP '(_registry|_catalog|_policy|_definitions)$' OR table_family REGEXP '(registry|governance|configuration|taxonomy)' THEN 'runtime_registry'
         WHEN authority_model='canonical' THEN 'runtime_canonical'
         ELSE 'runtime_derived'
       END,
       notes=CONCAT_WS(',',NULLIF(notes,''),'resource_surface_policy_backfill_v1'),last_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
 WHERE usage_status='runtime_unclassified';

INSERT INTO platform_resource_surface_policy_registry
  (surface_kind,surface_ref,exposure_class,resource_key,descriptor_requirement,operation_requirement,archive_requirement,version_requirement,rationale,source_policy_key,status)
VALUES
  ('table','platform_resource_surface_policy_registry','resource_source','resource_api_governance','required','not_applicable','resource_state','resource_state','Governance registry is part of the Resource API Governance descriptor.','platform_resource_api_coverage_policy_v1','active')
ON DUPLICATE KEY UPDATE exposure_class=VALUES(exposure_class),resource_key=VALUES(resource_key),descriptor_requirement=VALUES(descriptor_requirement),operation_requirement=VALUES(operation_requirement),archive_requirement=VALUES(archive_requirement),version_requirement=VALUES(version_requirement),rationale=VALUES(rationale),source_policy_key=VALUES(source_policy_key),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_surface_policy_registry
  (surface_kind,surface_ref,exposure_class,resource_key,descriptor_requirement,operation_requirement,archive_requirement,version_requirement,rationale,source_policy_key,status)
SELECT 'table',t.TABLE_NAME,
  CASE WHEN d.resource_key IS NOT NULL THEN 'resource_source' WHEN l.usage_status IN ('runtime_log','audit_log','session_log','telemetry_log') THEN 'internal_log' WHEN l.usage_status='runtime_registry' THEN 'internal_registry' WHEN l.usage_status='planned_placeholder' THEN 'planned_placeholder' WHEN l.usage_status IN ('backup_snapshot','repair_snapshot') THEN 'recovery_snapshot' ELSE 'internal_runtime' END,
  d.resource_key,IF(d.resource_key IS NULL,'not_applicable','required'),'not_applicable',IF(d.resource_key IS NULL,'not_applicable','resource_state'),IF(d.resource_key IS NULL,'not_applicable','resource_state'),
  IF(d.resource_key IS NULL,CONCAT('Internal table governed by lifecycle classification ',COALESCE(l.usage_status,'missing'),'.'),CONCAT('Source table for logical resource ',d.resource_key,'.')),
  'platform_resource_api_coverage_policy_v1','active'
FROM INFORMATION_SCHEMA.TABLES t
LEFT JOIN database_table_lifecycle_registry l ON l.table_name=t.TABLE_NAME
LEFT JOIN (
  SELECT t2.TABLE_NAME AS surface_ref,MIN(r.resource_key) AS resource_key
  FROM INFORMATION_SCHEMA.TABLES t2
  JOIN platform_resource_type_registry r ON r.status='active' AND JSON_VALID(r.source_tables_json) AND JSON_CONTAINS(r.source_tables_json,JSON_QUOTE(t2.TABLE_NAME))
  WHERE t2.TABLE_SCHEMA=DATABASE() AND t2.TABLE_TYPE='BASE TABLE'
  GROUP BY t2.TABLE_NAME
) d ON d.surface_ref=t.TABLE_NAME
WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE' AND t.TABLE_NAME<>'platform_resource_surface_policy_registry'
ON DUPLICATE KEY UPDATE exposure_class=VALUES(exposure_class),resource_key=VALUES(resource_key),descriptor_requirement=VALUES(descriptor_requirement),operation_requirement=VALUES(operation_requirement),archive_requirement=VALUES(archive_requirement),version_requirement=VALUES(version_requirement),rationale=VALUES(rationale),source_policy_key=VALUES(source_policy_key),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_surface_policy_registry
  (surface_kind,surface_ref,exposure_class,resource_key,descriptor_requirement,operation_requirement,archive_requirement,version_requirement,rationale,source_policy_key,status)
SELECT 'view',t.TABLE_NAME,IF(d.resource_key IS NULL,'internal_read_model','resource_read_model'),d.resource_key,IF(d.resource_key IS NULL,'not_applicable','required'),'not_applicable','not_applicable','not_applicable',IF(d.resource_key IS NULL,'Internal read model; no public Resource API descriptor is required.',CONCAT('Read model for logical resource ',d.resource_key,'.')),'platform_resource_api_coverage_policy_v1','active'
FROM INFORMATION_SCHEMA.TABLES t
LEFT JOIN (
  SELECT t2.TABLE_NAME AS surface_ref,MIN(r.resource_key) AS resource_key
  FROM INFORMATION_SCHEMA.TABLES t2
  JOIN platform_resource_type_registry r ON r.status='active' AND JSON_VALID(r.read_models_json) AND JSON_CONTAINS(r.read_models_json,JSON_QUOTE(t2.TABLE_NAME))
  WHERE t2.TABLE_SCHEMA=DATABASE() AND t2.TABLE_TYPE='VIEW'
  GROUP BY t2.TABLE_NAME
) d ON d.surface_ref=t.TABLE_NAME
WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='VIEW'
ON DUPLICATE KEY UPDATE exposure_class=VALUES(exposure_class),resource_key=VALUES(resource_key),descriptor_requirement=VALUES(descriptor_requirement),operation_requirement=VALUES(operation_requirement),archive_requirement=VALUES(archive_requirement),version_requirement=VALUES(version_requirement),rationale=VALUES(rationale),source_policy_key=VALUES(source_policy_key),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_surface_policy_registry
  (surface_kind,surface_ref,exposure_class,resource_key,descriptor_requirement,operation_requirement,archive_requirement,version_requirement,rationale,source_policy_key,status)
SELECT 'tool',x.tool_key,IF(MIN(o.resource_key) IS NULL,'internal_tool','resource_tool'),MIN(o.resource_key),'not_applicable',IF(MIN(o.resource_key) IS NULL,'not_applicable','required'),'not_applicable','not_applicable',IF(MIN(o.resource_key) IS NULL,'Enabled internal tool; Resource API operation binding is not applicable.',CONCAT('Tool operation for logical resource ',MIN(o.resource_key),'.')),'platform_resource_api_coverage_policy_v1','active'
FROM (SELECT tool_key FROM admin_platform_endpoint_tools WHERE is_enabled=1 UNION SELECT tool_key FROM tenant_platform_endpoint_tools WHERE is_enabled=1) x
LEFT JOIN platform_resource_operation_registry o ON o.tool_key=x.tool_key AND o.status='active'
GROUP BY x.tool_key
ON DUPLICATE KEY UPDATE exposure_class=VALUES(exposure_class),resource_key=VALUES(resource_key),descriptor_requirement=VALUES(descriptor_requirement),operation_requirement=VALUES(operation_requirement),archive_requirement=VALUES(archive_requirement),version_requirement=VALUES(version_requirement),rationale=VALUES(rationale),source_policy_key=VALUES(source_policy_key),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

UPDATE execution_policies
   SET policy_value=JSON_SET(COALESCE(policy_value,JSON_OBJECT()),'$.surface_policy_required',TRUE,'$.internal_surfaces_require_explicit_not_applicable',TRUE,'$.surface_policy_registry','platform_resource_surface_policy_registry'),notes='New relations and tools require either logical resource coverage or an explicit active surface-policy decision.',updated_at=CURRENT_TIMESTAMP
 WHERE policy_group='Resource API Governance' AND policy_key='platform_resource_api_coverage_policy_v1';
