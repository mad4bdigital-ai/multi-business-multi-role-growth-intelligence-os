-- Spec 011 T302: immutable operation run revision pinning.
--
-- Additive schema only. This migration does not execute an operation, resolve
-- credentials, call a provider, activate runtime behavior, or mutate a prior pin.

CREATE TABLE IF NOT EXISTS operation_run_revision_pins (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pin_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  operation_registry_id BIGINT UNSIGNED NOT NULL,
  manifest_id CHAR(36) NOT NULL,
  operation_key VARCHAR(191) NOT NULL,
  operation_version INT UNSIGNED NOT NULL,
  scope_fingerprint CHAR(64) NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  source_revision_hash CHAR(64) NOT NULL,
  resource_fingerprint CHAR(64) NOT NULL,
  input_sha256 CHAR(64) NOT NULL,
  idempotency_key_sha256 CHAR(64) NOT NULL,
  requested_by VARCHAR(191) NOT NULL,
  revision_bundle_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_run_revision_pins_pin_id (pin_id),
  UNIQUE KEY uq_operation_run_revision_pins_run_id (run_id),
  KEY idx_operation_run_revision_pins_operation (operation_registry_id, manifest_id),
  KEY idx_operation_run_revision_pins_bundle (revision_bundle_hash),
  KEY idx_operation_run_revision_pins_created (created_at),
  CONSTRAINT fk_operation_run_revision_pins_run
    FOREIGN KEY (run_id) REFERENCES operation_run_ownership (run_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_operation_run_revision_pins_operation
    FOREIGN KEY (operation_registry_id) REFERENCES operation_registry (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_operation_run_revision_pins_manifest
    FOREIGN KEY (manifest_id) REFERENCES operation_compiled_manifests (manifest_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable operation run pins to one contract and compiled manifest revision bundle.';

CREATE TABLE IF NOT EXISTS operation_run_revision_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id CHAR(36) NOT NULL,
  revision_type ENUM('contract','step','binding','policy','schema') NOT NULL,
  revision_key VARCHAR(191) NOT NULL,
  revision_order INT UNSIGNED NOT NULL DEFAULT 0,
  revision_hash CHAR(64) NOT NULL,
  snapshot_json JSON NOT NULL COMMENT 'Immutable non-secret canonical revision snapshot.',
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_operation_run_revision_items_identity (run_id, revision_type, revision_key),
  KEY idx_operation_run_revision_items_order (run_id, revision_type, revision_order, revision_key),
  KEY idx_operation_run_revision_items_hash (revision_hash),
  CONSTRAINT fk_operation_run_revision_items_run
    FOREIGN KEY (run_id) REFERENCES operation_run_revision_pins (run_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable contract, step, binding, policy, and schema snapshots pinned to one operation run.';
