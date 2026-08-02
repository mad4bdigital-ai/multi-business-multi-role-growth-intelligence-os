-- Sprint 69: tenant grants, tasks, approvals, and managed execution lifecycle foundation.
-- Additive/idempotent. Applying this migration requires separate governed authorization.
-- No provider calls, credential payload reads, external sends, deployment, or Production mutation.

CREATE TABLE IF NOT EXISTS managed_execution_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id VARCHAR(36) NOT NULL,
  run_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  parent_ticket_id VARCHAR(64) NOT NULL,
  task_ticket_id VARCHAR(64) NOT NULL,
  capability_key VARCHAR(191) NOT NULL,
  resource_type VARCHAR(128) NOT NULL,
  resource_ref VARCHAR(255) NOT NULL,
  effect_class ENUM('read_only','state_change','destructive','external_send','managed_operation') NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  authority_fingerprint_sha256 CHAR(64) NOT NULL,
  authority_snapshot_json JSON NOT NULL,
  lifecycle_state VARCHAR(64) NOT NULL,
  customer_status VARCHAR(64) NOT NULL,
  approval_hold_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_managed_execution_binding_id (binding_id),
  UNIQUE KEY uq_managed_execution_run_id (run_id),
  UNIQUE KEY uq_managed_execution_tenant_idempotency (tenant_id, idempotency_key),
  KEY idx_managed_execution_parent_ticket (tenant_id, parent_ticket_id, updated_at),
  KEY idx_managed_execution_task_ticket (tenant_id, task_ticket_id, updated_at),
  KEY idx_managed_execution_capability_resource (tenant_id, capability_key, resource_type, resource_ref),
  KEY idx_managed_execution_lifecycle (tenant_id, lifecycle_state, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS managed_execution_step_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id VARCHAR(36) NOT NULL,
  run_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  step_run_id VARCHAR(36) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  step_key VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_managed_execution_step_request_id (request_id),
  UNIQUE KEY uq_managed_execution_step_run_id (step_run_id),
  UNIQUE KEY uq_managed_execution_step_idempotency (run_id, idempotency_key),
  KEY idx_managed_execution_step_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS managed_execution_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(36) NOT NULL,
  binding_id VARCHAR(36) NOT NULL,
  run_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(96) NOT NULL,
  from_state VARCHAR(64) NULL,
  to_state VARCHAR(64) NULL,
  actor_id VARCHAR(64) NULL,
  evidence_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_managed_execution_event_id (event_id),
  KEY idx_managed_execution_events_binding (binding_id, created_at),
  KEY idx_managed_execution_events_run (run_id, created_at),
  KEY idx_managed_execution_events_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_managed_execution_lifecycle_readiness AS
SELECT
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('managed_execution_bindings', 'managed_execution_step_requests', 'managed_execution_events')) AS present_table_count,
  3 AS required_table_count,
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'managed_execution_bindings'
      AND COLUMN_NAME IN (
        'binding_id', 'run_id', 'tenant_id', 'parent_ticket_id', 'task_ticket_id',
        'capability_key', 'resource_type', 'resource_ref', 'effect_class', 'idempotency_key',
        'authority_fingerprint_sha256', 'authority_snapshot_json', 'lifecycle_state',
        'customer_status', 'approval_hold_id'
      )) AS present_binding_column_count,
  15 AS required_binding_column_count,
  CASE
    WHEN (SELECT COUNT(*)
            FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME IN ('managed_execution_bindings', 'managed_execution_step_requests', 'managed_execution_events')) = 3
     AND (SELECT COUNT(*)
            FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'managed_execution_bindings'
             AND COLUMN_NAME IN (
               'binding_id', 'run_id', 'tenant_id', 'parent_ticket_id', 'task_ticket_id',
               'capability_key', 'resource_type', 'resource_ref', 'effect_class', 'idempotency_key',
               'authority_fingerprint_sha256', 'authority_snapshot_json', 'lifecycle_state',
               'customer_status', 'approval_hold_id'
             )) = 15
    THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status,
  NOW() AS checked_at;
