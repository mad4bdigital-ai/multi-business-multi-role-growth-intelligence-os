-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Sprint 69: OpenAPI -> SQL endpoint inventory synchronization and curated Dynamic Container admin tools.
-- The sync records route inventory only. It never auto-promotes endpoints into callable runtime authority or tool exports.

CREATE TABLE IF NOT EXISTS openapi_endpoint_inventory_sync_runs (
  run_id CHAR(36) NOT NULL,
  mode ENUM('dry_run','apply') NOT NULL DEFAULT 'dry_run',
  trigger_source VARCHAR(64) NOT NULL,
  status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  source_sha256 CHAR(64) NOT NULL,
  source_fingerprint CHAR(64) NOT NULL,
  operation_count INT UNSIGNED NOT NULL DEFAULT 0,
  inserted_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_count INT UNSIGNED NOT NULL DEFAULT 0,
  deprecated_count INT UNSIGNED NOT NULL DEFAULT 0,
  readback_count INT UNSIGNED NOT NULL DEFAULT 0,
  summary_json LONGTEXT NULL,
  error_code VARCHAR(128) NULL,
  error_message VARCHAR(1000) NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id),
  KEY idx_openapi_inventory_sync_started (started_at),
  KEY idx_openapi_inventory_sync_status (status, started_at),
  KEY idx_openapi_inventory_sync_fingerprint (source_fingerprint)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_runtime_config (config_key, config_json, status, note)
VALUES (
  'openapi_endpoint_inventory_sync',
  JSON_OBJECT(
    'enabled', true,
    'startup_apply', true,
    'auto_promote', false,
    'parent_action_key', 'internal_platform_api',
    'sync_mode', 'inventory_only',
    'removed_operation_policy', 'deprecate',
    'advisory_lock', 'openapi_endpoint_inventory_sync_v1',
    'provider_calls', false,
    'external_writes', false,
    'credential_payload_reads', false,
    'secrets_included', false
  ),
  'active',
  'Automatically synchronize committed OpenAPI operations into SQL endpoint inventory after startup. Inventory rows remain non-callable pending explicit governance promotion.'
)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO actions (
  action_key, action_id, action_title, status, module_binding, connector_family,
  runtime_capability_class, runtime_callable, primary_executor, notes,
  action_class, action_scope, route_target, execution_layer, inventory_role,
  review_required, provider_agnostic, admin_only, writeback_scope
) VALUES (
  'internal_platform_api',
  'internal_platform_api',
  'Internal Platform API Route Inventory',
  'inventory_only',
  'internal_http_route_inventory',
  'internal_platform',
  'inventory_only',
  'false',
  'none',
  JSON_OBJECT('callable',false,'auto_promote',false,'provider_calls',false,'secrets_included',false),
  'internal_inventory',
  'platform',
  'internal_platform_api',
  'http_generic_api',
  'openapi_inventory',
  'true',
  'true',
  'true',
  'inventory_metadata_only'
)
ON DUPLICATE KEY UPDATE
  action_title = VALUES(action_title),
  module_binding = VALUES(module_binding),
  connector_family = VALUES(connector_family),
  runtime_capability_class = 'inventory_only',
  runtime_callable = 'false',
  primary_executor = 'none',
  notes = VALUES(notes),
  action_class = 'internal_inventory',
  action_scope = 'platform',
  route_target = 'internal_platform_api',
  execution_layer = 'http_generic_api',
  inventory_role = 'openapi_inventory',
  review_required = 'true',
  provider_agnostic = 'true',
  admin_only = 'true',
  writeback_scope = 'inventory_metadata_only',
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO app_integration_action_bindings (
  binding_id, app_key, action_key, binding_role, credential_source,
  exposure_default, status, notes
) VALUES (
  'bind_action_openapi_endpoint_inventory_sync',
  'platform_orchestration',
  'internal_platform_api',
  'resolver',
  'none',
  'manual_tools',
  'active',
  'No-credential OpenAPI route inventory synchronization. Callable promotion remains separate and explicit.'
)
ON DUPLICATE KEY UPDATE
  app_key = VALUES(app_key),
  action_key = VALUES(action_key),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_default = VALUES(exposure_default),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'openapi_endpoint_inventory_status',
  'OpenAPI Endpoint Inventory Status',
  'Read synchronization configuration, latest run evidence, inventory count, and callable-count guard. No provider call, credential read, or mutation.',
  'GET',
  '/admin/openapi-registry-sync/status',
  JSON_ARRAY(),
  JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',false),
  NULL,
  'admin,openapi,endpoint_inventory,read_only,no_provider_call,no_credentials,no_secrets',
  1,
  410
),
(
  'openapi_endpoint_inventory_sync',
  'OpenAPI Endpoint Inventory Sync',
  'Dry-run or apply OpenAPI-to-SQL endpoint inventory synchronization. Apply requires typed confirmation and a ready platform_orchestration capability envelope. Never creates callable endpoints or tool exports.',
  'POST',
  '/admin/openapi-registry-sync',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply'),'default','dry_run'),
      'confirm',JSON_OBJECT('type','string','maxLength',128),
      'capability_envelope_id',JSON_OBJECT('type','string','maxLength',64)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,openapi,endpoint_inventory,dry_run_default,state_changing,typed_confirmation,capability_envelope,transaction,advisory_lock,readback,no_auto_promotion,no_provider_call,no_credentials,no_secrets',
  1,
  411
),
(
  'dynamic_container_resolution_preview',
  'Dynamic Container Resolution Preview',
  'Run one admin-only Dynamic Container authority resolution pinned to preview mode. Writes immutable internal evidence only; provider calls, credential payload reads, external writes, and enforcement remain disabled.',
  'POST',
  '/admin/container-authority/resolution-preview',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'principal',JSON_OBJECT('type','object','additionalProperties',true),
      'tenantId',JSON_OBJECT('type','string','minLength',1,'maxLength',36),
      'targetContainerId',JSON_OBJECT('type','string','minLength',1,'maxLength',36),
      'dimensionRequests',JSON_OBJECT('type','array','minItems',1,'maxItems',50,'items',JSON_OBJECT('type','object','additionalProperties',true)),
      'expectedAuthorityEpoch',JSON_OBJECT('type','integer','minimum',0),
      'expectedRegistrySnapshotHash',JSON_OBJECT('type','string','pattern','^[a-f0-9]{64}$'),
      'legacyDecision',JSON_OBJECT('type','string','maxLength',64),
      'legacyEvidenceRef',JSON_OBJECT('type','string','maxLength',512),
      'requestId',JSON_OBJECT('type','string','maxLength',191),
      'idempotencyKey',JSON_OBJECT('type','string','minLength',8,'maxLength',128)
    ),
    'required',JSON_ARRAY('tenantId','targetContainerId','dimensionRequests','idempotencyKey'),
    'additionalProperties',false
  ),
  NULL,
  'admin,dynamic_container,preview_only,internal_evidence_write,idempotent,no_enforcement,no_provider_call,no_credentials,no_external_write,no_secrets',
  1,
  412
),
(
  'dynamic_container_projection_dry_run',
  'Dynamic Container Projection Dry Run',
  'Build the legacy-to-container projection plan without applying it. No database mutation, provider call, credential read, external write, or enforcement.',
  'POST',
  '/admin/container-authority/projection-preview',
  JSON_ARRAY(),
  JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',false),
  NULL,
  'admin,dynamic_container,projection,dry_run,read_only,no_provider_call,no_credentials,no_external_write,no_secrets',
  1,
  413
),
(
  'dynamic_container_shadow_summary',
  'Dynamic Container Shadow Summary',
  'Read bounded Dynamic Container shadow mismatch summaries. No mutation, provider call, credential read, or secret output.',
  'GET',
  '/container-authority/shadow-summary',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT('limit',JSON_OBJECT('type','integer','minimum',1,'maximum',200,'default',100)),
    'additionalProperties',false
  ),
  NULL,
  'admin,dynamic_container,shadow,read_only,paginated,no_provider_call,no_credentials,no_secrets',
  1,
  414
),
(
  'dynamic_container_rollout_readiness',
  'Dynamic Container Rollout Readiness',
  'Read Dynamic Container rollout thresholds, sample counts, mismatch rates, latency, audit coverage, and enforcement request state. No mutation or provider access.',
  'GET',
  '/container-authority/rollout-readiness',
  JSON_ARRAY(),
  JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',false),
  NULL,
  'admin,dynamic_container,rollout,readiness,read_only,no_provider_call,no_credentials,no_secrets',
  1,
  415
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings (
  binding_id, app_key, tool_key, tool_surface, binding_role,
  credential_source, exposure_scope, status, notes
) VALUES
('bind_tool_openapi_endpoint_inventory_status','platform_orchestration','openapi_endpoint_inventory_status','admin_platform_tool','read_only','none','admin','active','Read-only OpenAPI inventory synchronization evidence.'),
('bind_tool_openapi_endpoint_inventory_sync','platform_orchestration','openapi_endpoint_inventory_sync','admin_platform_tool','state_changing','none','admin','active','Dry-run default; apply requires typed confirmation and capability envelope.'),
('bind_tool_dynamic_container_resolution_preview','platform_orchestration','dynamic_container_resolution_preview','admin_platform_tool','state_changing','none','admin','active','Preview-only internal evidence write; no enforcement or provider call.'),
('bind_tool_dynamic_container_projection_dry_run','platform_orchestration','dynamic_container_projection_dry_run','admin_platform_tool','read_only','none','admin','active','Projection planning only; fixed mode=dry_run.'),
('bind_tool_dynamic_container_shadow_summary','platform_orchestration','dynamic_container_shadow_summary','admin_platform_tool','read_only','none','admin','active','Read-only shadow mismatch summary.'),
('bind_tool_dynamic_container_rollout_readiness','platform_orchestration','dynamic_container_rollout_readiness','admin_platform_tool','read_only','none','admin','active','Read-only rollout readiness evidence.')
ON DUPLICATE KEY UPDATE
  app_key = VALUES(app_key),
  tool_key = VALUES(tool_key),
  tool_surface = VALUES(tool_surface),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_scope = VALUES(exposure_scope),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry (
  migration_file, authorization_status, authorization_source, policy_key,
  risk_tier, requires_preflight, requires_confirmation,
  allow_record_only, allow_apply, notes, metadata_json
) VALUES (
  '1023_sprint69_openapi_endpoint_inventory_sync.sql',
  'authorized',
  'migration_seed',
  'governed_migration_runner_authorization_v1',
  'medium',
  1,
  1,
  0,
  1,
  'Authorize additive OpenAPI endpoint inventory synchronization schema, runtime policy, and curated admin tool registrations.',
  JSON_OBJECT(
    'scope','openapi_endpoint_inventory_sync',
    'bootstrap_authorization_required_for_first_apply',true,
    'auto_promote',false,
    'provider_calls',false,
    'external_writes',false,
    'credential_payload_reads',false,
    'secrets_included',false
  )
)
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  risk_tier = VALUES(risk_tier),
  requires_preflight = VALUES(requires_preflight),
  requires_confirmation = VALUES(requires_confirmation),
  allow_record_only = VALUES(allow_record_only),
  allow_apply = VALUES(allow_apply),
  notes = VALUES(notes),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;
