-- spec014_hostinger_storage_wave_1_foundation.sql
-- DRAFT ONLY: specification-local SQL; not discoverable by governed-migration-runner.
-- Tasks: T024
-- migration_apply_authorized=false
-- destructive_ddl=false
-- external_fk_ddl_deferred_until_exact_parent_readback=true
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

CREATE TABLE IF NOT EXISTS storage_provider_accounts (
  id CHAR(36) NOT NULL,
  provider_key VARCHAR(64) NOT NULL,
  provider_account_ref VARCHAR(191) NOT NULL,
  ownership_scope VARCHAR(32) NOT NULL,
  platform_owner_resource_id CHAR(36) NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'blocked',
  policy_revision VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_provider_accounts_provider_ref (provider_key, provider_account_ref),
  KEY idx_storage_provider_accounts_ownership_status (ownership_scope, status),
  KEY idx_storage_provider_accounts_tenant_workspace_status (tenant_id, workspace_id, status),
  CONSTRAINT chk_storage_provider_accounts_scope
    CHECK (ownership_scope IN ('platform', 'tenant', 'shared')),
  CONSTRAINT chk_storage_provider_accounts_status
    CHECK (status IN ('active', 'blocked', 'retired')),
  CONSTRAINT chk_storage_provider_accounts_tenant_audience
    CHECK (
      (ownership_scope = 'tenant' AND tenant_id IS NOT NULL AND workspace_id IS NOT NULL)
      OR (ownership_scope IN ('platform', 'shared'))
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_targets (
  id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  resource_id CHAR(36) NOT NULL,
  target_key VARCHAR(128) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  ownership_scope VARCHAR(32) NOT NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  parent_target_id CHAR(36) NULL,
  storage_root_ref VARCHAR(255) NOT NULL,
  ssh_target_ref VARCHAR(191) NULL,
  host_key_fingerprint_ref VARCHAR(191) NULL,
  active_deployment_ref VARCHAR(191) NULL,
  ownership_revision VARCHAR(64) NOT NULL,
  policy_revision VARCHAR(64) NOT NULL,
  layout_certification_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  dispatch_status VARCHAR(32) NOT NULL DEFAULT 'disabled',
  status VARCHAR(32) NOT NULL DEFAULT 'blocked',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_targets_provider_target (provider_account_id, target_key),
  KEY idx_storage_targets_tenant_resource_status (tenant_id, workspace_id, resource_id, status),
  KEY idx_storage_targets_ownership_status (ownership_scope, status),
  KEY idx_storage_targets_ssh_status (ssh_target_ref, status),
  KEY idx_storage_targets_parent (parent_target_id),
  CONSTRAINT fk_storage_targets_provider_account
    FOREIGN KEY (provider_account_id) REFERENCES storage_provider_accounts(id),
  CONSTRAINT fk_storage_targets_parent
    FOREIGN KEY (parent_target_id) REFERENCES storage_targets(id),
  CONSTRAINT chk_storage_targets_type
    CHECK (target_type IN ('account', 'website', 'deployment_slot', 'storage_root', 'reserve')),
  CONSTRAINT chk_storage_targets_scope
    CHECK (ownership_scope IN ('platform', 'tenant', 'shared')),
  CONSTRAINT chk_storage_targets_layout
    CHECK (layout_certification_status IN ('unknown', 'inventory_only', 'certified')),
  CONSTRAINT chk_storage_targets_dispatch
    CHECK (dispatch_status IN ('disabled', 'scan_only', 'synthetic_apply', 'enabled')),
  CONSTRAINT chk_storage_targets_status
    CHECK (status IN ('active', 'blocked', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_target_bindings (
  id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  binding_revision BIGINT UNSIGNED NOT NULL,
  tenant_id CHAR(36) NULL,
  workspace_id CHAR(36) NULL,
  resource_id CHAR(36) NOT NULL,
  ownership_scope VARCHAR(32) NOT NULL,
  canonical_root_digest CHAR(64) NOT NULL,
  canonical_root_ref VARCHAR(255) NULL,
  allowed_operation_classes_json JSON NOT NULL,
  active_from DATETIME(3) NOT NULL,
  active_to DATETIME(3) NULL,
  evidence_source VARCHAR(64) NOT NULL,
  evidence_digest CHAR(64) NOT NULL,
  created_by_principal_ref VARCHAR(191) NOT NULL,
  created_by_operation_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_target_bindings_revision (target_id, binding_revision),
  KEY idx_storage_target_bindings_current (target_id, active_to),
  KEY idx_storage_target_bindings_audience (tenant_id, workspace_id, resource_id),
  CONSTRAINT fk_storage_target_bindings_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT chk_storage_target_bindings_scope
    CHECK (ownership_scope IN ('platform', 'tenant', 'shared')),
  CONSTRAINT chk_storage_target_bindings_root_digest
    CHECK (canonical_root_digest REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storage_target_bindings_evidence_digest
    CHECK (evidence_digest REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_pressure_snapshots (
  id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  provider_account_id CHAR(36) NOT NULL,
  provider_observed_at DATETIME(3) NOT NULL,
  provider_evidence_ref VARCHAR(191) NOT NULL,
  provider_evidence_digest CHAR(64) NOT NULL,
  disk_limit_bytes BIGINT UNSIGNED NULL,
  disk_used_bytes BIGINT UNSIGNED NULL,
  disk_percent DECIMAL(7,4) NULL,
  inode_limit BIGINT UNSIGNED NULL,
  inode_used BIGINT UNSIGNED NULL,
  inode_percent DECIMAL(7,4) NULL,
  ssh_observed_at DATETIME(3) NULL,
  logical_usage_bytes BIGINT UNSIGNED NULL,
  logical_inode_count BIGINT UNSIGNED NULL,
  byte_pressure_state VARCHAR(32) NOT NULL,
  inode_pressure_state VARCHAR(32) NOT NULL,
  effective_pressure_state VARCHAR(32) NOT NULL,
  completeness VARCHAR(32) NOT NULL,
  top_directory_summary JSON NULL,
  inode_hotspot_summary JSON NULL,
  category_footprint_summary JSON NULL,
  active_deployment_evidence_ref VARCHAR(191) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_pressure_snapshot_evidence
    (target_id, provider_observed_at, provider_evidence_digest),
  KEY idx_storage_pressure_target_observed (target_id, provider_observed_at),
  KEY idx_storage_pressure_effective_observed (effective_pressure_state, provider_observed_at),
  KEY idx_storage_pressure_completeness_observed (completeness, provider_observed_at),
  CONSTRAINT fk_storage_pressure_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT fk_storage_pressure_provider
    FOREIGN KEY (provider_account_id) REFERENCES storage_provider_accounts(id),
  CONSTRAINT chk_storage_pressure_provider_digest
    CHECK (provider_evidence_digest REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_storage_pressure_no_secrets CHECK (secrets_included = 0),
  CONSTRAINT chk_storage_pressure_completeness
    CHECK (completeness IN ('complete', 'partial', 'stale', 'failed')),
  CONSTRAINT chk_storage_pressure_effective_state
    CHECK (effective_pressure_state IN ('normal', 'warning', 'critical', 'emergency', 'unknown'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- External FK intents are deliberately not emitted until same-cycle preflight proves
-- exact parent type/collation for tenants.id, workspaces.id, and platform_resources.id.
