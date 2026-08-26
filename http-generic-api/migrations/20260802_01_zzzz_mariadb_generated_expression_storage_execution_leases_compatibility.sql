-- MariaDB 11.4 compatibility bridge for the immutable 20260802_02 storage-control
-- plane definitions. SHA2() already returns the required lowercase hexadecimal
-- digest; MariaDB 11.4 rejects LOWER(SHA2(...)) in a STORED generated column with
-- ERROR 1901. This bridge keeps the historical migration immutable and precreates
-- both related tables before their CREATE TABLE IF NOT EXISTS statements.
-- The parent is included so the lease foreign keys remain present in the bridge.
-- DDL only: no DML, provider access, credentials, data export, runtime mutation,
-- Production action, or secrets.

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

CREATE TABLE IF NOT EXISTS storage_execution_leases (
  id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  root_ref_digest CHAR(64)
    GENERATED ALWAYS AS (SHA2(target_id, 256)) STORED,
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
