-- spec014_hostinger_storage_wave_3_execution_evidence.sql
-- DRAFT ONLY: specification-local SQL; not discoverable by governed-migration-runner.
-- Tasks: T026
-- migration_apply_authorized=false
-- destructive_ddl=false
-- external_fk_ddl_deferred_until_exact_parent_readback=true
-- tool_and_operation_seeds_default_off=true
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

CREATE TABLE IF NOT EXISTS storage_cleanup_runs (
  id CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  run_generation BIGINT UNSIGNED NOT NULL,
  adapter_key VARCHAR(128) NOT NULL,
  adapter_version VARCHAR(64) NOT NULL,
  worker_ref VARCHAR(191) NOT NULL,
  connector_ref VARCHAR(191) NOT NULL,
  dispatch_certification_ref VARCHAR(191) NOT NULL,
  host_key_evidence_ref VARCHAR(191) NOT NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  state VARCHAR(32) NOT NULL,
  deleted_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  deleted_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  missing_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  failed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  journal_digest CHAR(64) NOT NULL,
  checkpoint_digest CHAR(64) NOT NULL,
  before_snapshot_id CHAR(36) NOT NULL,
  after_snapshot_id CHAR(36) NULL,
  provider_response_classification VARCHAR(64) NOT NULL,
  unknown_outcome TINYINT(1) NOT NULL DEFAULT 0,
  readback_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  result_digest CHAR(64) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_cleanup_runs_generation (operation_id, run_generation),
  KEY idx_storage_cleanup_runs_operation_state (operation_id, state),
  KEY idx_storage_cleanup_runs_plan (plan_id),
  KEY idx_storage_cleanup_runs_unknown_readback (unknown_outcome, readback_status),
  KEY idx_storage_cleanup_runs_worker_started (worker_ref, started_at),
  CONSTRAINT fk_storage_cleanup_runs_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT fk_storage_cleanup_runs_plan
    FOREIGN KEY (plan_id) REFERENCES storage_cleanup_plans(id),
  CONSTRAINT fk_storage_cleanup_runs_before_snapshot
    FOREIGN KEY (before_snapshot_id) REFERENCES storage_pressure_snapshots(id),
  CONSTRAINT fk_storage_cleanup_runs_after_snapshot
    FOREIGN KEY (after_snapshot_id) REFERENCES storage_pressure_snapshots(id),
  CONSTRAINT chk_storage_cleanup_runs_digests
    CHECK (
      journal_digest REGEXP '^[0-9a-f]{64}$'
      AND checkpoint_digest REGEXP '^[0-9a-f]{64}$'
      AND (result_digest IS NULL OR result_digest REGEXP '^[0-9a-f]{64}$')
    ),
  CONSTRAINT chk_storage_cleanup_runs_no_secrets CHECK (secrets_included = 0),
  CONSTRAINT chk_storage_cleanup_runs_unknown CHECK (unknown_outcome IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_cleanup_run_items (
  id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  plan_item_id CHAR(36) NOT NULL,
  sequence BIGINT UNSIGNED NOT NULL,
  prepared_at DATETIME(3) NOT NULL,
  revalidation_outcome VARCHAR(64) NOT NULL,
  result VARCHAR(32) NOT NULL,
  observed_stat_digest CHAR(64) NULL,
  result_evidence_digest CHAR(64) NOT NULL,
  checkpoint_at DATETIME(3) NOT NULL,
  error_code VARCHAR(128) NULL,
  sanitized_error_message VARCHAR(512) NULL,
  readback_state VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_cleanup_run_items_sequence
    (run_id, plan_item_id, sequence),
  KEY idx_storage_cleanup_run_items_run_sequence (run_id, sequence),
  KEY idx_storage_cleanup_run_items_run_result (run_id, result),
  KEY idx_storage_cleanup_run_items_plan_item (plan_item_id),
  CONSTRAINT fk_storage_cleanup_run_items_run
    FOREIGN KEY (run_id) REFERENCES storage_cleanup_runs(id),
  CONSTRAINT fk_storage_cleanup_run_items_plan_item
    FOREIGN KEY (plan_item_id) REFERENCES storage_cleanup_plan_items(id),
  CONSTRAINT chk_storage_cleanup_run_items_result
    CHECK (result IN ('deleted', 'skipped_changed', 'skipped_missing', 'skipped_protected', 'failed')),
  CONSTRAINT chk_storage_cleanup_run_items_digests
    CHECK (
      result_evidence_digest REGEXP '^[0-9a-f]{64}$'
      AND (observed_stat_digest IS NULL OR observed_stat_digest REGEXP '^[0-9a-f]{64}$')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_reconciliation_results (
  id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  reconciliation_generation BIGINT UNSIGNED NOT NULL,
  input_evidence_hashes_json JSON NOT NULL,
  item_accounting_json JSON NOT NULL,
  filesystem_readback_ref VARCHAR(191) NULL,
  provider_readback_ref VARCHAR(191) NULL,
  runtime_readback_ref VARCHAR(191) NULL,
  outcome VARCHAR(32) NOT NULL,
  retry_permission TINYINT(1) NOT NULL DEFAULT 0,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  evidence_digest CHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_reconciliation_generation
    (run_id, reconciliation_generation),
  KEY idx_storage_reconciliation_operation_outcome (operation_id, outcome),
  KEY idx_storage_reconciliation_run_created (run_id, created_at),
  KEY idx_storage_reconciliation_outcome_retry (outcome, retry_permission),
  CONSTRAINT fk_storage_reconciliation_run
    FOREIGN KEY (run_id) REFERENCES storage_cleanup_runs(id),
  CONSTRAINT fk_storage_reconciliation_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT chk_storage_reconciliation_outcome
    CHECK (outcome IN ('applied', 'partially_applied', 'not_applied', 'conflict', 'still_unknown')),
  CONSTRAINT chk_storage_reconciliation_retry CHECK (retry_permission IN (0, 1)),
  CONSTRAINT chk_storage_reconciliation_digest
    CHECK (evidence_digest REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_emergency_reserves (
  id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  reserve_key VARCHAR(128) NOT NULL,
  reserve_path_ref VARCHAR(255) NOT NULL,
  expected_size_bytes BIGINT UNSIGNED NOT NULL,
  fingerprint_digest CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'absent',
  created_operation_id CHAR(36) NULL,
  verified_operation_id CHAR(36) NULL,
  released_operation_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  verified_at DATETIME(3) NULL,
  released_at DATETIME(3) NULL,
  active_incident_id CHAR(36) NULL,
  policy_revision VARCHAR(64) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_emergency_reserves_target_key (target_id, reserve_key),
  KEY idx_storage_emergency_reserves_target_status (target_id, status),
  KEY idx_storage_emergency_reserves_incident (active_incident_id),
  KEY idx_storage_emergency_reserves_status_verified (status, verified_at),
  CONSTRAINT fk_storage_emergency_reserves_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT fk_storage_emergency_reserves_provider
    FOREIGN KEY (provider_account_id) REFERENCES storage_provider_accounts(id),
  CONSTRAINT chk_storage_emergency_reserves_status
    CHECK (status IN ('absent', 'provisioned', 'released', 'invalid')),
  CONSTRAINT chk_storage_emergency_reserves_fingerprint
    CHECK (fingerprint_digest REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_pressure_incidents (
  id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  impacted_resource_id CHAR(36) NULL,
  incident_fingerprint CHAR(64) NOT NULL,
  active_generation BIGINT UNSIGNED NOT NULL,
  severity VARCHAR(32) NOT NULL,
  pressure_dimension VARCHAR(32) NOT NULL,
  opened_at DATETIME(3) NOT NULL,
  resolved_at DATETIME(3) NULL,
  provider_case_ref VARCHAR(191) NULL,
  blocked_deployment_refs_json JSON NULL,
  reserve_action_refs_json JSON NULL,
  cleanup_operation_refs_json JSON NULL,
  root_cause_classification VARCHAR(128) NULL,
  growth_source_classification VARCHAR(128) NULL,
  prevention_action VARCHAR(512) NULL,
  remaining_risk VARCHAR(512) NULL,
  support_ref VARCHAR(191) NULL,
  delegation_ref VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL,
  audit_evidence_digest CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_pressure_incidents_active
    (target_id, incident_fingerprint, active_generation),
  KEY idx_storage_pressure_incidents_target_status_severity (target_id, status, severity),
  KEY idx_storage_pressure_incidents_provider_case (provider_case_ref),
  KEY idx_storage_pressure_incidents_open_resolved (opened_at, resolved_at),
  CONSTRAINT fk_storage_pressure_incidents_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT fk_storage_pressure_incidents_provider
    FOREIGN KEY (provider_account_id) REFERENCES storage_provider_accounts(id),
  CONSTRAINT chk_storage_pressure_incidents_fingerprint
    CHECK (
      incident_fingerprint REGEXP '^[0-9a-f]{64}$'
      AND audit_evidence_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_pressure_incidents_status
    CHECK (status IN ('open', 'investigating', 'mitigated', 'resolved', 'closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_storage_admin_target_readiness AS
SELECT
  t.id AS target_id,
  t.provider_account_id,
  t.resource_id,
  t.ownership_scope,
  t.status,
  t.dispatch_status,
  t.layout_certification_status,
  b.binding_revision,
  s.provider_observed_at,
  s.effective_pressure_state,
  s.completeness,
  0 AS secrets_included
FROM storage_targets t
LEFT JOIN storage_target_bindings b
  ON b.target_id = t.id AND b.active_to IS NULL
LEFT JOIN storage_pressure_snapshots s
  ON s.id = (
    SELECT s2.id
    FROM storage_pressure_snapshots s2
    WHERE s2.target_id = t.id
    ORDER BY s2.provider_observed_at DESC, s2.id DESC
    LIMIT 1
  );

CREATE OR REPLACE VIEW v_storage_tenant_target_readiness AS
SELECT
  target_id,
  resource_id,
  tenant_id,
  workspace_id,
  status,
  dispatch_status,
  layout_certification_status,
  binding_revision,
  provider_observed_at,
  effective_pressure_state,
  completeness,
  0 AS secrets_included
FROM (
  SELECT
    t.id AS target_id,
    t.resource_id,
    t.tenant_id,
    t.workspace_id,
    t.status,
    t.dispatch_status,
    t.layout_certification_status,
    b.binding_revision,
    s.provider_observed_at,
    s.effective_pressure_state,
    s.completeness
  FROM storage_targets t
  LEFT JOIN storage_target_bindings b
    ON b.target_id = t.id AND b.active_to IS NULL
  LEFT JOIN storage_pressure_snapshots s
    ON s.id = (
      SELECT s2.id
      FROM storage_pressure_snapshots s2
      WHERE s2.target_id = t.id
      ORDER BY s2.provider_observed_at DESC, s2.id DESC
      LIMIT 1
    )
  WHERE t.ownership_scope = 'tenant'
) tenant_targets;

CREATE OR REPLACE VIEW v_storage_cleanup_operation_readback AS
SELECT
  o.id AS operation_id,
  o.operation_class,
  o.target_id,
  o.resource_id,
  o.tenant_id,
  o.workspace_id,
  o.state,
  o.unknown_outcome,
  o.reconciliation_status,
  o.current_plan_id,
  o.current_run_id,
  o.current_lease_id,
  r.state AS run_state,
  r.readback_status,
  r.result_digest,
  rr.outcome AS reconciliation_outcome,
  0 AS secrets_included
FROM storage_cleanup_operations o
LEFT JOIN storage_cleanup_runs r ON r.id = o.current_run_id
LEFT JOIN storage_reconciliation_results rr
  ON rr.id = (
    SELECT rr2.id
    FROM storage_reconciliation_results rr2
    WHERE rr2.operation_id = o.id
    ORDER BY rr2.reconciliation_generation DESC, rr2.id DESC
    LIMIT 1
  );

-- Default-off tool registration draft. Final column/type parity must be proven by preflight.
INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'hostinger_storage_snapshot_read',
  'Hostinger Storage Snapshot Read',
  'Read bounded storage pressure evidence for a governed target.',
  'POST',
  '/admin/storage/targets/snapshot/read',
  NULL,
  JSON_OBJECT('type','object','required',JSON_ARRAY('target_id')),
  NULL,
  'hostinger,storage,read_only,governed',
  0,
  360
),
(
  'hostinger_storage_plan_inspect',
  'Hostinger Storage Plan Inspect',
  'Inspect an immutable cleanup plan without applying filesystem mutation.',
  'POST',
  '/admin/storage/plans/inspect',
  NULL,
  JSON_OBJECT('type','object','required',JSON_ARRAY('plan_id')),
  NULL,
  'hostinger,storage,plan,governed',
  0,
  361
),
(
  'hostinger_storage_plan_apply',
  'Hostinger Storage Plan Apply',
  'Apply a separately authorized immutable plan through the certified worker.',
  'POST',
  '/admin/storage/plans/apply',
  NULL,
  JSON_OBJECT('type','object','required',JSON_ARRAY('plan_id','typed_confirmation')),
  NULL,
  'hostinger,storage,mutation,governed',
  0,
  362
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = 0,
  sort_order = VALUES(sort_order);

-- No connected system, credential reference, runtime route, provider dispatch rule,
-- migration authorization, or auto-apply policy is created by this draft.
