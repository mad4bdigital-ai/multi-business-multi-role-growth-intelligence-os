-- Dynamic Gate Manager: reusable release gates with TTL, hard-disable readback, and adapter compatibility.
-- Additive only. No gate is opened by this migration.

CREATE TABLE IF NOT EXISTS release_gate_adapters (
  adapter_key VARCHAR(64) NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  provider_family VARCHAR(64) NULL,
  target_kind VARCHAR(64) NULL,
  config_key VARCHAR(128) NOT NULL,
  gate_key VARCHAR(128) NOT NULL DEFAULT 'release_execution',
  app_key VARCHAR(191) NOT NULL,
  capability_key VARCHAR(191) NOT NULL,
  runtime_surface VARCHAR(191) NOT NULL,
  accepted_app_keys_json JSON NOT NULL,
  default_ttl_minutes INT UNSIGNED NOT NULL DEFAULT 30,
  max_ttl_minutes INT UNSIGNED NOT NULL DEFAULT 120,
  config_mode VARCHAR(64) NOT NULL DEFAULT 'platform_runtime_config',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (adapter_key),
  UNIQUE KEY uq_release_gate_adapter_config_key (config_key),
  KEY idx_release_gate_adapters_status (status, provider_family)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_gates (
  gate_id CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  adapter_key VARCHAR(64) NOT NULL,
  gate_key VARCHAR(128) NOT NULL,
  active_scope_key VARCHAR(255) NULL,
  target_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  app_key VARCHAR(191) NOT NULL,
  capability_key VARCHAR(191) NOT NULL,
  expected_commit_sha CHAR(40) NOT NULL,
  verified_commit_sha CHAR(40) NULL,
  capability_envelope_id CHAR(36) NOT NULL,
  runtime_verification_run_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  ttl_minutes INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  opened_by VARCHAR(191) NOT NULL,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  close_reason VARCHAR(1000) NULL,
  closed_by VARCHAR(191) NULL,
  closed_at DATETIME(3) NULL,
  hard_disabled_at DATETIME(3) NULL,
  config_snapshot_json JSON NULL,
  readback_json JSON NULL,
  last_readback_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (gate_id),
  UNIQUE KEY uq_release_gates_active_scope (active_scope_key),
  KEY idx_release_gates_operation (operation_id, created_at),
  KEY idx_release_gates_target_status (target_id, status, expires_at),
  KEY idx_release_gates_adapter_status (adapter_key, status, expires_at),
  KEY idx_release_gates_envelope (capability_envelope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO release_gate_adapters
  (adapter_key, display_name, provider_family, target_kind, config_key, gate_key, app_key, capability_key,
   runtime_surface, accepted_app_keys_json, default_ttl_minutes, max_ttl_minutes, config_mode, status, metadata_json)
VALUES
  (
    'hostinger_ssh_executor',
    'Hostinger SSH Release Executor Gate',
    'hostinger',
    'hosting_account',
    'remote_runtime_hostinger_ssh_executor_enabled',
    'release_execution',
    'hostinger',
    'remote_runtime_hostinger_deploy_release',
    'remote_runtime_hostinger_deploy_release',
    JSON_ARRAY('hostinger', 'remote_ssh_runtime'),
    30,
    120,
    'platform_runtime_config',
    'active',
    JSON_OBJECT(
      'legacy_config_fallback', TRUE,
      'hard_disable_after_close', TRUE,
      'expected_commit_required', TRUE,
      'capability_envelope_required', TRUE,
      'runtime_verification_required_for_close', TRUE,
      'provider_dispatch_allowed', FALSE,
      'credential_payload_read_allowed', FALSE,
      'secrets_included', FALSE
    )
  )
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), provider_family = VALUES(provider_family), target_kind = VALUES(target_kind),
  config_key = VALUES(config_key), gate_key = VALUES(gate_key), app_key = VALUES(app_key),
  capability_key = VALUES(capability_key), runtime_surface = VALUES(runtime_surface),
  accepted_app_keys_json = VALUES(accepted_app_keys_json), default_ttl_minutes = VALUES(default_ttl_minutes),
  max_ttl_minutes = VALUES(max_ttl_minutes), config_mode = VALUES(config_mode), status = VALUES(status),
  metadata_json = VALUES(metadata_json), updated_at = CURRENT_TIMESTAMP(3);

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('release_gate_open', 'Open Release Gate', 'Open a target-bound, TTL-limited release gate linked to a release operation and approved capability envelope.', 'POST', '/admin/release-gates/open', JSON_ARRAY(), JSON_OBJECT('type','object','required',JSON_ARRAY('operation_id','target_id','expected_commit_sha','capability_envelope_id','reason'),'properties',JSON_OBJECT('operation_id',JSON_OBJECT('type','string','format','uuid'),'adapter_key',JSON_OBJECT('type','string'),'target_id',JSON_OBJECT('type','string','format','uuid'),'app_key',JSON_OBJECT('type','string'),'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-fA-F]{40}$'),'capability_envelope_id',JSON_OBJECT('type','string','format','uuid'),'ttl_minutes',JSON_OBJECT('type','integer','minimum',5,'maximum',120),'reason',JSON_OBJECT('type','string','minLength',20),'opened_by',JSON_OBJECT('type','string'),'metadata',JSON_OBJECT('type','object','additionalProperties',true)),'additionalProperties',false), NULL, 'release_intelligence,admin,release_gate,approval_required,capability_resolution,readback,same_cycle_readback,rollback_required,expected_commit_required,no_provider_write,no_secrets', 1, 6720),
  ('release_gate_close', 'Close Release Gate', 'Close and hard-disable a release gate only after verified runtime parity for the expected commit.', 'POST', '/admin/release-gates/{gateId}/close', JSON_ARRAY('gateId'), JSON_OBJECT('type','object','required',JSON_ARRAY('gateId','runtime_verification_run_id','verified_commit_sha','reason'),'properties',JSON_OBJECT('gateId',JSON_OBJECT('type','string','format','uuid'),'runtime_verification_run_id',JSON_OBJECT('type','string','format','uuid'),'verified_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-fA-F]{40}$'),'reason',JSON_OBJECT('type','string','minLength',20),'closed_by',JSON_OBJECT('type','string')),'additionalProperties',false), NULL, 'release_intelligence,admin,release_gate,readback,same_cycle_readback,rollback_required,verification_required,no_provider_write,no_secrets', 1, 6721),
  ('release_gate_expire', 'Expire Release Gate', 'Expire a TTL-bound release gate and hard-disable its compatibility config.', 'POST', '/admin/release-gates/{gateId}/expire', JSON_ARRAY('gateId'), JSON_OBJECT('type','object','required',JSON_ARRAY('gateId'),'properties',JSON_OBJECT('gateId',JSON_OBJECT('type','string','format','uuid'),'force',JSON_OBJECT('type','boolean','default',false),'reason',JSON_OBJECT('type','string'),'expired_by',JSON_OBJECT('type','string')),'additionalProperties',false), NULL, 'release_intelligence,admin,release_gate,readback,same_cycle_readback,rollback_required,no_provider_write,no_secrets', 1, 6722),
  ('release_gate_hard_disable', 'Hard Disable Release Gate', 'Immediately hard-disable an open release gate and its compatibility config.', 'POST', '/admin/release-gates/{gateId}/hard-disable', JSON_ARRAY('gateId'), JSON_OBJECT('type','object','required',JSON_ARRAY('gateId','reason'),'properties',JSON_OBJECT('gateId',JSON_OBJECT('type','string','format','uuid'),'reason',JSON_OBJECT('type','string','minLength',20),'disabled_by',JSON_OBJECT('type','string')),'additionalProperties',false), NULL, 'release_intelligence,admin,release_gate,readback,same_cycle_readback,rollback_required,no_provider_write,no_secrets', 1, 6723),
  ('release_gate_get', 'Get Release Gate', 'Read one release gate with adapter and compatibility-config readback.', 'GET', '/admin/release-gates/{gateId}', JSON_ARRAY('gateId'), JSON_OBJECT('type','object','required',JSON_ARRAY('gateId'),'properties',JSON_OBJECT('gateId',JSON_OBJECT('type','string','format','uuid')),'additionalProperties',false), NULL, 'release_intelligence,admin,release_gate,read_only,no_provider_call,no_secrets', 1, 6724),
  ('release_gate_list', 'List Release Gates', 'List release gates by status, adapter, target, or release operation.', 'GET', '/admin/release-gates', JSON_ARRAY(), JSON_OBJECT('type','object','properties',JSON_OBJECT('status',JSON_OBJECT('type','string'),'adapter_key',JSON_OBJECT('type','string'),'target_id',JSON_OBJECT('type','string','format','uuid'),'operation_id',JSON_OBJECT('type','string','format','uuid'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100)),'additionalProperties',false), NULL, 'release_intelligence,admin,release_gate,read_only,no_provider_call,no_secrets', 1, 6725),
  ('release_gate_reconcile', 'Reconcile Release Gates', 'Detect expired or orphaned open gates. Defaults to dry-run; apply hard-disables unsafe gates.', 'POST', '/admin/release-gates/reconcile', JSON_ARRAY(), JSON_OBJECT('type','object','properties',JSON_OBJECT('dry_run',JSON_OBJECT('type','boolean','default',true),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',200),'capability_envelope_id',JSON_OBJECT('type','string','format','uuid'),'reconciled_by',JSON_OBJECT('type','string')),'additionalProperties',false), NULL, 'release_intelligence,admin,release_gate,dry_run,approval_required,capability_resolution,readback,same_cycle_readback,rollback_required,no_provider_write,no_secrets', 1, 6726)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), description = VALUES(description), http_method = VALUES(http_method),
  http_path = VALUES(http_path), path_param_keys = VALUES(path_param_keys), input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body), tags = VALUES(tags), is_enabled = VALUES(is_enabled), sort_order = VALUES(sort_order);

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  (
    'Release Intelligence Governance',
    'dynamic_release_gate_manager_policy_v1',
    JSON_OBJECT(
      'rule', 'release_gates_are_target_bound_ttl_limited_and_hard_disabled_after_close',
      'enforcement_mode', 'blocking',
      'approval_required_for_open', TRUE,
      'capability_resolution_required_for_open', TRUE,
      'expected_commit_required', TRUE,
      'runtime_verification_required_for_close', TRUE,
      'same_cycle_readback_required', TRUE,
      'orphan_reconciliation_required', TRUE,
      'provider_write_allowed', FALSE,
      'secrets_included', FALSE
    ),
    'TRUE',
    'gpt_tools_call|tool_dispatch|release_gate_open|release_gate_close|release_gate_expire|release_gate_hard_disable|release_gate_reconcile',
    'gptToolsRoutes|releaseGateManagerRoutes|releaseGateManagerService|hostingerSshDeployExecutor|admin_platform_endpoint_tools',
    'TRUE',
    'Dynamic Release Gate Manager policy. Gates require bounded TTL, exact target and commit, approved envelope, close verification, hard-disable readback, and orphan reconciliation.'
  )
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value), active = VALUES(active), execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer), blocking = VALUES(blocking), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;
