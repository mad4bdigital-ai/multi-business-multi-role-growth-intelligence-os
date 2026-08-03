-- Spec 014 — Durable Tenant One-shot Enablement Registry schema contract
-- CONTRACT-LOCAL DDL ONLY. This file is not part of the promoted runtime migration sequence.
-- It must not be applied without a separately reviewed migration candidate, checksum-bound
-- authorization, dry-run, typed confirmation, same-cycle readback, and signed verification.

CREATE TABLE IF NOT EXISTS storage_tenant_enablement_records (
  id CHAR(36) NOT NULL,
  authorization_digest CHAR(64) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  generation BIGINT UNSIGNED NOT NULL,
  expires_at_epoch BIGINT UNSIGNED NOT NULL,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  consumed_by_run_id CHAR(36) NULL,
  consumed_at_epoch BIGINT UNSIGNED NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_tenant_enablement_operation_run
    (operation_id, run_id),
  KEY idx_storage_tenant_enablement_expiry
    (consumed, expires_at_epoch),
  KEY idx_storage_tenant_enablement_authorization
    (authorization_digest, consumed),
  CONSTRAINT fk_storage_tenant_enablement_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT chk_storage_tenant_enablement_digests
    CHECK (
      authorization_digest REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_tenant_enablement_generation
    CHECK (generation >= 1 AND row_version >= 1),
  CONSTRAINT chk_storage_tenant_enablement_consumed_state
    CHECK (
      (consumed = 0 AND consumed_by_run_id IS NULL AND consumed_at_epoch IS NULL)
      OR (consumed = 1 AND consumed_by_run_id = run_id AND consumed_at_epoch IS NOT NULL)
    ),
  CONSTRAINT chk_storage_tenant_enablement_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_tenant_enablement_consumptions (
  id CHAR(36) NOT NULL,
  enablement_id CHAR(36) NOT NULL,
  authorization_digest CHAR(64) NOT NULL,
  operation_id CHAR(36) NOT NULL,
  run_id CHAR(36) NOT NULL,
  registered_generation BIGINT UNSIGNED NOT NULL,
  consumed_generation BIGINT UNSIGNED NOT NULL,
  consumed_at_epoch BIGINT UNSIGNED NOT NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_tenant_enablement_consumption_once (enablement_id),
  UNIQUE KEY uq_storage_tenant_enablement_consumption_operation_run
    (operation_id, run_id),
  KEY idx_storage_tenant_enablement_consumption_authorization
    (authorization_digest, consumed_at_epoch),
  CONSTRAINT fk_storage_tenant_enablement_consumption_record
    FOREIGN KEY (enablement_id) REFERENCES storage_tenant_enablement_records(id),
  CONSTRAINT fk_storage_tenant_enablement_consumption_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT chk_storage_tenant_enablement_consumption_generation
    CHECK (registered_generation >= 1 AND consumed_generation = registered_generation + 1),
  CONSTRAINT chk_storage_tenant_enablement_consumption_digests
    CHECK (
      authorization_digest REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_tenant_enablement_consumption_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consumption receipts are append-only; no UPDATE or DELETE path is authorized.
-- The current record may transition exactly once from unconsumed generation N to consumed generation N+1.
