-- MariaDB ordered-chain pre-creation for the immutable 20260722 provenance migration.
-- The original migration may already have been partially applied; do not rewrite it.
-- This additive CREATE IF NOT EXISTS establishes the MariaDB 11.4-compatible
-- relationship-key collation before the original migration's first JOIN/view use.
CREATE TABLE IF NOT EXISTS agent_skill_grant_requests (
  request_id VARCHAR(36) NOT NULL PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL,
  skill_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  brand_key VARCHAR(128) NULL,
  tenant_scope_key VARCHAR(64)
    GENERATED ALWAYS AS (COALESCE(tenant_id, '__global__')) STORED,
  brand_scope_key VARCHAR(128)
    GENERATED ALWAYS AS (COALESCE(brand_key, '__all_brands__')) STORED,
  request_status ENUM('pending','approved','rejected','deferred','expired','not_required') NOT NULL DEFAULT 'pending',
  approval_policy_key VARCHAR(128) NOT NULL,
  approval_hold_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  requested_by VARCHAR(128) NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decision_by VARCHAR(128) NULL,
  decision_note VARCHAR(512) NULL,
  decided_at DATETIME NULL,
  provenance_type ENUM('runtime_request','tenant_owner_decision','platform_admin_decision','platform_bootstrap_migration','not_required') NOT NULL DEFAULT 'runtime_request',
  provenance_ref VARCHAR(255) NULL,
  idempotency_key VARCHAR(191) NULL,
  expires_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  open_effective_scope_key VARCHAR(512)
    GENERATED ALWAYS AS (
      CASE
        WHEN request_status IN ('pending','deferred') THEN CONCAT(
          agent_id, '|', skill_id, '|', COALESCE(tenant_id, '__global__'), '|', COALESCE(brand_key, '__all_brands__')
        )
        ELSE NULL
      END
    ) STORED,
  UNIQUE KEY uq_agent_skill_grant_requests_open_scope (open_effective_scope_key),
  UNIQUE KEY uq_agent_skill_grant_requests_idempotency (requested_by, idempotency_key),
  INDEX idx_agent_skill_grant_requests_subject (tenant_id, brand_key, request_status, requested_at),
  INDEX idx_agent_skill_grant_requests_agent (agent_id, skill_id, request_status),
  INDEX idx_agent_skill_grant_requests_hold (approval_hold_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

ALTER TABLE agent_skill_grant_requests
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci,
  MODIFY COLUMN request_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN agent_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN skill_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  MODIFY COLUMN tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL,
  MODIFY COLUMN brand_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL;

-- corrective_migration=true
-- original_migration_immutable=true
-- partial_state_safe=true
-- precreation_only=true
-- narrow_collation_alignment=true
-- whole_table_convert=false
-- binary_comparison_workaround=false
-- encrypted_payload_columns_modified=false
-- json_payload_columns_modified=false
-- same_cycle_schema_readback_required=true
-- provider_calls=false
-- external_writes=false
-- secrets_included=false
