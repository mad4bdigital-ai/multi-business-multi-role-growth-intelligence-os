-- Sprint 69: self-discovering Resource API coverage gate and governed resource surfaces.
-- Safety: additive schema and registry seeds only. No provider calls, external sends,
-- destructive data changes, credential reads, or hard purge enablement.

CREATE TABLE IF NOT EXISTS platform_resource_type_registry (
  resource_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  scope_class VARCHAR(64) NOT NULL,
  authority_model VARCHAR(64) NOT NULL DEFAULT 'sql_runtime_authority',
  id_field VARCHAR(128) NOT NULL,
  source_tables_json LONGTEXT NOT NULL,
  read_models_json LONGTEXT NULL,
  operation_policy_json LONGTEXT NOT NULL,
  field_policy_json LONGTEXT NULL,
  search_policy_json LONGTEXT NULL,
  status ENUM('active','planned','disabled','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (resource_key),
  KEY idx_platform_resource_type_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_resource_operation_registry (
  operation_id VARCHAR(191) NOT NULL,
  resource_key VARCHAR(128) NOT NULL,
  actor_scope ENUM('admin','tenant','shared') NOT NULL,
  operation_key VARCHAR(64) NOT NULL,
  http_method VARCHAR(16) NOT NULL,
  http_path VARCHAR(512) NOT NULL,
  implementation_status ENUM('active','planned','blocked') NOT NULL DEFAULT 'active',
  route_file VARCHAR(255) NOT NULL,
  tool_key VARCHAR(191) NULL,
  readback_required TINYINT(1) NOT NULL DEFAULT 0,
  permissions_required TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_platform_resource_operation_tool (actor_scope, tool_key),
  KEY idx_platform_resource_operation_resource (resource_key, actor_scope, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_resource_coverage_runs (
  run_id VARCHAR(64) NOT NULL,
  trigger_source VARCHAR(64) NOT NULL,
  commit_sha VARCHAR(64) NULL,
  status ENUM('complete','debt_detected','gaps_detected','failed') NOT NULL,
  totals_json LONGTEXT NOT NULL,
  finding_count INT NOT NULL DEFAULT 0,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id),
  KEY idx_platform_resource_coverage_runs_created (created_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_resource_coverage_findings (
  finding_id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  severity ENUM('critical','high','medium','low','info') NOT NULL,
  finding_type VARCHAR(128) NOT NULL,
  surface_kind VARCHAR(64) NOT NULL,
  surface_ref VARCHAR(255) NOT NULL,
  resource_key VARCHAR(128) NULL,
  message TEXT NOT NULL,
  status ENUM('open','accepted_debt','resolved','false_positive') NOT NULL DEFAULT 'open',
  detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  PRIMARY KEY (finding_id),
  KEY idx_platform_resource_coverage_findings_run (run_id, severity, status),
  KEY idx_platform_resource_coverage_findings_surface (surface_kind, surface_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_platform_resource_api_coverage AS
SELECT r.resource_key,
       r.display_name,
       r.scope_class,
       r.status AS resource_status,
       COUNT(o.operation_id) AS operation_count,
       SUM(o.actor_scope='admin' AND o.status='active') AS admin_operation_count,
       SUM(o.actor_scope='tenant' AND o.status='active') AS tenant_operation_count,
       SUM(o.implementation_status='blocked') AS blocked_operation_count,
       MAX(o.updated_at) AS last_operation_update_at
  FROM platform_resource_type_registry r
  LEFT JOIN platform_resource_operation_registry o ON o.resource_key=r.resource_key
 GROUP BY r.resource_key,r.display_name,r.scope_class,r.status;

INSERT INTO database_table_lifecycle_registry
  (table_name, table_family, owner_engine_key, authority_model, usage_status,
   write_strategy, retention_class, archive_strategy, cleanup_strategy, growth_policy,
   linked_by_code, linked_by_policy, risk_level, status, notes, last_checked_at)
VALUES
  ('platform_resource_type_registry','resource_api_governance','database_table_lifecycle_engine','canonical','runtime_registry','platform_primary','platform_registry','manual_review','none','low_growth',1,1,'medium','active','Logical resource descriptors and operation policy authority.',CURRENT_TIMESTAMP),
  ('platform_resource_operation_registry','resource_api_governance','database_table_lifecycle_engine','canonical','runtime_registry','platform_primary','platform_registry','manual_review','none','medium_growth',1,1,'medium','active','Admin/Tenant resource operation and tool export authority.',CURRENT_TIMESTAMP),
  ('platform_resource_coverage_runs','resource_api_governance','database_table_lifecycle_engine','canonical','audit_log','platform_primary','operational_audit','time_partition_review','retention_policy','medium_growth',1,1,'low','active','Bounded resource coverage audit runs; no raw payloads.',CURRENT_TIMESTAMP),
  ('platform_resource_coverage_findings','resource_api_governance','database_table_lifecycle_engine','canonical','audit_log','platform_primary','operational_audit','status_then_time','resolved_finding_retention','medium_growth',1,1,'medium','active','Typed resource API coverage findings and resolution state.',CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  table_family=VALUES(table_family), owner_engine_key=VALUES(owner_engine_key),
  authority_model=VALUES(authority_model), usage_status=VALUES(usage_status),
  write_strategy=VALUES(write_strategy), retention_class=VALUES(retention_class),
  archive_strategy=VALUES(archive_strategy), cleanup_strategy=VALUES(cleanup_strategy),
  growth_policy=VALUES(growth_policy), linked_by_code=VALUES(linked_by_code),
  linked_by_policy=VALUES(linked_by_policy), risk_level=VALUES(risk_level),
  status=VALUES(status), notes=VALUES(notes), last_checked_at=VALUES(last_checked_at),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_type_registry
  (resource_key,display_name,scope_class,authority_model,id_field,source_tables_json,
   read_models_json,operation_policy_json,field_policy_json,search_policy_json,status)
VALUES
  ('sessions','Sessions','tenant_user','sql_runtime_authority','session_id',
   JSON_ARRAY('customer_sessions','gpt_session_turns','session_summaries','session_events','gpt_session_conversation_refs'),
   JSON_ARRAY('v_gpt_session_archive_monitoring'),
   JSON_OBJECT('list','active','get','active','search','active','permissions','active','changes','active','revisions','active','readback','active','purge','blocked_by_policy'),
   JSON_OBJECT('raw_turn_content',FALSE,'credential_values',FALSE,'safe_projection','descriptor_owned'),
   JSON_OBJECT('mode','bounded_like','pagination','keyset'),'active'),
  ('executions','Executions','tenant_workspace','sql_runtime_authority','id',
   JSON_ARRAY('execution_log','audit_payload_evidence'),
   JSON_ARRAY('v_execution_log_runtime_evidence_recent','v_execution_log_full_context_evidence_recent'),
   JSON_OBJECT('list','active','get','active','search','active','permissions','active','changes','active','revisions','not_applicable','readback','active','mutations','blocked_by_policy'),
   JSON_OBJECT('evidence_json',FALSE,'credential_refs',FALSE,'safe_projection','descriptor_owned'),
   JSON_OBJECT('mode','bounded_like','pagination','keyset'),'active'),
  ('assets','Workspace Assets','tenant_workspace','sql_runtime_authority','asset_id',
   JSON_ARRAY('workspace_assets','workspace_vaults'),JSON_ARRAY(),
   JSON_OBJECT('list','active','get','active','search','active','permissions','active','changes','active','revisions','not_yet_versioned','readback','active','create','active','update','active','archive','active','restore','active','purge','blocked_by_policy'),
   JSON_OBJECT('safe_projection','descriptor_owned','write_fields','allowlist'),
   JSON_OBJECT('mode','bounded_like','pagination','keyset'),'active'),
  ('approvals','Approval Holds','tenant_workspace_user','sql_runtime_authority','hold_id',
   JSON_ARRAY('approval_holds'),JSON_ARRAY('v_approval_hold_parent_resolution'),
   JSON_OBJECT('list','active','get','active','search','active','permissions','active','changes','active','revisions','not_yet_versioned','readback','active','mutations','existing_workflows_only'),
   JSON_OBJECT('execution_context',FALSE,'safe_projection','descriptor_owned'),
   JSON_OBJECT('mode','bounded_like','pagination','keyset'),'active'),
  ('resource_api_governance','Resource API Governance','platform_admin','sql_runtime_authority','resource_key',
   JSON_ARRAY('platform_resource_type_registry','platform_resource_operation_registry','platform_resource_coverage_runs','platform_resource_coverage_findings'),
   JSON_ARRAY('v_platform_resource_api_coverage'),
   JSON_OBJECT('list','active','get','active','search','active','permissions','active','changes','active','revisions','not_applicable','readback','active','mutations','migration_only'),
   JSON_OBJECT('safe_projection','registry_only','secrets_included',FALSE),
   JSON_OBJECT('mode','registry_filters'),'active')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),scope_class=VALUES(scope_class),authority_model=VALUES(authority_model),
  id_field=VALUES(id_field),source_tables_json=VALUES(source_tables_json),read_models_json=VALUES(read_models_json),
  operation_policy_json=VALUES(operation_policy_json),field_policy_json=VALUES(field_policy_json),
  search_policy_json=VALUES(search_policy_json),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools
  (tool_key,display_name,description,http_method,http_path,path_param_keys,input_schema,fixed_body,tags,is_enabled,sort_order)
VALUES
  ('platform_resource_types_list','Platform Resource Types List','List governed logical resource descriptors.','GET','/admin/resource-types','[]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,coverage_governance,read_only,no_secrets,admin',1,12000),
  ('platform_resource_type_get','Platform Resource Type Get','Read one governed resource descriptor.','GET','/admin/resource-types/{resourceKey}','["resourceKey"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,coverage_governance,read_only,no_secrets,admin',1,12001),
  ('platform_resource_list','Platform Resource List','List and search a governed resource type.','GET','/admin/resources/{resourceKey}','["resourceKey"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,search,pagination,read_only,no_secrets,admin',1,12002),
  ('platform_resource_get','Platform Resource Get','Read one governed resource with safe projection.','GET','/admin/resources/{resourceKey}/{resourceId}','["resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,read_only,no_secrets,admin',1,12003),
  ('platform_resource_create','Platform Resource Create','Create through an enabled resource adapter.','POST','/admin/resources/{resourceKey}','["resourceKey"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,mutation,readback,no_secrets,admin',1,12004),
  ('platform_resource_update','Platform Resource Update','Update allowlisted resource fields.','PATCH','/admin/resources/{resourceKey}/{resourceId}','["resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,mutation,readback,no_secrets,admin',1,12005),
  ('platform_resource_archive','Platform Resource Archive','Archive without hard deletion.','DELETE','/admin/resources/{resourceKey}/{resourceId}','["resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,archive,mutation,readback,no_secrets,admin',1,12006),
  ('platform_resource_restore','Platform Resource Restore','Restore an archived resource.','POST','/admin/resources/{resourceKey}/{resourceId}/restore','["resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,restore,mutation,readback,no_secrets,admin',1,12007),
  ('platform_resource_purge','Platform Resource Purge Gate','Fail-closed hard purge gate.','POST','/admin/resources/{resourceKey}/{resourceId}/purge','["resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,purge,blocked_by_policy,no_secrets,admin',1,12008),
  ('platform_resource_permissions_get','Platform Resource Permissions Get','Read effective resource capabilities.','GET','/admin/resources/{resourceKey}/{resourceId}/permissions','["resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,permissions,read_only,no_secrets,admin',1,12009),
  ('platform_resource_revisions_list','Platform Resource Revisions List','Read resource revision projections.','GET','/admin/resources/{resourceKey}/{resourceId}/revisions','["resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,revisions,read_only,no_secrets,admin',1,12010),
  ('platform_resource_changes_list','Platform Resource Changes List','Read resource change projections.','GET','/admin/resource-changes','[]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,changes,pagination,read_only,no_secrets,admin',1,12011),
  ('platform_resource_coverage_audit','Platform Resource Coverage Audit','Discover and persist bounded resource coverage findings.','GET','/admin/resource-coverage/audit','[]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,coverage_governance,audit,read_only,no_secrets,admin',1,12012),
  ('platform_operation_get','Platform Operation Get','Read one execution operation.','GET','/admin/operations/{operationId}','["operationId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,operations,readback,read_only,no_secrets,admin',1,12013),
  ('gpt_session_list','GPT Session List','List and search sessions safely.','GET','/gpt/sessions','[]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,sessions,search,pagination,read_only,no_secrets',1,12014),
  ('gpt_session_get','GPT Session Get','Read session metadata.','GET','/gpt/sessions/{id}','["id"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,sessions,read_only,no_secrets',1,12015),
  ('gpt_session_turns_list','GPT Session Turns List','Read bounded turn previews only.','GET','/gpt/sessions/{id}/turns','["id"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,sessions,turns,pagination,read_only,no_secrets',1,12016),
  ('gpt_session_summary_get','GPT Session Summary Get','Read the latest session summary.','GET','/gpt/sessions/{id}/summary','["id"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,sessions,summary,read_only,no_secrets',1,12017),
  ('gpt_session_events_list','GPT Session Events List','Read bounded redacted session events.','GET','/gpt/sessions/{id}/events','["id"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,sessions,events,pagination,read_only,no_secrets',1,12018),
  ('gpt_session_transcript_preview','GPT Session Transcript Preview','Read transcript previews without full content.','GET','/gpt/sessions/{id}/transcript','["id"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,sessions,transcript_preview,read_only,no_secrets',1,12019),
  ('gpt_session_summary_generate','GPT Session Summary Generate','Generate a summary with same-cycle readback.','POST','/gpt/sessions/{id}/summary/generate','["id"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,sessions,summary,mutation,readback,no_secrets',1,12020)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),description=VALUES(description),http_method=VALUES(http_method),
  http_path=VALUES(http_path),path_param_keys=VALUES(path_param_keys),input_schema=VALUES(input_schema),
  tags=VALUES(tags),is_enabled=VALUES(is_enabled),sort_order=VALUES(sort_order),updated_at=CURRENT_TIMESTAMP;

INSERT INTO tenant_platform_endpoint_tools
  (tool_key,display_name,description,http_method,http_path,path_param_keys,input_schema,fixed_body,tags,is_enabled,sort_order)
VALUES
  ('tenant_resource_catalog','Tenant Resource Catalog','List resource types available to the signed-in member.','GET','/me/workspaces/{tenant_id}/resources','["tenant_id"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,read_only,no_secrets',1,12000),
  ('tenant_resource_list','Tenant Resource List','List and search tenant-scoped resources.','GET','/me/workspaces/{tenant_id}/resources/{resourceKey}','["tenant_id","resourceKey"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,search,pagination,read_only,no_secrets',1,12001),
  ('tenant_resource_get','Tenant Resource Get','Read one authorized tenant resource.','GET','/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}','["tenant_id","resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,read_only,no_secrets',1,12002),
  ('tenant_resource_create','Tenant Resource Create','Create through an enabled tenant adapter.','POST','/me/workspaces/{tenant_id}/resources/{resourceKey}','["tenant_id","resourceKey"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,mutation,readback,no_secrets',1,12003),
  ('tenant_resource_update','Tenant Resource Update','Update an authorized tenant resource.','PATCH','/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}','["tenant_id","resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,mutation,readback,no_secrets',1,12004),
  ('tenant_resource_archive','Tenant Resource Archive','Archive without hard deletion.','DELETE','/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}','["tenant_id","resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,archive,mutation,readback,no_secrets',1,12005),
  ('tenant_resource_restore','Tenant Resource Restore','Restore with owner/admin authority.','POST','/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/restore','["tenant_id","resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,restore,mutation,readback,no_secrets',1,12006),
  ('tenant_resource_permissions_get','Tenant Resource Permissions Get','Read effective tenant resource capabilities.','GET','/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/permissions','["tenant_id","resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,permissions,read_only,no_secrets',1,12007),
  ('tenant_resource_revisions_list','Tenant Resource Revisions List','Read authorized revision projections.','GET','/me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/revisions','["tenant_id","resourceKey","resourceId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,revisions,read_only,no_secrets',1,12008),
  ('tenant_resource_changes_list','Tenant Resource Changes List','Read tenant-scoped change projections.','GET','/me/workspaces/{tenant_id}/resource-changes','["tenant_id"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,changes,pagination,read_only,no_secrets',1,12009),
  ('tenant_operation_get','Tenant Operation Get','Read one tenant-authorized execution.','GET','/me/workspaces/{tenant_id}/operations/{operationId}','["tenant_id","operationId"]',JSON_OBJECT('type','object','additionalProperties',TRUE),NULL,'resource_api,tenant_scoped,operations,readback,read_only,no_secrets',1,12010)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),description=VALUES(description),http_method=VALUES(http_method),
  http_path=VALUES(http_path),path_param_keys=VALUES(path_param_keys),input_schema=VALUES(input_schema),
  tags=VALUES(tags),is_enabled=VALUES(is_enabled),sort_order=VALUES(sort_order);

INSERT INTO platform_resource_operation_registry
  (operation_id,resource_key,actor_scope,operation_key,http_method,http_path,implementation_status,
   route_file,tool_key,readback_required,permissions_required,status)
SELECT CONCAT('resource_op_admin_',tool_key),
       CASE WHEN tool_key LIKE 'gpt_session_%' THEN 'sessions'
            WHEN tool_key='platform_operation_get' THEN 'executions'
            ELSE 'resource_api_governance' END,
       CASE WHEN tool_key LIKE 'gpt_session_%' THEN 'shared' ELSE 'admin' END,
       CASE WHEN tool_key LIKE '%permissions%' THEN 'permissions'
            WHEN tool_key LIKE '%revisions%' THEN 'revisions'
            WHEN tool_key LIKE '%changes%' THEN 'changes'
            WHEN tool_key LIKE '%create' OR tool_key LIKE '%generate' THEN 'create'
            WHEN tool_key LIKE '%update' THEN 'update'
            WHEN tool_key LIKE '%archive' THEN 'archive'
            WHEN tool_key LIKE '%restore' THEN 'restore'
            WHEN tool_key LIKE '%purge' THEN 'purge'
            WHEN tool_key LIKE '%list' OR tool_key LIKE '%catalog' THEN 'list'
            ELSE 'get' END,
       http_method,http_path,
       IF(tool_key='platform_resource_purge','blocked','active'),
       'routes/resourceApiRoutes.js',tool_key,IF(http_method='GET',0,1),1,'active'
  FROM admin_platform_endpoint_tools
 WHERE is_enabled=1 AND tags LIKE '%resource_api%'
ON DUPLICATE KEY UPDATE
  resource_key=VALUES(resource_key),actor_scope=VALUES(actor_scope),operation_key=VALUES(operation_key),
  http_method=VALUES(http_method),http_path=VALUES(http_path),implementation_status=VALUES(implementation_status),
  route_file=VALUES(route_file),tool_key=VALUES(tool_key),readback_required=VALUES(readback_required),
  permissions_required=VALUES(permissions_required),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_resource_operation_registry
  (operation_id,resource_key,actor_scope,operation_key,http_method,http_path,implementation_status,
   route_file,tool_key,readback_required,permissions_required,status)
SELECT CONCAT('resource_op_tenant_',tool_key),
       IF(tool_key='tenant_operation_get','executions','resource_api_governance'),
       'tenant',
       CASE WHEN tool_key LIKE '%permissions%' THEN 'permissions'
            WHEN tool_key LIKE '%revisions%' THEN 'revisions'
            WHEN tool_key LIKE '%changes%' THEN 'changes'
            WHEN tool_key LIKE '%create' THEN 'create'
            WHEN tool_key LIKE '%update' THEN 'update'
            WHEN tool_key LIKE '%archive' THEN 'archive'
            WHEN tool_key LIKE '%restore' THEN 'restore'
            WHEN tool_key LIKE '%list' OR tool_key LIKE '%catalog' THEN 'list'
            ELSE 'get' END,
       http_method,http_path,'active','routes/resourceApiRoutes.js',tool_key,
       IF(http_method='GET',0,1),1,'active'
  FROM tenant_platform_endpoint_tools
 WHERE is_enabled=1 AND tags LIKE '%resource_api%'
ON DUPLICATE KEY UPDATE
  resource_key=VALUES(resource_key),actor_scope=VALUES(actor_scope),operation_key=VALUES(operation_key),
  http_method=VALUES(http_method),http_path=VALUES(http_path),implementation_status=VALUES(implementation_status),
  route_file=VALUES(route_file),tool_key=VALUES(tool_key),readback_required=VALUES(readback_required),
  permissions_required=VALUES(permissions_required),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies
  (policy_group,policy_key,policy_value,active,execution_scope,affects_layer,blocking,notes)
VALUES
  ('Resource API Governance','platform_resource_api_coverage_policy_v1',
   JSON_OBJECT('new_feature_gate','fail_closed','resource_descriptor_required',TRUE,
     'list_get_search_required',TRUE,'permissions_required',TRUE,'changes_required',TRUE,
     'readback_required_for_mutations',TRUE,'openapi_contract_required',TRUE,
     'test_manifest_entry_required',TRUE,'tenant_scope_server_resolved',TRUE,
     'raw_sql_resource_endpoint_forbidden',TRUE,'hard_purge_default',FALSE,
     'expiring_exemptions_only',TRUE,'secrets_included',FALSE),
   'TRUE','admin|tenant|resource_api|ci_gate',
   'resourceApiRoutes|resourceApiCoverageService|resource-api-coverage-audit|openapi|test-manifest|ci',
   'TRUE','New tables, views, routes, and exported tools require governed resource coverage before merge.'),
  ('Resource API Governance','platform_resource_api_secret_field_policy_v1',
   JSON_OBJECT('field_allowlist_required',TRUE,'secret_values_never_returned',TRUE,
     'raw_session_content_default',FALSE,'credential_payload_default',FALSE,
     'tenant_identity_override_allowed',FALSE,'secrets_included',FALSE),
   'TRUE','admin|tenant|resource_api','resourceApiRoutes|resourceApiCoverageService',
   'TRUE','Resource SQL and safe projections are descriptor owned; tenant identity comes from JWT and membership.')
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),active=VALUES(active),execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),blocking=VALUES(blocking),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;
