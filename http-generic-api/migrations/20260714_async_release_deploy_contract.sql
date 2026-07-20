-- Async Deploy Contract: 202 acceptance, governed queue execution, and release-operation readback.
-- Additive only. No deploy is executed by this migration.

CREATE TABLE IF NOT EXISTS release_async_deployments (
  async_deployment_id CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  gate_id CHAR(36) NULL,
  target_id CHAR(36) NOT NULL,
  capability_envelope_id CHAR(36) NULL,
  expected_commit_sha CHAR(40) NOT NULL,
  job_id VARCHAR(191) NULL,
  deployment_run_id VARCHAR(255) NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'accepted',
  idempotency_key VARCHAR(191) NULL,
  last_http_status INT NULL,
  result_json JSON NULL,
  error_json JSON NULL,
  accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  last_readback_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_by VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (async_deployment_id),
  UNIQUE KEY uq_release_async_deploy_operation (operation_id),
  UNIQUE KEY uq_release_async_deploy_job (job_id),
  UNIQUE KEY uq_release_async_deploy_idempotency (idempotency_key),
  KEY idx_release_async_deploy_status (status, updated_at),
  KEY idx_release_async_deploy_run (deployment_run_id),
  KEY idx_release_async_deploy_target (target_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('release_async_deploy_apply', 'Accept Async Release Deploy', 'Accept a governed Hostinger release deploy into the existing job queue and return HTTP 202 with operation and polling references.', 'POST', '/admin/release-operations/{operationId}/async-deploy', JSON_ARRAY('operationId'), JSON_OBJECT('type','object','required',JSON_ARRAY('operationId','target_id','expected_commit_sha'),'properties',JSON_OBJECT('operationId',JSON_OBJECT('type','string','format','uuid'),'gate_id',JSON_OBJECT('type','string','format','uuid'),'target_id',JSON_OBJECT('type','string','format','uuid'),'app_key',JSON_OBJECT('type','string'),'app_path',JSON_OBJECT('type','string'),'branch',JSON_OBJECT('type','string','enum',JSON_ARRAY('main')),'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-fA-F]{40}$'),'capability_envelope_id',JSON_OBJECT('type','string','format','uuid'),'approval_reason',JSON_OBJECT('type','string'),'force_clean',JSON_OBJECT('type','boolean'),'restart',JSON_OBJECT('type','boolean'),'dry_run',JSON_OBJECT('type','boolean','default',false),'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',300000),'ssh_auth_mode',JSON_OBJECT('type','string'),'ssh_transport_mode',JSON_OBJECT('type','string'),'idempotency_key',JSON_OBJECT('type','string')),'additionalProperties',false), NULL, 'release_intelligence,admin,async_deploy,approval_required,capability_resolution,rollback_required,readback,same_cycle_readback,external_mutation,expected_commit_required,no_secrets', 1, 6730),
  ('release_async_deploy_get', 'Get Async Release Deploy', 'Read async deploy tracking and governed job status for a release operation.', 'GET', '/admin/release-operations/{operationId}/async-deploy', JSON_ARRAY('operationId'), JSON_OBJECT('type','object','required',JSON_ARRAY('operationId'),'properties',JSON_OBJECT('operationId',JSON_OBJECT('type','string','format','uuid')),'additionalProperties',false), NULL, 'release_intelligence,admin,async_deploy,read_only,no_provider_call,no_secrets', 1, 6731),
  ('release_async_deploy_readback', 'Reconcile Async Release Deploy', 'Read deployment-run and runtime parity evidence and update the release lifecycle without re-running deploy.', 'POST', '/admin/release-operations/{operationId}/async-deploy/readback', JSON_ARRAY('operationId'), JSON_OBJECT('type','object','required',JSON_ARRAY('operationId'),'properties',JSON_OBJECT('operationId',JSON_OBJECT('type','string','format','uuid')),'additionalProperties',false), NULL, 'release_intelligence,admin,async_deploy,readback,same_cycle_readback,rollback_required,no_provider_write,no_external_mutation,no_secrets', 1, 6732)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), description = VALUES(description), http_method = VALUES(http_method),
  http_path = VALUES(http_path), path_param_keys = VALUES(path_param_keys), input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body), tags = VALUES(tags), is_enabled = VALUES(is_enabled), sort_order = VALUES(sort_order);

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  (
    'Release Intelligence Governance',
    'async_release_deploy_contract_v1',
    JSON_OBJECT(
      'rule', 'async_deploy_returns_202_and_uses_governed_job_queue_and_runtime_readback',
      'enforcement_mode', 'blocking',
      'release_operation_required', TRUE,
      'open_release_gate_required_for_live_apply', TRUE,
      'approval_required', TRUE,
      'capability_resolution_required', TRUE,
      'expected_commit_required', TRUE,
      'runtime_verification_required_for_verified', TRUE,
      'http_503_is_transient_restart_state', TRUE,
      'same_cycle_readback_required', TRUE,
      'rollback_plan_required', TRUE,
      'secrets_included', FALSE
    ),
    'TRUE',
    'gpt_tools_call|tool_dispatch|release_async_deploy_apply|release_async_deploy_readback|hostinger_ssh_deploy_release_async',
    'asyncReleaseDeployRoutes|asyncReleaseDeployService|asyncReleaseDeployWorker|executionAsync|jobRunner|hostingerSshDeployExecutor',
    'TRUE',
    'Async deploy acceptance uses the existing governed job queue. The worker never classifies verified; only runtime parity readback may do so.'
  )
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value), active = VALUES(active), execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer), blocking = VALUES(blocking), notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;
