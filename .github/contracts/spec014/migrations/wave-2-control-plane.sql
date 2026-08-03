-- spec014_hostinger_storage_wave_2_control_plane.sql
-- DRAFT ONLY: contract-local SQL; not discoverable by governed-migration-runner.
-- Tasks: T025
-- migration_apply_authorized=false
-- schema_verified=false
-- production_ready=false
-- destructive_ddl=false
-- external_fk_ddl_deferred_until_exact_parent_readback=true
-- runtime_parent_fk_ddl_deferred_until_parent_writer=true
-- adapter_insert_compatible=true
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

CREATE TABLE IF NOT EXISTS storage_cleanup_operations (
  id CHAR(36) NOT NULL,
  operation_class VARCHAR(64) NOT NULL DEFAULT 'hostinger_storage_cleanup',
  operation_key VARCHAR(128) NULL,
  selected_context VARCHAR(16) NULL,
  principal_ref VARCHAR(191) NULL,
  effective_subject_ref VARCHAR(191) NULL,
  target_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NULL,
  resource_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  authority_context_hash CHAR(64) NULL,
  ownership_revision VARCHAR(64) NULL,
  policy_revision VARCHAR(64) NULL,
  idempotency_key CHAR(64) NOT NULL,
  state VARCHAR(64) NOT NULL,
  risk_class VARCHAR(64) NULL,
  version BIGINT UNSIGNED NOT NULL,
  capability_evidence_ref VARCHAR(191) NULL,
  resource_authority_ref VARCHAR(191) NULL,
  delegation_ref VARCHAR(191) NULL,
  support_case_ref VARCHAR(191) NULL,
  break_glass_ref VARCHAR(191) NULL,
  release_authority_ref VARCHAR(191) NULL,
  current_plan_id CHAR(36) NULL,
  current_run_id CHAR(36) NULL,
  current_lease_id CHAR(36) NULL,
  unknown_outcome TINYINT(1) NOT NULL DEFAULT 0,
  reconciliation_status VARCHAR(32) NOT NULL DEFAULT 'not_required',
  terminal_reason VARCHAR(191) NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_cleanup_operations_idempotency
    (operation_class, target_id, idempotency_key),
  KEY idx_storage_cleanup_operations_target_state (target_id, state),
  KEY idx_storage_cleanup_operations_tenant_created (tenant_id, workspace_id, created_at),
  KEY idx_storage_cleanup_operations_unknown_reconcile (unknown_outcome, reconciliation_status),
  CONSTRAINT fk_storage_cleanup_operations_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT fk_storage_cleanup_operations_provider
    FOREIGN KEY (provider_account_id) REFERENCES storage_provider_accounts(id),
  CONSTRAINT chk_storage_cleanup_operations_context
    CHECK (selected_context IS NULL OR selected_context IN ('admin', 'tenant')),
  CONSTRAINT chk_storage_cleanup_operations_idempotency
    CHECK (idempotency_key REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storage_cleanup_operations_authority_hash
    CHECK (authority_context_hash IS NULL OR authority_context_hash REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storage_cleanup_operations_record_digest
    CHECK (record_digest REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storage_cleanup_operations_unknown
    CHECK (unknown_outcome IN (0, 1)),
  CONSTRAINT chk_storage_cleanup_operations_versions
    CHECK (version >= 1 AND row_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_cleanup_plans (
  id CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NULL,
  resource_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  ownership_scope VARCHAR(32) NULL,
  authority_context_hash CHAR(64) NULL,
  ownership_revision VARCHAR(64) NULL,
  policy_revision VARCHAR(64) NULL,
  source_snapshot_id CHAR(36) NULL,
  candidate_set_hash CHAR(64) NULL,
  plan_hash CHAR(64) NOT NULL,
  item_count BIGINT UNSIGNED NULL,
  total_bytes BIGINT UNSIGNED NULL,
  category_totals_json JSON NULL,
  impact_set_hash CHAR(64) NULL,
  expires_at_epoch BIGINT UNSIGNED NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'planned',
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  consumed_run_id CHAR(36) NULL,
  consumed_at_epoch BIGINT UNSIGNED NULL,
  bounded TINYINT(1) NOT NULL DEFAULT 1,
  truncated TINYINT(1) NOT NULL DEFAULT 0,
  protected_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_cleanup_plans_operation_hash (operation_id, plan_hash),
  KEY idx_storage_cleanup_plans_operation_status (operation_id, status),
  KEY idx_storage_cleanup_plans_target_expiry (target_id, expires_at_epoch),
  KEY idx_storage_cleanup_plans_hash (plan_hash),
  CONSTRAINT fk_storage_cleanup_plans_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT fk_storage_cleanup_plans_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT fk_storage_cleanup_plans_provider
    FOREIGN KEY (provider_account_id) REFERENCES storage_provider_accounts(id),
  CONSTRAINT fk_storage_cleanup_plans_snapshot
    FOREIGN KEY (source_snapshot_id) REFERENCES storage_pressure_snapshots(id),
  CONSTRAINT chk_storage_cleanup_plans_scope
    CHECK (ownership_scope IS NULL OR ownership_scope IN ('platform', 'tenant', 'shared')),
  CONSTRAINT chk_storage_cleanup_plans_hashes
    CHECK (
      plan_hash REGEXP '^[0-9a-f]{64}$'
      AND (authority_context_hash IS NULL OR authority_context_hash REGEXP '^[0-9a-f]{64}$')
      AND (candidate_set_hash IS NULL OR candidate_set_hash REGEXP '^[0-9a-f]{64}$')
      AND (impact_set_hash IS NULL OR impact_set_hash REGEXP '^[0-9a-f]{64}$')
      AND record_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_cleanup_plans_no_secrets CHECK (secrets_included = 0),
  CONSTRAINT chk_storage_cleanup_plans_flags
    CHECK (bounded = 1 AND truncated IN (0, 1) AND consumed IN (0, 1) AND row_version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_cleanup_plan_items (
  id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  ordinal BIGINT UNSIGNED NOT NULL,
  category VARCHAR(64) NOT NULL,
  path_ref VARCHAR(512) NOT NULL,
  tenant_safe_relative_path VARCHAR(512) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  device_id_digest CHAR(64) NULL,
  inode_value BIGINT UNSIGNED NULL,
  ctime_ns BIGINT UNSIGNED NULL,
  mtime_ns BIGINT UNSIGNED NULL,
  expected_file_type VARCHAR(32) NOT NULL,
  eligibility_rule_key VARCHAR(128) NOT NULL,
  eligibility_evidence_digest CHAR(64) NOT NULL,
  ownership_evidence_ref VARCHAR(191) NOT NULL,
  protected_classification TINYINT(1) NOT NULL DEFAULT 0,
  item_hash CHAR(64) NOT NULL,
  planned_result_state VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_cleanup_plan_items_ordinal (plan_id, ordinal),
  UNIQUE KEY uq_storage_cleanup_plan_items_hash (plan_id, item_hash),
  KEY idx_storage_cleanup_plan_items_category (plan_id, category),
  KEY idx_storage_cleanup_plan_items_item_hash (item_hash),
  CONSTRAINT fk_storage_cleanup_plan_items_plan
    FOREIGN KEY (plan_id) REFERENCES storage_cleanup_plans(id),
  CONSTRAINT chk_storage_cleanup_plan_items_hashes
    CHECK (
      item_hash REGEXP '^[0-9a-f]{64}$'
      AND eligibility_evidence_digest REGEXP '^[0-9a-f]{64}$'
      AND (device_id_digest IS NULL OR device_id_digest REGEXP '^[0-9a-f]{64}$')
    ),
  CONSTRAINT chk_storage_cleanup_plan_items_protected
    CHECK (protected_classification = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_cleanup_plan_impacts (
  id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  resource_id CHAR(36) NOT NULL,
  impact_class VARCHAR(64) NOT NULL,
  candidate_count BIGINT UNSIGNED NOT NULL,
  candidate_bytes BIGINT UNSIGNED NOT NULL,
  approval_requirement_key VARCHAR(128) NOT NULL,
  resolution_evidence_digest CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unresolved',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_cleanup_plan_impacts_audience
    (plan_id, tenant_id, workspace_id, resource_id, impact_class),
  KEY idx_storage_cleanup_plan_impacts_status (plan_id, status),
  KEY idx_storage_cleanup_plan_impacts_workspace_approval
    (workspace_id, approval_requirement_key),
  CONSTRAINT fk_storage_cleanup_plan_impacts_plan
    FOREIGN KEY (plan_id) REFERENCES storage_cleanup_plans(id),
  CONSTRAINT chk_storage_cleanup_plan_impacts_digest
    CHECK (resolution_evidence_digest REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_cleanup_approvals (
  id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  approval_slot VARCHAR(64) NOT NULL,
  approval_generation BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  approver_principal_ref VARCHAR(191) NULL,
  approver_context_ref VARCHAR(191) NULL,
  approver_workspace_id CHAR(36) NULL,
  decision VARCHAR(32) NOT NULL,
  authority_evidence_ref VARCHAR(191) NULL,
  plan_hash CHAR(64) NULL,
  candidate_set_hash CHAR(64) NULL,
  impact_set_hash CHAR(64) NULL,
  authority_context_hash CHAR(64) NULL,
  ownership_revision VARCHAR(64) NULL,
  policy_revision VARCHAR(64) NULL,
  confirmation_contract_key VARCHAR(128) NULL,
  confirmation_digest CHAR(64) NULL,
  expires_at_epoch BIGINT UNSIGNED NULL,
  decided_at_epoch BIGINT UNSIGNED NULL,
  invalidated TINYINT(1) NOT NULL DEFAULT 0,
  invalidated_reason VARCHAR(191) NULL,
  invalidated_at_epoch BIGINT UNSIGNED NULL,
  supersedes_approval_id CHAR(36) NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_cleanup_approvals_auto_generation (approval_generation),
  UNIQUE KEY uq_storage_cleanup_approvals_generation
    (plan_id, approval_slot, approval_generation),
  KEY idx_storage_cleanup_approvals_decision
    (plan_id, decision, invalidated),
  KEY idx_storage_cleanup_approvals_expiry (expires_at_epoch),
  KEY idx_storage_cleanup_approvals_principal (approver_principal_ref),
  CONSTRAINT fk_storage_cleanup_approvals_plan
    FOREIGN KEY (plan_id) REFERENCES storage_cleanup_plans(id),
  CONSTRAINT fk_storage_cleanup_approvals_supersedes
    FOREIGN KEY (supersedes_approval_id) REFERENCES storage_cleanup_approvals(id),
  CONSTRAINT chk_storage_cleanup_approvals_decision
    CHECK (decision IN ('approved', 'denied')),
  CONSTRAINT chk_storage_cleanup_approvals_invalidated
    CHECK (invalidated IN (0, 1) AND row_version >= 1),
  CONSTRAINT chk_storage_cleanup_approvals_hashes
    CHECK (
      record_digest REGEXP '^[0-9a-f]{64}$'
      AND (plan_hash IS NULL OR plan_hash REGEXP '^[0-9a-f]{64}$')
      AND (candidate_set_hash IS NULL OR candidate_set_hash REGEXP '^[0-9a-f]{64}$')
      AND (impact_set_hash IS NULL OR impact_set_hash REGEXP '^[0-9a-f]{64}$')
      AND (authority_context_hash IS NULL OR authority_context_hash REGEXP '^[0-9a-f]{64}$')
      AND (confirmation_digest IS NULL OR confirmation_digest REGEXP '^[0-9a-f]{64}$')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_execution_leases (
  id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  root_ref_digest CHAR(64)
    GENERATED ALWAYS AS (LOWER(SHA2(target_id, 256))) STORED,
  active_slot TINYINT UNSIGNED NOT NULL DEFAULT 1,
  lease_id CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  lease_purpose VARCHAR(32) NULL,
  generation BIGINT UNSIGNED NOT NULL,
  holder_worker_ref VARCHAR(191) NULL,
  holder_session_ref VARCHAR(191) NULL,
  acquired_at_epoch BIGINT UNSIGNED NULL,
  renewed_at_epoch BIGINT UNSIGNED NULL,
  expires_at_epoch BIGINT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL,
  release_evidence_digest CHAR(64) NULL,
  readback_evidence_digest CHAR(64) NULL,
  lease_history_json JSON NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_execution_leases_active
    (target_id, root_ref_digest, active_slot),
  UNIQUE KEY uq_storage_execution_leases_lease_id (lease_id),
  KEY idx_storage_execution_leases_operation_status (operation_id, status),
  KEY idx_storage_execution_leases_target_expiry (target_id, status, expires_at_epoch),
  KEY idx_storage_execution_leases_worker_status (holder_worker_ref, status),
  CONSTRAINT fk_storage_execution_leases_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT fk_storage_execution_leases_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT chk_storage_execution_leases_purpose
    CHECK (lease_purpose IS NULL OR lease_purpose IN ('cleanup_apply', 'reserve', 'deployment')),
  CONSTRAINT chk_storage_execution_leases_status
    CHECK (status IN ('active', 'released')),
  CONSTRAINT chk_storage_execution_leases_digests
    CHECK (
      root_ref_digest REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
      AND (release_evidence_digest IS NULL OR release_evidence_digest REGEXP '^[0-9a-f]{64}$')
      AND (readback_evidence_digest IS NULL OR readback_evidence_digest REGEXP '^[0-9a-f]{64}$')
    ),
  CONSTRAINT chk_storage_execution_leases_versions
    CHECK (generation >= 1 AND row_version >= 1 AND active_slot = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The current adapter updates one target-bound lease row through generation and row_version CAS.
-- lease_history_json is reserved for the separately governed history-appending service and must
-- be certified before schema_verified or production_ready can become true.
-- External FK intents for tenants/workspaces/platform_resources/principals remain deferred.
-- Cyclic operation current_plan/current_run/current_lease references are not emitted here.
