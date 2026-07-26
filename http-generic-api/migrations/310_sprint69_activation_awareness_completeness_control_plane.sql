-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Activation Awareness and Completeness Control Plane.
-- Additive only: preserves Dynamic Tabs, Dashboard, legacy full activation, and existing clients.
-- No provider call. No credential payload read. No raw secrets. No external send/write. secrets_included=false.

CREATE TABLE IF NOT EXISTS activation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(36) NOT NULL UNIQUE,
  session_id VARCHAR(128) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(128) NULL,
  idempotency_key VARCHAR(180) NULL,
  session_policy ENUM('reuse_or_create','create_new','reuse_only','read_only') NOT NULL DEFAULT 'reuse_or_create',
  response_profile ENUM('evidence','summary','dashboard','diagnostic','full') NOT NULL DEFAULT 'evidence',
  run_status ENUM('created','running','retrying','evidence_ready','delivered','failed','cancelled') NOT NULL DEFAULT 'created',
  validation_state ENUM('pending','complete','incomplete','degraded') NOT NULL DEFAULT 'pending',
  evidence_state ENUM('pending','complete','degraded') NOT NULL DEFAULT 'pending',
  delivery_state ENUM('not_prepared','prepared','delivered','delivery_failed') NOT NULL DEFAULT 'not_prepared',
  consumer_ack_state ENUM('not_received','acknowledged','rejected') NOT NULL DEFAULT 'not_received',
  retry_count INT UNSIGNED NOT NULL DEFAULT 0,
  snapshot_id VARCHAR(80) NULL,
  response_bytes INT UNSIGNED NULL,
  delivered_status_code INT NULL,
  projection_json JSON NULL,
  acknowledged_by VARCHAR(180) NULL,
  delivered_at DATETIME NULL,
  consumer_ack_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_runs_session (session_id, created_at),
  INDEX idx_activation_runs_subject (tenant_id, user_id, created_at),
  INDEX idx_activation_runs_idempotency (tenant_id, user_id, idempotency_key, created_at),
  INDEX idx_activation_runs_state (run_status, validation_state, delivery_state),
  INDEX idx_activation_runs_snapshot (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS activation_snapshot_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  snapshot_id VARCHAR(80) NOT NULL UNIQUE,
  run_id VARCHAR(36) NULL,
  session_id VARCHAR(128) NULL,
  tenant_id VARCHAR(36) NULL,
  user_id VARCHAR(128) NULL,
  registry_version VARCHAR(80) NULL,
  data_watermark DATETIME(3) NOT NULL,
  response_profile ENUM('evidence','summary','dashboard','diagnostic','full') NOT NULL DEFAULT 'evidence',
  subject_scope ENUM('platform_admin','tenant_user') NOT NULL,
  snapshot_status ENUM('prepared','delivered','acknowledged','expired') NOT NULL DEFAULT 'prepared',
  completeness_json JSON NULL,
  awareness_index_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_snapshot_run (run_id, created_at),
  INDEX idx_activation_snapshot_subject (tenant_id, user_id, created_at),
  INDEX idx_activation_snapshot_status (snapshot_status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS activation_response_profile_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profile_key VARCHAR(80) NOT NULL UNIQUE,
  display_name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  target_bytes INT UNSIGNED NOT NULL,
  hard_bytes INT UNSIGNED NOT NULL,
  include_full_dynamic_tabs TINYINT(1) NOT NULL DEFAULT 0,
  include_full_operational_intelligence TINYINT(1) NOT NULL DEFAULT 0,
  include_full_dashboard TINYINT(1) NOT NULL DEFAULT 0,
  include_selected_detail TINYINT(1) NOT NULL DEFAULT 0,
  default_for_admin TINYINT(1) NOT NULL DEFAULT 0,
  default_for_tenant TINYINT(1) NOT NULL DEFAULT 0,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_response_profile_status (status, priority_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activation_delivery_policy_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  policy_key VARCHAR(180) NOT NULL UNIQUE,
  surface_key_like VARCHAR(180) NULL,
  source_table_like VARCHAR(180) NULL,
  delivery_mode ENUM('manifest_only','summary','attention_first','top_n','rows','reference_only') NOT NULL DEFAULT 'attention_first',
  dedupe_scope ENUM('global','tenant','user','workspace','brand','system','none') NOT NULL DEFAULT 'none',
  inline_priority INT NOT NULL DEFAULT 100,
  max_inline_rows INT UNSIGNED NOT NULL DEFAULT 0,
  max_inline_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  supports_cursor TINYINT(1) NOT NULL DEFAULT 1,
  cache_ttl_seconds INT UNSIGNED NOT NULL DEFAULT 60,
  response_profiles_json JSON NULL,
  priority_order INT NOT NULL DEFAULT 100,
  status ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_activation_delivery_policy_lookup (status, priority_order, delivery_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE activation_dynamic_tab_section_registry
  ADD COLUMN IF NOT EXISTS delivery_mode ENUM('manifest_only','summary','attention_first','top_n','rows','reference_only') NULL AFTER aggregation_mode,
  ADD COLUMN IF NOT EXISTS inline_priority INT NOT NULL DEFAULT 100 AFTER delivery_mode,
  ADD COLUMN IF NOT EXISTS summary_projection_json JSON NULL AFTER inline_priority,
  ADD COLUMN IF NOT EXISTS attention_projection_json JSON NULL AFTER summary_projection_json,
  ADD COLUMN IF NOT EXISTS detail_tool_key VARCHAR(180) NULL AFTER attention_projection_json,
  ADD COLUMN IF NOT EXISTS dedupe_scope ENUM('global','tenant','user','workspace','brand','system','none') NULL AFTER detail_tool_key,
  ADD COLUMN IF NOT EXISTS max_inline_rows INT UNSIGNED NOT NULL DEFAULT 0 AFTER dedupe_scope,
  ADD COLUMN IF NOT EXISTS max_inline_bytes INT UNSIGNED NOT NULL DEFAULT 0 AFTER max_inline_rows,
  ADD COLUMN IF NOT EXISTS supports_cursor TINYINT(1) NOT NULL DEFAULT 1 AFTER max_inline_bytes,
  ADD COLUMN IF NOT EXISTS cache_ttl_seconds INT UNSIGNED NOT NULL DEFAULT 60 AFTER supports_cursor,
  ADD COLUMN IF NOT EXISTS freshness_policy_key VARCHAR(180) NULL AFTER cache_ttl_seconds,
  ADD COLUMN IF NOT EXISTS default_response_profiles_json JSON NULL AFTER freshness_policy_key;

INSERT INTO activation_response_profile_registry
(profile_key, display_name, description, target_bytes, hard_bytes,
 include_full_dynamic_tabs, include_full_operational_intelligence, include_full_dashboard,
 include_selected_detail, default_for_admin, default_for_tenant, priority_order, status)
VALUES
('evidence','Evidence','Complete awareness manifests, counts, permissions, attention, and governed detail references without full row hydration.',30000,40000,0,0,0,0,1,1,10,'active'),
('summary','Summary','Expanded operational summaries while deferring detailed rows to governed cursor reads.',45000,65000,0,0,0,0,0,0,20,'active'),
('dashboard','Dashboard','Dashboard manifests plus one explicitly selected detail surface.',90000,120000,0,0,0,1,0,0,30,'active'),
('diagnostic','Diagnostic','Administrative diagnostic profile with full dynamic surfaces and selected detail.',180000,250000,1,1,1,1,0,0,40,'active'),
('full','Full Compatibility','Legacy-compatible full Dynamic Tabs, Operational Intelligence, and Dashboard response.',350000,500000,1,1,1,0,0,0,50,'active')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), target_bytes=VALUES(target_bytes),
 hard_bytes=VALUES(hard_bytes), include_full_dynamic_tabs=VALUES(include_full_dynamic_tabs),
 include_full_operational_intelligence=VALUES(include_full_operational_intelligence),
 include_full_dashboard=VALUES(include_full_dashboard), include_selected_detail=VALUES(include_selected_detail),
 default_for_admin=VALUES(default_for_admin), default_for_tenant=VALUES(default_for_tenant),
 priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO activation_delivery_policy_registry
(policy_key, surface_key_like, source_table_like, delivery_mode, dedupe_scope,
 inline_priority, max_inline_rows, max_inline_bytes, supports_cursor, cache_ttl_seconds,
 response_profiles_json, priority_order, status)
VALUES
('activation.global.registry.reference',NULL,'activation_%_registry','reference_only','global',10,0,0,1,300,JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'),10,'active'),
('activation.operational.attention',NULL,'v_activation_pending_tasks','attention_first','tenant',20,5,12000,1,30,JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'),20,'active'),
('activation.connected.systems',NULL,'connected_systems','attention_first','tenant',30,5,12000,1,30,JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'),30,'active'),
('activation.agents.summary',NULL,'v_activation_agent_catalog','summary','tenant',40,0,0,1,60,JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'),40,'active'),
('activation.skills.attention',NULL,'v_activation_agent_skill_grants','attention_first','tenant',50,5,12000,1,60,JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'),50,'active'),
('activation.default.rows','%',NULL,'attention_first','none',100,5,12000,1,60,JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'),1000,'active')
ON DUPLICATE KEY UPDATE
 surface_key_like=VALUES(surface_key_like), source_table_like=VALUES(source_table_like),
 delivery_mode=VALUES(delivery_mode), dedupe_scope=VALUES(dedupe_scope), inline_priority=VALUES(inline_priority),
 max_inline_rows=VALUES(max_inline_rows), max_inline_bytes=VALUES(max_inline_bytes),
 supports_cursor=VALUES(supports_cursor), cache_ttl_seconds=VALUES(cache_ttl_seconds),
 response_profiles_json=VALUES(response_profiles_json), priority_order=VALUES(priority_order), status=VALUES(status);

UPDATE activation_dynamic_tab_section_registry
SET delivery_mode = COALESCE(delivery_mode,
      CASE WHEN aggregation_mode IN ('count','summary') THEN 'summary' ELSE 'attention_first' END),
    detail_tool_key = COALESCE(detail_tool_key, 'activation_dynamic_tab_detail_read_api'),
    dedupe_scope = COALESCE(dedupe_scope,
      CASE
        WHEN tenant_column IS NULL AND user_column IS NULL AND workspace_column IS NULL AND brand_key_column IS NULL AND system_id_column IS NULL THEN 'global'
        WHEN workspace_column IS NOT NULL THEN 'workspace'
        WHEN brand_key_column IS NOT NULL THEN 'brand'
        WHEN user_column IS NOT NULL THEN 'user'
        WHEN tenant_column IS NOT NULL THEN 'tenant'
        ELSE 'system'
      END),
    supports_cursor = 1,
    cache_ttl_seconds = CASE WHEN cache_ttl_seconds = 0 THEN 60 ELSE cache_ttl_seconds END,
    default_response_profiles_json = COALESCE(default_response_profiles_json, JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'))
WHERE status = 'active';

INSERT INTO activation_operational_tile_registry
(tile_key, provider_family, connector_family, scope_class, display_name, description, category,
 default_visibility, source_mode, status_callback_key, freshness_sla_seconds, priority_order, risk_level, status)
VALUES
('activation_awareness_coverage','platform','activation_awareness','mixed','Activation Awareness Coverage',
 'Shows Dynamic Tabs and Dashboard awareness coverage, completeness, freshness, deferred detail references, and response budget state.',
 'activation','owner_and_admin','platform_native','activation_awareness_read_api',60,6,'medium','active')
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name), description=VALUES(description), category=VALUES(category),
 default_visibility=VALUES(default_visibility), status_callback_key=VALUES(status_callback_key),
 freshness_sla_seconds=VALUES(freshness_sla_seconds), priority_order=VALUES(priority_order),
 risk_level=VALUES(risk_level), status=VALUES(status);

INSERT INTO activation_callback_registry
(callback_key, tile_key, provider_family, connector_family, intent_key, runtime_action_key,
 endpoint_selector, safe_mode, allowed_sources_json, output_contract_json,
 fallback_prompt_template_key, freshness_sla_seconds, priority_order, status)
VALUES
('activation_awareness_read','activation_awareness_coverage','platform','activation_awareness',
 'activation.awareness.read','activation_awareness_read_api','GET /activation/awareness','read_only',
 JSON_ARRAY('platform_native'),JSON_OBJECT('returns',JSON_ARRAY('snapshot','dynamic_tabs','dashboard','completeness','awareness_index'),'paginated_details',true,'secrets_included',false),NULL,60,6,'active'),
('activation_dynamic_tab_detail_read','activation_awareness_coverage','platform','activation_awareness',
 'activation.dynamic_tab.detail.read','activation_dynamic_tab_detail_read_api','GET /activation/dynamic-tabs/detail','read_only',
 JSON_ARRAY('platform_native'),JSON_OBJECT('returns',JSON_ARRAY('container','tab','sections','page'),'cursor_pagination',true,'secrets_included',false),NULL,60,7,'active')
ON DUPLICATE KEY UPDATE runtime_action_key=VALUES(runtime_action_key), endpoint_selector=VALUES(endpoint_selector),
 safe_mode=VALUES(safe_mode), allowed_sources_json=VALUES(allowed_sources_json),
 output_contract_json=VALUES(output_contract_json), freshness_sla_seconds=VALUES(freshness_sla_seconds),
 priority_order=VALUES(priority_order), status=VALUES(status);

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('activation_awareness_read_api','Read Activation Awareness','Read complete Dynamic Tabs and Dashboard awareness manifests, completeness, attention, freshness, and governed detail references. No secrets.','GET','/activation/awareness',JSON_ARRAY(),JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT('profile',JSON_OBJECT('type','string','enum',JSON_ARRAY('evidence','summary','dashboard','diagnostic','full')),'attention_limit',JSON_OBJECT('type','integer','minimum',1,'maximum',20))),NULL,'admin,activation,dynamic-tabs,dashboard,awareness,completeness,read_only,no_secrets',1,11870),
('activation_dynamic_tab_detail_read_api','Read Activation Dynamic Tab Detail','Read one authorized container tab or section with cursor pagination and snapshot context. No secrets.','GET','/activation/dynamic-tabs/detail',JSON_ARRAY(),JSON_OBJECT('type','object','additionalProperties',false,'required',JSON_ARRAY('container_key','tab_key'),'properties',JSON_OBJECT('container_key',JSON_OBJECT('type','string'),'tab_key',JSON_OBJECT('type','string'),'section_key',JSON_OBJECT('type','string'),'cursor',JSON_OBJECT('type','integer','minimum',0),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100),'snapshot_id',JSON_OBJECT('type','string'))),NULL,'admin,activation,dynamic-tabs,detail,cursor-pagination,read_only,no_secrets',1,11871),
('activation_run_ack_api','Acknowledge Activation Run','Record consumer acknowledgement for one activation run without changing activation evidence.','POST','/activation/runs/{runId}/ack',JSON_ARRAY('runId'),JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT('acknowledged_by',JSON_OBJECT('type','string'),'consumer_state',JSON_OBJECT('type','string','enum',JSON_ARRAY('acknowledged','rejected')))),NULL,'admin,activation,acknowledgement,state_changing,no_secrets',1,11872)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), description=VALUES(description),
 http_method=VALUES(http_method), http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys),
 input_schema=VALUES(input_schema), fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

INSERT INTO tenant_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('tenant_activation_awareness_read_api','Read Activation Awareness','Read the signed-in user tenant Dynamic Tabs and Dashboard awareness, completeness, attention, freshness, and governed detail references.','GET','/tenant/activation/awareness',JSON_ARRAY(),JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT('profile',JSON_OBJECT('type','string','enum',JSON_ARRAY('evidence','summary','dashboard')),'attention_limit',JSON_OBJECT('type','integer','minimum',1,'maximum',20))),NULL,'tenant,activation,dynamic-tabs,dashboard,awareness,read_only',1,1060),
('tenant_activation_dynamic_tab_detail_read_api','Read Activation Dynamic Tab Detail','Read one authorized tenant container tab or section with cursor pagination. Tenant scope is derived from JWT membership.','GET','/tenant/activation/dynamic-tabs/detail',JSON_ARRAY(),JSON_OBJECT('type','object','additionalProperties',false,'required',JSON_ARRAY('container_key','tab_key'),'properties',JSON_OBJECT('container_key',JSON_OBJECT('type','string'),'tab_key',JSON_OBJECT('type','string'),'section_key',JSON_OBJECT('type','string'),'cursor',JSON_OBJECT('type','integer','minimum',0),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100),'snapshot_id',JSON_OBJECT('type','string'))),NULL,'tenant,activation,dynamic-tabs,detail,pagination',1,1061)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), description=VALUES(description),
 http_method=VALUES(http_method), http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys),
 input_schema=VALUES(input_schema), fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled), sort_order=VALUES(sort_order);

UPDATE admin_platform_endpoint_tools
SET description = 'Runs evidence-first hard activation with Dynamic Tabs and Dashboard manifests. Supports response_profile evidence|summary|dashboard|diagnostic|full and idempotent session reuse.',
    input_schema = JSON_OBJECT('type','object','additionalProperties',false,'properties',JSON_OBJECT(
      'tenant_id',JSON_OBJECT('type','string'),
      'user_id',JSON_OBJECT('type','string'),
      'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',50,'default',10),
      'include_raw',JSON_OBJECT('type','boolean','default',false),
      'close_previous_sessions',JSON_OBJECT('type','boolean','default',false),
      'response_profile',JSON_OBJECT('type','string','enum',JSON_ARRAY('evidence','summary','dashboard','diagnostic','full'),'default','evidence'),
      'session_policy',JSON_OBJECT('type','string','enum',JSON_ARRAY('reuse_or_create','create_new','reuse_only','read_only'),'default','reuse_or_create'),
      'idempotency_key',JSON_OBJECT('type','string'),
      'conversation_ref',JSON_OBJECT('type','string'),
      'reuse_window_hours',JSON_OBJECT('type','integer','minimum',1,'maximum',168),
      'container_key',JSON_OBJECT('type','string'),
      'tab_key',JSON_OBJECT('type','string'),
      'section_key',JSON_OBJECT('type','string'),
      'detail_limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100),
      'provider_arguments',JSON_OBJECT('type','object')
    )),
    tags = 'activation,hard-activation,session-context,provider-bootstrap,evidence-matrix,dynamic-tabs,dashboard,completeness,idempotency,response-profile,admin,no_secrets'
WHERE tool_key = 'activation_hard_run';

CREATE OR REPLACE VIEW v_activation_awareness_latest_runs AS
SELECT r.run_id, r.session_id, r.tenant_id, r.user_id, r.idempotency_key, r.session_policy,
       r.response_profile, r.run_status, r.validation_state, r.evidence_state, r.delivery_state,
       r.consumer_ack_state, r.retry_count, r.snapshot_id, r.response_bytes,
       r.delivered_status_code, r.delivered_at, r.consumer_ack_at, r.created_at, r.updated_at
FROM activation_runs r
JOIN (
  SELECT tenant_id, COALESCE(user_id, '') AS user_scope, MAX(created_at) AS max_created_at
  FROM activation_runs
  GROUP BY tenant_id, COALESCE(user_id, '')
) latest
  ON latest.tenant_id = r.tenant_id
 AND latest.user_scope = COALESCE(r.user_id, '')
 AND latest.max_created_at = r.created_at;
