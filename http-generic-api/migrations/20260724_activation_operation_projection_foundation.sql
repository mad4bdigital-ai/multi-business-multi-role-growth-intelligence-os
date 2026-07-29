-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Spec 012 Implementation PR-2 foundation.
-- Additive schema only. This artifact is not runtime-wired and is not authorized for apply by this PR.

CREATE TABLE IF NOT EXISTS activation_operation_projections (
  operation_id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(128) NULL,
  workspace_id VARCHAR(128) NULL,
  subject_fingerprint_sha256 CHAR(64) NOT NULL,
  operation_fingerprint_sha256 CHAR(64) NOT NULL,
  idempotency_key_sha256 CHAR(64) NULL,
  protected_resource VARCHAR(500) NOT NULL,
  oauth_client_id VARCHAR(191) NULL,
  purpose VARCHAR(80) NOT NULL DEFAULT 'tenant_activation',
  activation_mode ENUM('managed','dedicated','hybrid') NOT NULL DEFAULT 'managed',
  current_stage VARCHAR(80) NOT NULL DEFAULT 'accepted',
  operation_status VARCHAR(64) NOT NULL DEFAULT 'accepted',
  workflow_run_id VARCHAR(36) NULL,
  optimistic_version BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_activation_operation_fingerprint (tenant_id, operation_fingerprint_sha256),
  UNIQUE KEY uq_activation_operation_idempotency (tenant_id, subject_fingerprint_sha256, idempotency_key_sha256),
  INDEX idx_activation_operation_subject (tenant_id, user_id, workspace_id, updated_at),
  INDEX idx_activation_operation_state (operation_status, current_stage, updated_at),
  INDEX idx_activation_operation_workflow (workflow_run_id),
  CONSTRAINT fk_activation_operation_run
    FOREIGN KEY (operation_id) REFERENCES activation_runs(run_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS activation_stage_attempts (
  attempt_id VARCHAR(36) NOT NULL PRIMARY KEY,
  operation_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  stage_key VARCHAR(80) NOT NULL,
  attempt_number INT UNSIGNED NOT NULL,
  source_type VARCHAR(64) NOT NULL DEFAULT 'platform_native',
  attempt_status VARCHAR(64) NOT NULL DEFAULT 'started',
  retryable TINYINT(1) NOT NULL DEFAULT 0,
  unknown_outcome TINYINT(1) NOT NULL DEFAULT 0,
  error_code VARCHAR(160) NULL,
  error_message VARCHAR(1000) NULL,
  evidence_ref VARCHAR(500) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_activation_stage_attempt (operation_id, stage_key, attempt_number),
  INDEX idx_activation_stage_attempt_subject (tenant_id, operation_id, started_at),
  INDEX idx_activation_stage_attempt_status (attempt_status, unknown_outcome, started_at),
  CONSTRAINT fk_activation_stage_attempt_operation
    FOREIGN KEY (operation_id) REFERENCES activation_operation_projections(operation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS activation_evidence_items (
  evidence_id VARCHAR(36) NOT NULL PRIMARY KEY,
  operation_id VARCHAR(36) NOT NULL,
  attempt_id VARCHAR(36) NULL,
  tenant_id VARCHAR(36) NOT NULL,
  evidence_type VARCHAR(80) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_ref VARCHAR(500) NULL,
  evidence_sha256 CHAR(64) NOT NULL,
  summary_json JSON NULL,
  summary_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  redaction_state ENUM('sanitized','reference_only','rejected') NOT NULL DEFAULT 'sanitized',
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  captured_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_activation_evidence_dedupe (operation_id, evidence_type, evidence_sha256),
  INDEX idx_activation_evidence_subject (tenant_id, operation_id, captured_at),
  INDEX idx_activation_evidence_attempt (attempt_id, captured_at),
  CONSTRAINT chk_activation_evidence_no_secrets CHECK (secrets_included = 0),
  CONSTRAINT fk_activation_evidence_operation
    FOREIGN KEY (operation_id) REFERENCES activation_operation_projections(operation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_activation_evidence_attempt
    FOREIGN KEY (attempt_id) REFERENCES activation_stage_attempts(attempt_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS activation_deliveries (
  delivery_id VARCHAR(36) NOT NULL PRIMARY KEY,
  operation_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  channel_key VARCHAR(64) NOT NULL,
  delivery_attempt_number INT UNSIGNED NOT NULL,
  delivery_status VARCHAR(64) NOT NULL DEFAULT 'prepared',
  payload_sha256 CHAR(64) NULL,
  response_status_code INT NULL,
  error_code VARCHAR(160) NULL,
  error_message VARCHAR(1000) NULL,
  delivered_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_activation_delivery_attempt (operation_id, channel_key, delivery_attempt_number),
  INDEX idx_activation_delivery_subject (tenant_id, operation_id, created_at),
  INDEX idx_activation_delivery_status (delivery_status, created_at),
  CONSTRAINT fk_activation_delivery_operation
    FOREIGN KEY (operation_id) REFERENCES activation_operation_projections(operation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS activation_acknowledgements (
  acknowledgement_id VARCHAR(36) NOT NULL PRIMARY KEY,
  operation_id VARCHAR(36) NOT NULL,
  delivery_id VARCHAR(36) NULL,
  tenant_id VARCHAR(36) NOT NULL,
  actor_type VARCHAR(64) NOT NULL,
  actor_ref_sha256 CHAR(64) NOT NULL,
  acknowledgement_key_sha256 CHAR(64) NOT NULL,
  acknowledgement_state VARCHAR(64) NOT NULL,
  acknowledgement_reason VARCHAR(1000) NULL,
  acknowledged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_activation_acknowledgement_key (operation_id, acknowledgement_key_sha256),
  INDEX idx_activation_ack_subject (tenant_id, operation_id, acknowledged_at),
  INDEX idx_activation_ack_delivery (delivery_id, acknowledged_at),
  CONSTRAINT fk_activation_ack_operation
    FOREIGN KEY (operation_id) REFERENCES activation_operation_projections(operation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_activation_ack_delivery
    FOREIGN KEY (delivery_id) REFERENCES activation_deliveries(delivery_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS activation_reconciliation_attempts (
  reconciliation_id VARCHAR(36) NOT NULL PRIMARY KEY,
  operation_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NOT NULL,
  attempt_number INT UNSIGNED NOT NULL,
  reason_code VARCHAR(160) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  reconciliation_status VARCHAR(64) NOT NULL DEFAULT 'pending',
  outcome_code VARCHAR(160) NULL,
  evidence_ref VARCHAR(500) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_activation_reconciliation_attempt (operation_id, attempt_number),
  INDEX idx_activation_reconciliation_subject (tenant_id, operation_id, started_at),
  INDEX idx_activation_reconciliation_status (reconciliation_status, started_at),
  CONSTRAINT fk_activation_reconciliation_operation
    FOREIGN KEY (operation_id) REFERENCES activation_operation_projections(operation_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
