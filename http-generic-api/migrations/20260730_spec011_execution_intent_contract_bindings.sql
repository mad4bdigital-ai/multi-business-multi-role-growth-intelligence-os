-- Spec 011 Phase 2: dynamic intent-first execution-contract bindings.
-- Additive contract only. Production application requires governed authorization and same-cycle readback.

CREATE TABLE IF NOT EXISTS execution_intent_contract_bindings (
  binding_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  intent_key VARCHAR(191) NOT NULL,
  principal_scope VARCHAR(32) NOT NULL,
  tenant_binding_mode VARCHAR(32) NOT NULL DEFAULT 'none',
  parent_action_key VARCHAR(191) NOT NULL,
  endpoint_key VARCHAR(191) NOT NULL,
  capability_key VARCHAR(191) NOT NULL,
  runtime_surface VARCHAR(191) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  priority INT NOT NULL DEFAULT 100,
  binding_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  source_registry VARCHAR(191) NULL,
  source_key VARCHAR(191) NULL,
  valid_from DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (binding_id),
  UNIQUE KEY uq_execution_intent_binding_revision (
    intent_key,
    principal_scope,
    binding_revision
  ),
  KEY idx_execution_intent_binding_resolution (
    intent_key,
    principal_scope,
    status,
    priority,
    binding_revision
  ),
  KEY idx_execution_intent_binding_exact_contract (
    parent_action_key,
    endpoint_key,
    capability_key,
    status
  ),
  KEY idx_execution_intent_binding_expiry (expires_at),
  CONSTRAINT chk_execution_intent_binding_scope
    CHECK (principal_scope IN ('admin', 'tenant', 'internal')),
  CONSTRAINT chk_execution_intent_binding_tenant_mode
    CHECK (tenant_binding_mode IN ('none', 'tenant_required', 'admin_only', 'internal_only')),
  CONSTRAINT chk_execution_intent_binding_priority
    CHECK (priority >= 0),
  CONSTRAINT chk_execution_intent_binding_revision
    CHECK (binding_revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
