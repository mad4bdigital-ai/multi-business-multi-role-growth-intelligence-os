-- Spec 011 Phase 1: durable execution control and generic mutation receipts
-- Additive and idempotent. No provider authority, credentials, or production apply is granted.

CREATE TABLE IF NOT EXISTS execution_plan_mutation_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt_id CHAR(36) NOT NULL,
  plan_id VARCHAR(36) NOT NULL,
  plan_step_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  idempotency_key VARCHAR(191) NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  dispatch_status ENUM('pending','succeeded','failed_pre_dispatch','unknown_outcome','reconciled') NOT NULL DEFAULT 'pending',
  provider_status INT NULL,
  provider_receipt_json LONGTEXT NULL,
  readback_json LONGTEXT NULL,
  recovered_from_transport TINYINT(1) NOT NULL DEFAULT 0,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_execution_plan_mutation_receipt_id (receipt_id),
  UNIQUE KEY uq_execution_plan_mutation_receipt_request (plan_step_id, request_sha256),
  KEY idx_execution_plan_mutation_receipt_plan (plan_id, updated_at),
  KEY idx_execution_plan_mutation_receipt_tenant (tenant_id, updated_at),
  KEY idx_execution_plan_mutation_receipt_status (dispatch_status, updated_at),
  CONSTRAINT chk_execution_plan_mutation_receipts_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO database_table_lifecycle_registry
  (table_name, table_family, owner_engine_key, owner_workflow_key, authority_model, usage_status,
   write_strategy, retention_class, retention_days, archive_strategy, cleanup_strategy,
   growth_policy, linked_by_code, linked_by_policy, linked_by_foreign_key, risk_level, status, notes)
VALUES
  ('execution_plan_mutation_receipts', 'sequential_plan_orchestration', 'workflow_runtime_engine', NULL,
   'append_only_receipt', 'runtime_canonical', 'platform_primary', 'audit', 365,
   'archive_after_retention', 'retain_unknown_outcome_until_reconciled', 'monitor_pending_and_unknown_receipts',
   1, 1, 0, 'high', 'active',
   'Generic pending mutation receipt for durable execution steps. A pending or unknown outcome blocks retry until governed readback reconciliation.')
ON DUPLICATE KEY UPDATE
  table_family=VALUES(table_family),
  owner_engine_key=VALUES(owner_engine_key),
  authority_model=VALUES(authority_model),
  usage_status=VALUES(usage_status),
  write_strategy=VALUES(write_strategy),
  retention_class=VALUES(retention_class),
  retention_days=VALUES(retention_days),
  archive_strategy=VALUES(archive_strategy),
  cleanup_strategy=VALUES(cleanup_strategy),
  growth_policy=VALUES(growth_policy),
  linked_by_code=VALUES(linked_by_code),
  linked_by_policy=VALUES(linked_by_policy),
  linked_by_foreign_key=VALUES(linked_by_foreign_key),
  risk_level=VALUES(risk_level),
  status=VALUES(status),
  notes=VALUES(notes);
