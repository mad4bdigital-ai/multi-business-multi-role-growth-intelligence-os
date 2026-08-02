-- Spec 014 contract-local DDL only.
-- This file is not a promoted migration and must not be applied without separate authorization.

CREATE TABLE storage_mount_injection_states (
  id VARCHAR(191) NOT NULL,
  mount_bundle_digest CHAR(64) NOT NULL,
  injection_receipt_digest CHAR(64) NOT NULL,
  mount_readback_digest CHAR(64) NOT NULL,
  rollback_receipt_digest CHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  generation BIGINT UNSIGNED NOT NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_mount_injection_states_readback (mount_readback_digest),
  KEY idx_storage_mount_injection_states_active (active, status),
  CONSTRAINT chk_storage_mount_injection_states_status
    CHECK (status IN ('readback_verified', 'rolled_back')),
  CONSTRAINT chk_storage_mount_injection_states_active
    CHECK ((status = 'readback_verified' AND active = 1 AND rollback_receipt_digest IS NULL)
      OR (status = 'rolled_back' AND active = 0 AND rollback_receipt_digest IS NOT NULL)),
  CONSTRAINT chk_storage_mount_injection_states_generation
    CHECK ((status = 'readback_verified' AND generation = 1)
      OR (status = 'rolled_back' AND generation = 2)),
  CONSTRAINT chk_storage_mount_injection_states_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB;

CREATE TABLE storage_mount_injection_events (
  id CHAR(36) NOT NULL,
  injection_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(32) NOT NULL,
  state_generation BIGINT UNSIGNED NOT NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_mount_injection_events_lifecycle
    (injection_id, event_type, state_generation),
  KEY idx_storage_mount_injection_events_injection
    (injection_id, state_generation),
  CONSTRAINT chk_storage_mount_injection_events_type
    CHECK (event_type IN ('readback_verified', 'rolled_back')),
  CONSTRAINT chk_storage_mount_injection_events_generation
    CHECK ((event_type = 'readback_verified' AND state_generation = 1)
      OR (event_type = 'rolled_back' AND state_generation = 2)),
  CONSTRAINT chk_storage_mount_injection_events_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB;
