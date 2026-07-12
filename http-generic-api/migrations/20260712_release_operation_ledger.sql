-- Release Intelligence foundation: unified lifecycle ledger for deploy, restart, gate, verification, and rollback operations.
-- Additive only. Runtime verification evidence remains authoritative and is referenced rather than duplicated.

CREATE TABLE IF NOT EXISTS release_operations (
  operation_id CHAR(36) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  operation_type VARCHAR(64) NOT NULL,
  environment_key VARCHAR(64) NOT NULL DEFAULT 'production',
  target_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  expected_commit_sha VARCHAR(64) NULL,
  deployed_commit_sha VARCHAR(64) NULL,
  capability_envelope_id CHAR(36) NULL,
  runtime_verification_run_id CHAR(36) NULL,
  release_readiness_log_id BIGINT UNSIGNED NULL,
  current_status VARCHAR(64) NOT NULL DEFAULT 'accepted',
  risk_level VARCHAR(32) NOT NULL DEFAULT 'medium',
  requested_by VARCHAR(191) NOT NULL,
  reason VARCHAR(1000) NULL,
  context_json JSON NULL,
  final_classification VARCHAR(64) NULL,
  final_detail_json JSON NULL,
  rollback_plan_json JSON NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operation_id),
  UNIQUE KEY uq_release_operations_operation_key (operation_key),
  KEY idx_release_operations_target_created (target_id, created_at),
  KEY idx_release_operations_status_created (current_status, created_at),
  KEY idx_release_operations_expected_sha (expected_commit_sha),
  KEY idx_release_operations_envelope (capability_envelope_id),
  KEY idx_release_operations_verification (runtime_verification_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_operation_steps (
  step_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id CHAR(36) NOT NULL,
  step_key VARCHAR(128) NOT NULL,
  step_order INT UNSIGNED NOT NULL DEFAULT 0,
  attempt_number INT UNSIGNED NOT NULL DEFAULT 1,
  step_status VARCHAR(64) NOT NULL,
  classification VARCHAR(64) NULL,
  idempotency_key VARCHAR(191) NULL,
  detail_json JSON NULL,
  error_json JSON NULL,
  duration_ms BIGINT UNSIGNED NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (step_id),
  UNIQUE KEY uq_release_operation_step_attempt (operation_id, step_key, attempt_number),
  KEY idx_release_operation_steps_status (operation_id, step_status, step_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_operation_evidence (
  evidence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  evidence_uuid CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  step_id BIGINT UNSIGNED NULL,
  evidence_type VARCHAR(96) NOT NULL,
  evidence_surface VARCHAR(128) NOT NULL,
  evidence_ref VARCHAR(512) NULL,
  evidence_json JSON NULL,
  evidence_sha256 CHAR(64) NOT NULL,
  evidence_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evidence_id),
  UNIQUE KEY uq_release_operation_evidence_uuid (evidence_uuid),
  UNIQUE KEY uq_release_operation_evidence_hash (operation_id, evidence_type, evidence_sha256),
  KEY idx_release_operation_evidence_step (operation_id, step_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS release_gate_events (
  gate_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gate_event_uuid CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  gate_key VARCHAR(128) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  gate_status VARCHAR(64) NOT NULL,
  ttl_minutes INT UNSIGNED NULL,
  expires_at DATETIME(3) NULL,
  capability_envelope_id CHAR(36) NULL,
  runtime_verification_run_id CHAR(36) NULL,
  reason VARCHAR(1000) NULL,
  detail_json JSON NULL,
  created_by VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (gate_event_id),
  UNIQUE KEY uq_release_gate_event_uuid (gate_event_uuid),
  KEY idx_release_gate_events_operation (operation_id, gate_key, created_at),
  KEY idx_release_gate_events_expiry (gate_status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  ('release_operation_create', 'Create Release Operation', 'Create a unified internal release lifecycle record. This writes only platform persistence and never calls a provider.', 'POST', '/admin/release-operations', JSON_ARRAY(), JSON_OBJECT('type','object','required',JSON_ARRAY('operation_type'),'properties',JSON_OBJECT('operation_key',JSON_OBJECT('type','string'),'operation_type',JSON_OBJECT('type','string'),'environment_key',JSON_OBJECT('type','string'),'target_id',JSON_OBJECT('type','string','format','uuid'),'expected_commit_sha',JSON_OBJECT('type','string'),'capability_envelope_id',JSON_OBJECT('type','string','format','uuid'),'runtime_verification_run_id',JSON_OBJECT('type','string','format','uuid'),'risk_level',JSON_OBJECT('type','string'),'reason',JSON_OBJECT('type','string'),'context',JSON_OBJECT('type','object','additionalProperties',true)),'additionalProperties',false), NULL, 'release_intelligence,admin,internal_persistence,mutation_policy_required,no_provider_write,no_external_mutation,no_secrets', 1, 6710),
  ('release_operation_list', 'List Release Operations', 'List unified release lifecycle records.', 'GET', '/admin/release-operations', JSON_ARRAY(), JSON_OBJECT('type','object','properties',JSON_OBJECT('status',JSON_OBJECT('type','string'),'target_id',JSON_OBJECT('type','string','format','uuid'),'environment_key',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer','minimum',1,'maximum',100)),'additionalProperties',false), NULL, 'release_intelligence,admin,read_only,no_provider_call,no_secrets', 1, 6711),
  ('release_operation_get', 'Get Release Operation', 'Read one release operation with steps, evidence references, and gate events.', 'GET', '/admin/release-operations/{operationId}', JSON_ARRAY('operationId'), JSON_OBJECT('type','object','required',JSON_ARRAY('operationId'),'properties',JSON_OBJECT('operationId',JSON_OBJECT('type','string','format','uuid')),'additionalProperties',false), NULL, 'release_intelligence,admin,read_only,no_provider_call,no_secrets', 1, 6712),
  ('release_operation_step_append', 'Append Release Operation Step', 'Append or idempotently update an internal release step and optional lifecycle transition.', 'POST', '/admin/release-operations/{operationId}/steps', JSON_ARRAY('operationId'), JSON_OBJECT('type','object','required',JSON_ARRAY('operationId','step_key'),'properties',JSON_OBJECT('operationId',JSON_OBJECT('type','string','format','uuid'),'step_key',JSON_OBJECT('type','string'),'step_order',JSON_OBJECT('type','integer'),'attempt_number',JSON_OBJECT('type','integer'),'step_status',JSON_OBJECT('type','string'),'operation_status',JSON_OBJECT('type','string'),'classification',JSON_OBJECT('type','string'),'idempotency_key',JSON_OBJECT('type','string'),'detail',JSON_OBJECT('type','object','additionalProperties',true),'error',JSON_OBJECT('type','object','additionalProperties',true)),'additionalProperties',false), NULL, 'release_intelligence,admin,internal_persistence,mutation_policy_required,no_provider_write,no_external_mutation,no_secrets', 1, 6713),
  ('release_operation_evidence_append', 'Append Release Operation Evidence', 'Store bounded redacted evidence or an evidence reference with a deterministic SHA-256 digest.', 'POST', '/admin/release-operations/{operationId}/evidence', JSON_ARRAY('operationId'), JSON_OBJECT('type','object','required',JSON_ARRAY('operationId','evidence_type'),'properties',JSON_OBJECT('operationId',JSON_OBJECT('type','string','format','uuid'),'step_id',JSON_OBJECT('type','integer'),'evidence_type',JSON_OBJECT('type','string'),'evidence_surface',JSON_OBJECT('type','string'),'evidence_ref',JSON_OBJECT('type','string'),'evidence',JSON_OBJECT('type','object','additionalProperties',true)),'additionalProperties',false), NULL, 'release_intelligence,admin,internal_persistence,mutation_policy_required,no_provider_write,no_external_mutation,no_secrets', 1, 6714),
  ('release_operation_gate_event_append', 'Append Release Gate Event', 'Record gate lifecycle evidence without opening or closing an external execution gate.', 'POST', '/admin/release-operations/{operationId}/gate-events', JSON_ARRAY('operationId'), JSON_OBJECT('type','object','required',JSON_ARRAY('operationId','event_type'),'properties',JSON_OBJECT('operationId',JSON_OBJECT('type','string','format','uuid'),'gate_key',JSON_OBJECT('type','string'),'event_type',JSON_OBJECT('type','string'),'gate_status',JSON_OBJECT('type','string'),'ttl_minutes',JSON_OBJECT('type','integer'),'expires_at',JSON_OBJECT('type','string','format','date-time'),'capability_envelope_id',JSON_OBJECT('type','string','format','uuid'),'runtime_verification_run_id',JSON_OBJECT('type','string','format','uuid'),'reason',JSON_OBJECT('type','string'),'detail',JSON_OBJECT('type','object','additionalProperties',true)),'additionalProperties',false), NULL, 'release_intelligence,admin,internal_persistence,mutation_policy_required,record_only,no_provider_write,no_external_mutation,no_secrets', 1, 6715),
  ('release_operation_finalize', 'Finalize Release Operation', 'Finalize a release lifecycle record with verification or rollback classification.', 'POST', '/admin/release-operations/{operationId}/finalize', JSON_ARRAY('operationId'), JSON_OBJECT('type','object','required',JSON_ARRAY('operationId','final_status'),'properties',JSON_OBJECT('operationId',JSON_OBJECT('type','string','format','uuid'),'final_status',JSON_OBJECT('type','string'),'final_classification',JSON_OBJECT('type','string'),'deployed_commit_sha',JSON_OBJECT('type','string'),'runtime_verification_run_id',JSON_OBJECT('type','string','format','uuid'),'release_readiness_log_id',JSON_OBJECT('type','integer'),'detail',JSON_OBJECT('type','object','additionalProperties',true),'rollback_plan',JSON_OBJECT('type','object','additionalProperties',true)),'additionalProperties',false), NULL, 'release_intelligence,admin,internal_persistence,mutation_policy_required,no_provider_write,no_external_mutation,no_secrets', 1, 6716)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name), description = VALUES(description), http_method = VALUES(http_method),
  http_path = VALUES(http_path), path_param_keys = VALUES(path_param_keys), input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body), tags = VALUES(tags), is_enabled = VALUES(is_enabled), sort_order = VALUES(sort_order);
