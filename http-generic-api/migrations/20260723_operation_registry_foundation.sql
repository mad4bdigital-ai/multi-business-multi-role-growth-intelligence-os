-- Spec 011 Phase 1A: registry-first operation authority foundation.
--
-- This additive migration creates the canonical operation, step, and execution
-- binding registries plus a bounded readback view. It does not activate any
-- operation, export a GPT tool, dispatch a runtime, or apply provider changes.
--
-- Safety contract:
-- - no provider call
-- - no external send
-- - no external write
-- - no credential payload read
-- - no raw secrets
-- - no runtime activation
-- - no tool projection
-- - no destructive SQL
-- - secrets_included=false

CREATE TABLE IF NOT EXISTS operation_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  operation_id CHAR(36) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  version INT UNSIGNED NOT NULL,
  display_name VARCHAR(191) NOT NULL,
  description TEXT NULL,
  operation_class ENUM(
    'read',
    'mutation',
    'repository',
    'repository_mutation',
    'workflow',
    'provider',
    'provider_mutation',
    'internal',
    'other'
  ) NOT NULL,
  scope_type ENUM('admin', 'tenant', 'user', 'workspace', 'internal') NOT NULL,
  risk_level ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  execution_mode ENUM('synchronous', 'asynchronous', 'hybrid') NOT NULL,
  input_schema_json JSON NOT NULL COMMENT 'Strict request schema; secret-bearing fields are forbidden.',
  output_schema_json JSON NOT NULL COMMENT 'Stable response schema; secret-bearing fields are forbidden.',
  status ENUM('draft', 'shadow', 'active', 'degraded', 'disabled', 'archived') NOT NULL DEFAULT 'draft',
  revision_hash CHAR(64) NOT NULL,
  source_revision_hash CHAR(64) NULL,
  compiler_version VARCHAR(64) NULL,
  metadata_json JSON NULL COMMENT 'Non-secret metadata only.',
  created_by VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  activated_at TIMESTAMP NULL,
  superseded_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_registry_id (operation_id),
  UNIQUE KEY uq_operation_registry_key_version (operation_key, version),
  KEY idx_operation_registry_status_scope (status, scope_type, operation_class),
  KEY idx_operation_registry_risk_mode (risk_level, execution_mode),
  KEY idx_operation_registry_revision (revision_hash),
  KEY idx_operation_registry_source_revision (source_revision_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Canonical versioned operation contracts. No transport or credential authority.';

CREATE TABLE IF NOT EXISTS operation_step_registry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  step_id CHAR(36) NOT NULL,
  operation_registry_id BIGINT UNSIGNED NOT NULL,
  step_key VARCHAR(191) NOT NULL,
  step_order INT UNSIGNED NOT NULL,
  depends_on_json JSON NULL COMMENT 'Ordered dependency step keys for DAG execution.',
  handler_key VARCHAR(191) NOT NULL COMMENT 'Stable handler selector; execution authority resolves elsewhere.',
  capability_key VARCHAR(191) NULL,
  input_mapping_json JSON NULL COMMENT 'Non-secret mapping expressions only.',
  success_condition_json JSON NULL,
  retry_policy_json JSON NULL,
  failure_policy_json JSON NULL,
  timeout_seconds INT UNSIGNED NULL,
  compensation_required TINYINT(1) NOT NULL DEFAULT 0,
  compensation_policy_key VARCHAR(191) NULL,
  status ENUM('draft', 'shadow', 'active', 'degraded', 'disabled', 'archived') NOT NULL DEFAULT 'draft',
  revision_hash CHAR(64) NOT NULL,
  metadata_json JSON NULL COMMENT 'Non-secret metadata only.',
  created_by VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_step_registry_id (step_id),
  UNIQUE KEY uq_operation_step_registry_operation_step (operation_registry_id, step_key),
  KEY idx_operation_step_registry_operation_order (operation_registry_id, step_order),
  KEY idx_operation_step_registry_handler_status (handler_key, status),
  KEY idx_operation_step_registry_capability_status (capability_key, status),
  KEY idx_operation_step_registry_revision (revision_hash),
  CONSTRAINT fk_operation_step_registry_operation
    FOREIGN KEY (operation_registry_id) REFERENCES operation_registry (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Version-bound ordered or DAG operation steps; no direct runtime authority.';

CREATE TABLE IF NOT EXISTS operation_execution_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id CHAR(36) NOT NULL,
  operation_registry_id BIGINT UNSIGNED NOT NULL,
  binding_key VARCHAR(191) NOT NULL,
  binding_scope_type ENUM('resource', 'workspace', 'tenant', 'platform') NOT NULL DEFAULT 'platform',
  scope_ref VARCHAR(191) NULL,
  provider_family VARCHAR(128) NULL,
  adapter_key VARCHAR(191) NOT NULL,
  runtime_key VARCHAR(191) NOT NULL,
  capability_key VARCHAR(191) NULL,
  dispatch_binding_key VARCHAR(191) NULL COMMENT 'Reference to platform_tool_dispatch_bindings authority.',
  endpoint_export_key VARCHAR(191) NULL COMMENT 'Reference to platform_endpoint_tool_exports authority.',
  resource_authority_recipe_key VARCHAR(191) NULL,
  credential_scope_key VARCHAR(191) NULL,
  priority INT NOT NULL DEFAULT 100,
  fallback_rank INT UNSIGNED NOT NULL DEFAULT 0,
  compatibility_predicate_json JSON NULL COMMENT 'Deterministic non-secret selector predicates.',
  approval_policy_key VARCHAR(191) NULL,
  readback_policy_key VARCHAR(191) NULL,
  requires_approval TINYINT(1) NOT NULL DEFAULT 0,
  requires_readback TINYINT(1) NOT NULL DEFAULT 1,
  valid_from TIMESTAMP NULL,
  valid_until TIMESTAMP NULL,
  status ENUM('draft', 'shadow', 'active', 'degraded', 'disabled', 'archived') NOT NULL DEFAULT 'draft',
  revision_hash CHAR(64) NOT NULL,
  metadata_json JSON NULL COMMENT 'Non-secret metadata only.',
  created_by VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_execution_bindings_id (binding_id),
  UNIQUE KEY uq_operation_execution_bindings_operation_key (operation_registry_id, binding_key),
  KEY idx_operation_execution_bindings_resolution (
    operation_registry_id,
    status,
    binding_scope_type,
    priority,
    fallback_rank
  ),
  KEY idx_operation_execution_bindings_scope (binding_scope_type, scope_ref, provider_family),
  KEY idx_operation_execution_bindings_adapter_runtime (adapter_key, runtime_key, status),
  KEY idx_operation_execution_bindings_capability (capability_key, status),
  KEY idx_operation_execution_bindings_dispatch (dispatch_binding_key, endpoint_export_key),
  KEY idx_operation_execution_bindings_validity (valid_from, valid_until),
  KEY idx_operation_execution_bindings_revision (revision_hash),
  CONSTRAINT fk_operation_execution_bindings_operation
    FOREIGN KEY (operation_registry_id) REFERENCES operation_registry (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Operation selectors referencing existing capability and dispatch authorities.';

CREATE OR REPLACE VIEW v_operation_registry_foundation AS
SELECT
  o.operation_id,
  o.operation_key,
  o.version,
  o.display_name,
  o.operation_class,
  o.scope_type,
  o.risk_level,
  o.execution_mode,
  o.status,
  o.revision_hash,
  o.source_revision_hash,
  COALESCE(s.step_count, 0) AS step_count,
  COALESCE(s.active_step_count, 0) AS active_step_count,
  COALESCE(s.shadow_step_count, 0) AS shadow_step_count,
  COALESCE(b.binding_count, 0) AS binding_count,
  COALESCE(b.active_binding_count, 0) AS active_binding_count,
  COALESCE(b.shadow_binding_count, 0) AS shadow_binding_count,
  CASE
    WHEN o.status IN ('disabled', 'archived') THEN 'lifecycle_blocked'
    WHEN COALESCE(s.step_count, 0) = 0 THEN 'steps_missing'
    WHEN COALESCE(b.binding_count, 0) = 0 THEN 'bindings_missing'
    WHEN o.status = 'active' AND COALESCE(b.active_binding_count, 0) = 0 THEN 'active_binding_missing'
    ELSE 'ready_for_shadow_validation'
  END AS readiness_status,
  o.created_at,
  o.updated_at,
  0 AS secrets_included
FROM operation_registry o
LEFT JOIN (
  SELECT
    operation_registry_id,
    COUNT(*) AS step_count,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_step_count,
    SUM(CASE WHEN status = 'shadow' THEN 1 ELSE 0 END) AS shadow_step_count
  FROM operation_step_registry
  GROUP BY operation_registry_id
) s ON s.operation_registry_id = o.id
LEFT JOIN (
  SELECT
    operation_registry_id,
    COUNT(*) AS binding_count,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_binding_count,
    SUM(CASE WHEN status = 'shadow' THEN 1 ELSE 0 END) AS shadow_binding_count
  FROM operation_execution_bindings
  GROUP BY operation_registry_id
) b ON b.operation_registry_id = o.id;
