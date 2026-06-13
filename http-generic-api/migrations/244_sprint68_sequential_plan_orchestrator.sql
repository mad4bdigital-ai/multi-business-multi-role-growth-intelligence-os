-- Sprint 68: Sequential plan orchestrator foundation
-- Adds durable compiled plan steps and append-only plan events.
-- Additive and idempotent. Does not widen provider execution authority.

ALTER TABLE execution_plans
  ADD COLUMN IF NOT EXISTS runtime_status VARCHAR(64) NULL AFTER plan_status;

CREATE TABLE IF NOT EXISTS execution_plan_steps (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_step_id VARCHAR(36) NOT NULL,
  plan_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  step_order INT UNSIGNED NOT NULL,
  step_key VARCHAR(191) NOT NULL,
  step_type ENUM('workflow','analysis','checkpoint','approval','stop') NOT NULL DEFAULT 'workflow',
  workflow_id VARCHAR(36) NULL,
  workflow_key VARCHAR(191) NULL,
  depends_on_json JSON NOT NULL,
  input_json JSON NOT NULL,
  success_criteria_json JSON NOT NULL,
  retry_policy_json JSON NOT NULL,
  approval_policy_json JSON NOT NULL,
  status ENUM(
    'pending','ready','claimed','running','verifying','awaiting_approval',
    'blocked','retrying','completed','failed','skipped','cancelled'
  ) NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 1,
  idempotency_key VARCHAR(191) NOT NULL,
  claim_token VARCHAR(64) NULL,
  claimed_at DATETIME NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  output_json JSON NULL,
  error_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_execution_plan_step_id (plan_step_id),
  UNIQUE KEY uq_execution_plan_step_key (plan_id, step_key),
  UNIQUE KEY uq_execution_plan_step_idempotency (plan_id, idempotency_key),
  KEY idx_execution_plan_step_next (plan_id, status, step_order),
  KEY idx_execution_plan_step_claim (claim_token, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS execution_plan_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan_event_id VARCHAR(36) NOT NULL,
  plan_id VARCHAR(36) NOT NULL,
  plan_step_id VARCHAR(36) NULL,
  tenant_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  from_status VARCHAR(64) NULL,
  to_status VARCHAR(64) NULL,
  actor_id VARCHAR(191) NULL,
  evidence_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_execution_plan_event_id (plan_event_id),
  KEY idx_execution_plan_events_timeline (plan_id, id),
  KEY idx_execution_plan_events_step (plan_step_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO database_table_lifecycle_registry
  (table_name, table_family, owner_engine_key, owner_workflow_key, authority_model, usage_status,
   write_strategy, retention_class, retention_days, archive_strategy, cleanup_strategy,
   growth_policy, linked_by_code, linked_by_policy, linked_by_foreign_key, risk_level, status, notes)
VALUES
  ('execution_plan_steps', 'sequential_plan_orchestration', 'workflow_runtime_engine', NULL,
   'canonical', 'runtime_canonical', 'platform_primary', 'business_record', NULL,
   'archive_terminal_plan_steps', 'retain_plan_step_lineage', 'monitor_pending_and_blocked_steps',
   1, 1, 0, 'high', 'active', 'Compiled executable plan steps with dependency and idempotency authority.'),
  ('execution_plan_events', 'sequential_plan_orchestration', 'workflow_runtime_engine', NULL,
   'append_only', 'runtime_audit', 'append_only', 'audit', 365,
   'archive_after_retention', 'none', 'monitor_event_volume',
   1, 1, 0, 'medium', 'active', 'Append-only sequential plan transition and checkpoint evidence.')
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
