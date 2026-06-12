-- Sprint 68: Platform Health Scorecard operationalization
-- Purpose:
--   Operationalize the DB-backed Platform Health Scorecard with snapshot history,
--   component/remediation registries, tenant rollout readback, and migration ledger hygiene.
-- Safety:
--   Additive/idempotent metadata/readback migration. No provider calls. No external writes. No secrets.

CREATE TABLE IF NOT EXISTS platform_health_scorecard_component_registry (
  component_key VARCHAR(128) NOT NULL PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  source_view VARCHAR(191) NOT NULL DEFAULT 'v_platform_health_scorecard_components',
  severity_on_fail ENUM('info','warn','fail','critical') NOT NULL DEFAULT 'fail',
  default_remediation_key VARCHAR(128) NULL,
  owner_scope VARCHAR(64) NOT NULL DEFAULT 'platform_admin',
  status ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  metadata_json LONGTEXT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS platform_health_scorecard_remediation_registry (
  remediation_key VARCHAR(128) NOT NULL PRIMARY KEY,
  component_key VARCHAR(128) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  remediation_mode ENUM('readback_only','dry_run_first','approval_required','manual_review') NOT NULL DEFAULT 'dry_run_first',
  recommended_tool_key VARCHAR(128) NULL,
  recommended_route VARCHAR(512) NULL,
  can_auto_fix TINYINT(1) NOT NULL DEFAULT 0,
  requires_approval TINYINT(1) NOT NULL DEFAULT 1,
  dry_run_payload_json LONGTEXT NULL,
  safety_contract_json LONGTEXT NULL,
  status ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_phscr_component (component_key)
);

CREATE TABLE IF NOT EXISTS platform_health_scorecard_snapshots (
  snapshot_id CHAR(36) NOT NULL PRIMARY KEY,
  scorecard_key VARCHAR(128) NOT NULL DEFAULT 'platform_health_scorecard',
  overall_status ENUM('pass','warn','fail') NOT NULL,
  component_count INT UNSIGNED NOT NULL DEFAULT 0,
  pass_count INT UNSIGNED NOT NULL DEFAULT 0,
  warn_count INT UNSIGNED NOT NULL DEFAULT 0,
  fail_count INT UNSIGNED NOT NULL DEFAULT 0,
  components_json LONGTEXT NULL,
  recorded_by VARCHAR(191) NULL,
  trigger_source VARCHAR(128) NOT NULL DEFAULT 'manual_readback',
  metadata_json LONGTEXT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_phs_created (created_at),
  INDEX idx_phs_status (overall_status)
);

INSERT INTO platform_health_scorecard_component_registry
  (component_key, display_name, description, severity_on_fail, default_remediation_key, metadata_json)
VALUES
  ('schema_contract_health','Schema Contract Health','Ensures active/runtime-ready endpoints have schema contracts and actions no longer depend on legacy runtime file ids.','fail','remediate_schema_contract_health',JSON_OBJECT('source','platform_health_scorecard','secrets_included',false)),
  ('tool_bus_health','Tool Bus Health','Ensures no recursive tenant dispatcher wrappers and no invalid admin tool input schemas.','fail','remediate_tool_bus_health',JSON_OBJECT('source','platform_health_scorecard','secrets_included',false)),
  ('orchestration_graph_health','Orchestration Graph Health','Ensures platform orchestration graphs are active, complete, read-only, and no-secret.','fail','remediate_orchestration_graph_health',JSON_OBJECT('source','platform_health_scorecard','secrets_included',false)),
  ('external_delivery_health','External Delivery Health','Ensures External Delivery graph remains no-send, no-secret, and completion-certification capable.','fail','remediate_external_delivery_health',JSON_OBJECT('source','platform_health_scorecard','secrets_included',false)),
  ('migration_authorization_health','Migration Authorization Health','Ensures recent applied migrations are represented in the DB-backed governed migration authorization registry.','fail','remediate_migration_authorization_health',JSON_OBJECT('source','platform_health_scorecard','secrets_included',false)),
  ('release_readiness_health','Release Readiness Health','Ensures the latest release readiness run is pass/warn/fail visible in the scorecard.','fail','remediate_release_readiness_health',JSON_OBJECT('source','platform_health_scorecard','secrets_included',false)),
  ('provider_credential_health','Provider Credential Health','Ensures connected systems and credential metadata have no active error state; raw credential payloads are never read.','warn','remediate_provider_credential_health',JSON_OBJECT('source','platform_health_scorecard','secrets_included',false))
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  severity_on_fail=VALUES(severity_on_fail),
  default_remediation_key=VALUES(default_remediation_key),
  status='active',
  metadata_json=VALUES(metadata_json),
  secrets_included=0,
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_health_scorecard_remediation_registry
  (remediation_key, component_key, display_name, description, remediation_mode, recommended_tool_key, recommended_route, can_auto_fix, requires_approval, dry_run_payload_json, safety_contract_json, notes)
VALUES
  ('remediate_schema_contract_health','schema_contract_health','Re-run schema contract completion diagnostics','Run schema inventory and repair missing endpoint contracts via governed schema import or synthetic endpoint-native contracts.','dry_run_first','platform_health_scorecard','/platform/health/scorecard',0,1,JSON_OBJECT('include_components',true),JSON_OBJECT('no_provider_call',true,'no_external_write',true,'no_raw_secrets',true,'secrets_included',false),'Use governed schema import/synthetic contract migrations only after dry-run evidence.'),
  ('remediate_tool_bus_health','tool_bus_health','Inspect Tool Bus registry and recursive wrappers','Review tenant/admin tool registry and disable only unsafe recursive generic wrappers while preserving named system-layer tools.','dry_run_first','platform_health_scorecard','/platform/health/scorecard',0,1,JSON_OBJECT('include_components',true),JSON_OBJECT('no_provider_call',true,'no_external_write',true,'no_raw_secrets',true,'secrets_included',false),'Do not disable named tenant system-layer tools tagged system_layer_tool.'),
  ('remediate_orchestration_graph_health','orchestration_graph_health','Inspect orchestration graph readiness','Read platform orchestration graph readiness and seed/fix graph stages, edges, policies, and readback views through migrations.','dry_run_first','platform_orchestration_readback','/platform/orchestration/readback',0,1,JSON_OBJECT('include_snapshots',false,'include_recommendations',false),JSON_OBJECT('no_provider_call',true,'no_external_write',true,'no_raw_secrets',true,'secrets_included',false),'Graph changes must remain readback-first with explicit safety contracts.'),
  ('remediate_external_delivery_health','external_delivery_health','Inspect External Delivery no-send graph','Read External Delivery graph/readiness and repair missing no-send tags or policy metadata via governed migrations.','dry_run_first','platform_orchestration_readback','/platform/orchestration/readback',0,1,JSON_OBJECT('plugin_key','support_ticket_external_delivery_orchestrator','include_snapshots',false,'include_recommendations',false),JSON_OBJECT('no_external_send',true,'live_external_send_enabled',false,'no_raw_secrets',true,'secrets_included',false),'Never enable live external send from this remediation path.'),
  ('remediate_migration_authorization_health','migration_authorization_health','Reconcile migration authorization registry','Identify recent applied migrations missing DB authorization rows and seed authorization metadata via governed migration.','approval_required','platform_health_scorecard_ledger_hygiene_report','/platform/health/scorecard/ledger-hygiene',0,1,JSON_OBJECT('limit',50),JSON_OBJECT('no_provider_call',true,'no_external_write',true,'no_raw_secrets',true,'secrets_included',false),'Authorization reconciliation must preserve audit history.'),
  ('remediate_release_readiness_health','release_readiness_health','Run release readiness','Run release readiness and inspect failing/warning surfaces before merge or rollout.','manual_review','release_readiness',NULL,0,1,JSON_OBJECT(),JSON_OBJECT('no_provider_call',true,'no_external_write',true,'no_raw_secrets',true,'secrets_included',false),'Release readiness execution is diagnostic; fix failures with separate PRs/migrations.'),
  ('remediate_provider_credential_health','provider_credential_health','Inspect credential metadata readiness','Inspect connected system/credential metadata without reading raw secret payloads.','manual_review','platform_health_scorecard','/platform/health/scorecard',0,1,JSON_OBJECT('include_components',true),JSON_OBJECT('no_credential_payload_read',true,'no_raw_secrets',true,'no_provider_call',true,'secrets_included',false),'Provider remediation may require explicit approval and dedicated credential workflow.' )
ON DUPLICATE KEY UPDATE
  component_key=VALUES(component_key),
  display_name=VALUES(display_name),
  description=VALUES(description),
  remediation_mode=VALUES(remediation_mode),
  recommended_tool_key=VALUES(recommended_tool_key),
  recommended_route=VALUES(recommended_route),
  can_auto_fix=VALUES(can_auto_fix),
  requires_approval=VALUES(requires_approval),
  dry_run_payload_json=VALUES(dry_run_payload_json),
  safety_contract_json=VALUES(safety_contract_json),
  status='active',
  notes=VALUES(notes),
  secrets_included=0,
  updated_at=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_platform_health_scorecard_component_registry_readback AS
SELECT
  c.component_key,
  c.status AS current_status,
  r.display_name,
  r.description,
  r.severity_on_fail,
  r.default_remediation_key,
  rem.remediation_mode,
  rem.recommended_tool_key,
  rem.recommended_route,
  rem.can_auto_fix,
  rem.requires_approval,
  c.evidence_json,
  GREATEST(c.secrets_included, r.secrets_included, COALESCE(rem.secrets_included,0)) AS secrets_included
FROM v_platform_health_scorecard_components c
LEFT JOIN platform_health_scorecard_component_registry r ON r.component_key = c.component_key AND r.status='active'
LEFT JOIN platform_health_scorecard_remediation_registry rem ON rem.remediation_key = r.default_remediation_key AND rem.status='active';

CREATE OR REPLACE VIEW v_platform_health_scorecard_remediation_plan AS
SELECT
  component_key,
  current_status,
  display_name,
  severity_on_fail,
  default_remediation_key AS remediation_key,
  remediation_mode,
  recommended_tool_key,
  recommended_route,
  can_auto_fix,
  requires_approval,
  evidence_json,
  CASE
    WHEN current_status='pass' THEN 'no_action_required'
    WHEN can_auto_fix=1 AND requires_approval=0 THEN 'auto_fix_available'
    WHEN remediation_mode='dry_run_first' THEN 'dry_run_recommended'
    WHEN remediation_mode='approval_required' THEN 'approval_required'
    ELSE 'manual_review_required'
  END AS recommended_action_status,
  secrets_included
FROM v_platform_health_scorecard_component_registry_readback;

CREATE OR REPLACE VIEW v_platform_health_scorecard_history AS
SELECT
  snapshot_id,
  scorecard_key,
  overall_status,
  component_count,
  pass_count,
  warn_count,
  fail_count,
  recorded_by,
  trigger_source,
  created_at,
  secrets_included
FROM platform_health_scorecard_snapshots
ORDER BY created_at DESC;

CREATE OR REPLACE VIEW v_platform_health_scorecard_tenant_rollout_readiness AS
SELECT
  t.tenant_id,
  t.display_name,
  t.tenant_type,
  t.status AS tenant_status,
  COALESCE(cs.connected_system_count,0) AS connected_system_count,
  COALESCE(cs.active_system_count,0) AS active_system_count,
  COALESCE(cs.error_system_count,0) AS error_system_count,
  COALESCE(tp.enabled_tenant_tool_count,0) AS enabled_tenant_tool_count,
  COALESCE(tp.system_layer_tool_count,0) AS system_layer_tool_count,
  CASE
    WHEN t.status <> 'active' THEN 'tenant_not_active'
    WHEN COALESCE(cs.error_system_count,0) > 0 THEN 'provider_attention_required'
    WHEN COALESCE(cs.active_system_count,0) > 0 OR COALESCE(tp.enabled_tenant_tool_count,0) > 0 THEN 'ready_or_partially_ready'
    ELSE 'needs_onboarding'
  END AS rollout_status,
  JSON_OBJECT(
    'tenant_id', t.tenant_id,
    'tenant_status', t.status,
    'connected_system_count', COALESCE(cs.connected_system_count,0),
    'active_system_count', COALESCE(cs.active_system_count,0),
    'error_system_count', COALESCE(cs.error_system_count,0),
    'enabled_tenant_tool_count', COALESCE(tp.enabled_tenant_tool_count,0),
    'system_layer_tool_count', COALESCE(tp.system_layer_tool_count,0),
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM tenants t
LEFT JOIN (
  SELECT tenant_id,
         COUNT(*) AS connected_system_count,
         SUM(status='active') AS active_system_count,
         SUM(status IN ('error','failed')) AS error_system_count
  FROM connected_systems
  GROUP BY tenant_id
) cs ON cs.tenant_id = t.tenant_id
LEFT JOIN (
  SELECT COUNT(*) AS enabled_tenant_tool_count,
         SUM(tags LIKE '%system_layer_tool%') AS system_layer_tool_count
  FROM tenant_platform_endpoint_tools
  WHERE is_enabled=1
) tp ON 1=1;

CREATE OR REPLACE VIEW v_platform_health_scorecard_ledger_hygiene AS
SELECT
  migration_file,
  migration_checksum_sha256,
  mode,
  COUNT(*) AS run_count,
  MIN(applied_at) AS first_applied_at,
  MAX(applied_at) AS last_applied_at,
  SUM(preflight_risk_count) AS total_preflight_risk_count,
  SUM(secrets_included) AS secrets_rows,
  CASE
    WHEN COUNT(*) > 1 THEN 'duplicate_ledger_entries'
    ELSE 'single_entry'
  END AS hygiene_status,
  JSON_OBJECT(
    'migration_file', migration_file,
    'mode', mode,
    'run_count', COUNT(*),
    'first_applied_at', MIN(applied_at),
    'last_applied_at', MAX(applied_at),
    'total_preflight_risk_count', SUM(preflight_risk_count),
    'secrets_rows', SUM(secrets_included),
    'secrets_included', false
  ) AS evidence_json,
  0 AS secrets_included
FROM governed_migration_ledger
GROUP BY migration_file, migration_checksum_sha256, mode
HAVING COUNT(*) > 1 OR SUM(preflight_risk_count) > 0 OR SUM(secrets_included) > 0
ORDER BY last_applied_at DESC;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order, created_at, updated_at)
VALUES
  ('platform_health_scorecard_snapshot_record','Platform Health Scorecard Snapshot Record','Records a read-only scorecard snapshot into platform_health_scorecard_snapshots.','POST','/platform/health/scorecard/snapshot-record',NULL,'{"type":"object","properties":{"recorded_by":{"type":"string"},"trigger_source":{"type":"string"},"metadata":{"type":"object"}}}',NULL,'platform,health,scorecard,snapshot,readback,no_provider_call,no_secrets',1,1201,NOW(),CURRENT_TIMESTAMP),
  ('platform_health_scorecard_remediation_plan','Platform Health Scorecard Remediation Plan','Returns DB-backed remediation guidance for Platform Health Scorecard components.','POST','/platform/health/scorecard/remediation-plan',NULL,'{"type":"object","properties":{"include_passing":{"type":"boolean","default":false}}}',NULL,'platform,health,scorecard,remediation,readback,no_provider_call,no_secrets',1,1202,NOW(),CURRENT_TIMESTAMP),
  ('platform_health_scorecard_tenant_rollout_readiness','Platform Health Scorecard Tenant Rollout Readiness','Returns tenant rollout readiness summary derived from tenant, connector, and tenant-tool metadata.','POST','/platform/health/scorecard/tenant-rollout',NULL,'{"type":"object","properties":{"status":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":500}}}',NULL,'platform,health,scorecard,tenant,rollout,readback,no_provider_call,no_secrets',1,1203,NOW(),CURRENT_TIMESTAMP),
  ('platform_health_scorecard_ledger_hygiene_report','Platform Health Scorecard Ledger Hygiene Report','Returns non-destructive governed migration ledger hygiene findings such as duplicate entries or risky rows.','POST','/platform/health/scorecard/ledger-hygiene',NULL,'{"type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":500}}}',NULL,'platform,health,scorecard,ledger,hygiene,readback,no_provider_call,no_secrets',1,1204,NOW(),CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  input_schema=VALUES(input_schema),
  tags=VALUES(tags),
  is_enabled=1,
  updated_at=CURRENT_TIMESTAMP;
