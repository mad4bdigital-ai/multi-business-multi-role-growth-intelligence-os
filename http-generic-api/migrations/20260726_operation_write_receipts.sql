-- Spec 011 T306: additive operation-level idempotency receipts for governed writes.
-- Contract only. Adding this file does not apply the migration, dispatch a write,
-- call a provider, read credentials, or activate runtime behavior.

CREATE TABLE IF NOT EXISTS operation_write_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  step_key VARCHAR(96) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  request_sha256 CHAR(64) NOT NULL,
  revision_bundle_hash CHAR(64) NOT NULL,
  resource_fingerprint CHAR(64) NOT NULL,
  state_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  receipt_status VARCHAR(32) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_id CHAR(36) NULL,
  dispatch_result_sha256 CHAR(64) NULL,
  readback_sha256 CHAR(64) NULL,
  result_sha256 CHAR(64) NULL,
  same_cycle_readback_verified TINYINT(1) NOT NULL DEFAULT 0,
  dispatch_succeeded TINYINT(1) NOT NULL DEFAULT 0,
  write_observed TINYINT(1) NOT NULL DEFAULT 0,
  recovery_required TINYINT(1) NOT NULL DEFAULT 0,
  last_error_code VARCHAR(128) NULL,
  reserved_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  dispatch_started_at TIMESTAMP(6) NULL,
  dispatch_completed_at TIMESTAMP(6) NULL,
  readback_verified_at TIMESTAMP(6) NULL,
  completed_at TIMESTAMP(6) NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_write_receipts_receipt_id (receipt_id),
  UNIQUE KEY uq_operation_write_receipts_idempotency (run_id, step_key, idempotency_key_sha256),
  KEY idx_operation_write_receipts_status (receipt_status, updated_at),
  KEY idx_operation_write_receipts_run_revision (run_id, state_revision),
  KEY idx_operation_write_receipts_recovery (recovery_required, updated_at),
  CONSTRAINT fk_operation_write_receipts_run
    FOREIGN KEY (run_id) REFERENCES operation_run_revision_pins (run_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Reserved and finalized non-secret idempotency receipts for governed operation writes.';
