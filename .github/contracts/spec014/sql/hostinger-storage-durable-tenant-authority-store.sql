-- Spec 014 — Durable Tenant Authority Store schema contract
-- CONTRACT-LOCAL DDL ONLY. This file is not part of the promoted runtime migration sequence.
-- It must not be applied without a separately reviewed migration candidate, checksum-bound
-- authorization, dry-run, typed confirmation, same-cycle readback, and signed verification.

CREATE TABLE IF NOT EXISTS storage_tenant_authority_allowlists (
  id CHAR(36) NOT NULL,
  revision VARCHAR(191) NOT NULL,
  status VARCHAR(32) NOT NULL,
  environment VARCHAR(32) NOT NULL,
  target_scope VARCHAR(32) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  resource_id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  root_ref VARCHAR(512) NOT NULL,
  path_ref_prefix VARCHAR(512) NOT NULL,
  shared_target TINYINT(1) NOT NULL DEFAULT 0,
  platform_target TINYINT(1) NOT NULL DEFAULT 0,
  valid_from_epoch BIGINT UNSIGNED NOT NULL,
  expires_at_epoch BIGINT UNSIGNED NOT NULL,
  max_items BIGINT UNSIGNED NOT NULL,
  max_bytes BIGINT UNSIGNED NOT NULL,
  evidence_digest CHAR(64) NOT NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_storage_tenant_authority_allowlists_audience
    (tenant_id, workspace_id, resource_id, status),
  KEY idx_storage_tenant_authority_allowlists_target_expiry
    (target_id, status, expires_at_epoch),
  CONSTRAINT fk_storage_tenant_authority_allowlists_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT chk_storage_tenant_authority_allowlists_status
    CHECK (status IN ('active', 'blocked', 'revoked', 'expired')),
  CONSTRAINT chk_storage_tenant_authority_allowlists_scope
    CHECK (target_scope = 'tenant' AND shared_target = 0 AND platform_target = 0),
  CONSTRAINT chk_storage_tenant_authority_allowlists_window
    CHECK (valid_from_epoch < expires_at_epoch),
  CONSTRAINT chk_storage_tenant_authority_allowlists_limits
    CHECK (max_items >= 1 AND row_version >= 1),
  CONSTRAINT chk_storage_tenant_authority_allowlists_digests
    CHECK (
      evidence_digest REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_tenant_authority_allowlists_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_tenant_authority_approvals (
  id CHAR(36) NOT NULL,
  approval_slot VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  target_id CHAR(36) NOT NULL,
  plan_hash CHAR(64) NOT NULL,
  authority_context_hash CHAR(64) NOT NULL,
  approver_role VARCHAR(64) NOT NULL,
  approved_at_epoch BIGINT UNSIGNED NOT NULL,
  expires_at_epoch BIGINT UNSIGNED NOT NULL,
  evidence_digest CHAR(64) NOT NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_storage_tenant_authority_approvals_audience
    (tenant_id, workspace_id, status, expires_at_epoch),
  KEY idx_storage_tenant_authority_approvals_operation
    (operation_id, approval_slot, status),
  KEY idx_storage_tenant_authority_approvals_target_plan
    (target_id, plan_hash),
  CONSTRAINT fk_storage_tenant_authority_approvals_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT fk_storage_tenant_authority_approvals_target
    FOREIGN KEY (target_id) REFERENCES storage_targets(id),
  CONSTRAINT chk_storage_tenant_authority_approvals_status
    CHECK (status IN ('approved', 'denied', 'revoked', 'expired')),
  CONSTRAINT chk_storage_tenant_authority_approvals_role
    CHECK (approver_role = 'workspace_owner'),
  CONSTRAINT chk_storage_tenant_authority_approvals_window
    CHECK (approved_at_epoch < expires_at_epoch),
  CONSTRAINT chk_storage_tenant_authority_approvals_digests
    CHECK (
      plan_hash REGEXP '^[0-9a-f]{64}$'
      AND authority_context_hash REGEXP '^[0-9a-f]{64}$'
      AND evidence_digest REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
      AND row_version >= 1
    ),
  CONSTRAINT chk_storage_tenant_authority_approvals_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_tenant_authority_token_history (
  id CHAR(36) NOT NULL,
  authority_type VARCHAR(32) NOT NULL,
  authority_id CHAR(36) NOT NULL,
  token_kind VARCHAR(32) NOT NULL,
  token_value VARCHAR(191) NOT NULL,
  record_digest CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_tenant_authority_token_history_token
    (authority_type, authority_id, token_kind, token_value),
  KEY idx_storage_tenant_authority_token_history_authority
    (authority_type, authority_id, created_at),
  CONSTRAINT chk_storage_tenant_authority_token_history_type
    CHECK (authority_type IN ('allowlist', 'approval')),
  CONSTRAINT chk_storage_tenant_authority_token_history_kind
    CHECK (token_kind IN ('revision', 'evidence_digest')),
  CONSTRAINT chk_storage_tenant_authority_token_history_pair
    CHECK (
      (authority_type = 'allowlist' AND token_kind = 'revision')
      OR (authority_type = 'approval' AND token_kind = 'evidence_digest')
    ),
  CONSTRAINT chk_storage_tenant_authority_token_history_digest
    CHECK (record_digest REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tenant/workspace/resource parent FKs remain deferred until the governed live apply cycle
-- proves exact parent type, collation, and lifecycle compatibility.
-- Token-history rows are append-only; no UPDATE or DELETE path is authorized.
