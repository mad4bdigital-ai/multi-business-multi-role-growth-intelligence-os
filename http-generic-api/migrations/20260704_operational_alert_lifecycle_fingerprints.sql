-- Spec 007 / PR5 foundation: operational alert operation/resource fingerprints and lifecycle ledger.
-- Additive only. No provider calls, no external sends, no alert execution, no secrets.
-- Runtime write cutover is intentionally separate and must require same-cycle readback.

ALTER TABLE operational_alerts
  ADD COLUMN IF NOT EXISTS operation_fingerprint_sha256 CHAR(64) NULL AFTER fingerprint_sha256,
  ADD COLUMN IF NOT EXISTS resource_fingerprint_sha256 CHAR(64) NULL AFTER operation_fingerprint_sha256,
  ADD COLUMN IF NOT EXISTS lifecycle_revision BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER lifecycle_status,
  ADD INDEX IF NOT EXISTS idx_operational_alert_operation_resource (operation_fingerprint_sha256, resource_fingerprint_sha256, lifecycle_status),
  ADD INDEX IF NOT EXISTS idx_operational_alert_lifecycle_revision (alert_id, lifecycle_revision);

CREATE TABLE IF NOT EXISTS operational_alert_lifecycle_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(36) NOT NULL UNIQUE,
  alert_id VARCHAR(36) NOT NULL,
  alert_key VARCHAR(191) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  source_type VARCHAR(128) NULL,
  source_record_id VARCHAR(191) NULL,
  from_status ENUM('open','acknowledged','investigating','resolved','ignored') NULL,
  to_status ENUM('open','acknowledged','investigating','resolved','ignored') NOT NULL,
  lifecycle_revision BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(128) NOT NULL,
  actor_id VARCHAR(191) NULL,
  actor_type VARCHAR(64) NOT NULL DEFAULT 'platform_admin',
  note TEXT NULL,
  idempotency_key VARCHAR(191) NULL,
  operation_fingerprint_sha256 CHAR(64) NULL,
  resource_fingerprint_sha256 CHAR(64) NULL,
  evidence_json JSON NULL,
  sync_run_id VARCHAR(36) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_operational_alert_lifecycle_event_idempotency (alert_id, idempotency_key),
  INDEX idx_operational_alert_lifecycle_event_alert (alert_id, lifecycle_revision, created_at),
  INDEX idx_operational_alert_lifecycle_event_status (to_status, created_at),
  INDEX idx_operational_alert_lifecycle_event_operation_resource (operation_fingerprint_sha256, resource_fingerprint_sha256, created_at),
  CONSTRAINT fk_operational_alert_lifecycle_event_alert FOREIGN KEY (alert_id) REFERENCES operational_alerts(alert_id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE operational_alert_rule_registry
   SET condition_key = 'execution_status=failed AND no later success for the same operation and resource fingerprints',
       updated_at = CURRENT_TIMESTAMP
 WHERE rule_key = 'alert_execution_failed'
   AND source_type = 'execution_log'
   AND status = 'active';
