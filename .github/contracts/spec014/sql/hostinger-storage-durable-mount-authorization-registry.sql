-- Spec 014 — Durable Mount Authorization Registry schema contract
-- CONTRACT-LOCAL DDL ONLY. This file is not part of the promoted runtime migration sequence.
-- It must not be applied without a separately reviewed migration candidate, checksum-bound
-- authorization, dry-run, typed confirmation, same-cycle readback, and signed verification.

CREATE TABLE IF NOT EXISTS storage_mount_authorization_records (
  id VARCHAR(64) NOT NULL,
  authorization_digest CHAR(64) NOT NULL,
  authorization_revision VARCHAR(128) NOT NULL,
  issuer_principal_id VARCHAR(191) NOT NULL,
  source_commit CHAR(64) NOT NULL,
  deployed_runtime_sha CHAR(64) NOT NULL,
  database_fingerprint CHAR(64) NOT NULL,
  schema_verification_digest CHAR(64) NOT NULL,
  readback_cycle_id VARCHAR(191) NOT NULL,
  authorization_bundle_hash CHAR(64) NOT NULL,
  target_id VARCHAR(191) NOT NULL,
  operation_id VARCHAR(191) NOT NULL,
  plan_id VARCHAR(191) NOT NULL,
  plan_hash CHAR(64) NOT NULL,
  execution_lease_id VARCHAR(191) NOT NULL,
  lease_generation BIGINT UNSIGNED NOT NULL,
  generation BIGINT UNSIGNED NOT NULL,
  expires_at_epoch BIGINT UNSIGNED NOT NULL,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  consumed_by_executor_id VARCHAR(191) NULL,
  mount_attempt_id VARCHAR(191) NULL,
  consumed_at_epoch BIGINT UNSIGNED NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_mount_authorization_digest (authorization_digest),
  UNIQUE KEY uq_storage_mount_authorization_operation_plan_generation
    (operation_id, plan_id, generation),
  KEY idx_storage_mount_authorization_expiry
    (consumed, expires_at_epoch),
  KEY idx_storage_mount_authorization_runtime
    (deployed_runtime_sha, database_fingerprint),
  KEY idx_storage_mount_authorization_lease
    (execution_lease_id, lease_generation),
  CONSTRAINT fk_storage_mount_authorization_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT fk_storage_mount_authorization_plan
    FOREIGN KEY (plan_id) REFERENCES storage_cleanup_plans(id),
  CONSTRAINT fk_storage_mount_authorization_lease
    FOREIGN KEY (execution_lease_id) REFERENCES storage_execution_leases(id),
  CONSTRAINT chk_storage_mount_authorization_digests
    CHECK (
      authorization_digest REGEXP '^[0-9a-f]{64}$'
      AND source_commit REGEXP '^[0-9a-f]{64}$'
      AND deployed_runtime_sha REGEXP '^[0-9a-f]{64}$'
      AND database_fingerprint REGEXP '^[0-9a-f]{64}$'
      AND schema_verification_digest REGEXP '^[0-9a-f]{64}$'
      AND authorization_bundle_hash REGEXP '^[0-9a-f]{64}$'
      AND plan_hash REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_mount_authorization_runtime_parity
    CHECK (source_commit = deployed_runtime_sha),
  CONSTRAINT chk_storage_mount_authorization_generation
    CHECK (generation >= 1 AND lease_generation >= 1 AND row_version >= 1),
  CONSTRAINT chk_storage_mount_authorization_consumed_state
    CHECK (
      (consumed = 0
        AND consumed_by_executor_id IS NULL
        AND mount_attempt_id IS NULL
        AND consumed_at_epoch IS NULL)
      OR
      (consumed = 1
        AND consumed_by_executor_id IS NOT NULL
        AND mount_attempt_id IS NOT NULL
        AND consumed_at_epoch IS NOT NULL)
    ),
  CONSTRAINT chk_storage_mount_authorization_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_mount_authorization_consumptions (
  id CHAR(36) NOT NULL,
  authorization_id VARCHAR(64) NOT NULL,
  authorization_digest CHAR(64) NOT NULL,
  executor_id VARCHAR(191) NOT NULL,
  mount_attempt_id VARCHAR(191) NOT NULL,
  operation_id VARCHAR(191) NOT NULL,
  plan_id VARCHAR(191) NOT NULL,
  registered_generation BIGINT UNSIGNED NOT NULL,
  consumed_generation BIGINT UNSIGNED NOT NULL,
  consumed_at_epoch BIGINT UNSIGNED NOT NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_mount_authorization_consumption_once (authorization_id),
  UNIQUE KEY uq_storage_mount_authorization_attempt_once (mount_attempt_id),
  KEY idx_storage_mount_authorization_consumption_operation
    (operation_id, consumed_at_epoch),
  KEY idx_storage_mount_authorization_consumption_plan
    (plan_id, consumed_at_epoch),
  CONSTRAINT fk_storage_mount_authorization_consumption_record
    FOREIGN KEY (authorization_id) REFERENCES storage_mount_authorization_records(id),
  CONSTRAINT fk_storage_mount_authorization_consumption_operation
    FOREIGN KEY (operation_id) REFERENCES storage_cleanup_operations(id),
  CONSTRAINT fk_storage_mount_authorization_consumption_plan
    FOREIGN KEY (plan_id) REFERENCES storage_cleanup_plans(id),
  CONSTRAINT chk_storage_mount_authorization_consumption_generation
    CHECK (registered_generation >= 1 AND consumed_generation = registered_generation + 1),
  CONSTRAINT chk_storage_mount_authorization_consumption_digests
    CHECK (
      authorization_digest REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_mount_authorization_consumption_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- expected_runtime_sha remains an authenticated field inside record_json and its record_digest.
-- Consumption receipts are append-only; no UPDATE or DELETE path is authorized.
-- The current authorization may transition exactly once from unconsumed generation N
-- to consumed generation N+1 before any mount execution is allowed to begin.
