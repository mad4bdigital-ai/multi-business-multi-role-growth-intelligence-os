-- Spec 011 T305: additive durable operation lifecycle state and immutable events.
-- Contract only. Adding this file does not apply the migration or activate runtime behavior.

CREATE TABLE IF NOT EXISTS operation_run_lifecycle_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lifecycle_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  state_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  lifecycle_status VARCHAR(32) NOT NULL,
  approval_status VARCHAR(32) NOT NULL DEFAULT 'not_required',
  resume_from_step_key VARCHAR(96) NULL,
  checkpoint_sha256 CHAR(64) NULL,
  revision_bundle_hash CHAR(64) NOT NULL,
  resource_fingerprint CHAR(64) NOT NULL,
  callback_id VARCHAR(191) NULL,
  callback_payload_sha256 CHAR(64) NULL,
  cancellation_requested_at TIMESTAMP(6) NULL,
  cancelled_at TIMESTAMP(6) NULL,
  recovery_classification VARCHAR(64) NULL,
  last_event_id CHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_run_lifecycle_state_lifecycle_id (lifecycle_id),
  UNIQUE KEY uq_operation_run_lifecycle_state_run_id (run_id),
  KEY idx_operation_run_lifecycle_state_status (lifecycle_status, updated_at),
  KEY idx_operation_run_lifecycle_state_revision (run_id, state_revision),
  KEY idx_operation_run_lifecycle_state_callback (callback_id),
  CONSTRAINT fk_operation_run_lifecycle_state_run
    FOREIGN KEY (run_id) REFERENCES repository_automation_runs (run_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Optimistically versioned durable lifecycle state for governed operation runs.';

CREATE TABLE IF NOT EXISTS operation_run_lifecycle_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  state_revision BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_key VARCHAR(191) NOT NULL,
  actor_key VARCHAR(191) NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  payload_json JSON NOT NULL COMMENT 'Canonical non-secret lifecycle event payload.',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_run_lifecycle_events_event_id (event_id),
  UNIQUE KEY uq_operation_run_lifecycle_events_key (run_id, event_key),
  UNIQUE KEY uq_operation_run_lifecycle_events_revision (run_id, state_revision),
  KEY idx_operation_run_lifecycle_events_cursor (run_id, id),
  KEY idx_operation_run_lifecycle_events_type (run_id, event_type, created_at),
  KEY idx_operation_run_lifecycle_events_payload (payload_sha256),
  CONSTRAINT fk_operation_run_lifecycle_events_run
    FOREIGN KEY (run_id) REFERENCES operation_run_lifecycle_state (run_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable approval, callback, cancellation, resume, recovery, and checkpoint events.';
