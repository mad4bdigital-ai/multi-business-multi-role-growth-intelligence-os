-- Spec 014: Governed Hostinger Storage Orchestration — Wave 4 Durable Authorized Injection State
-- Repository migration candidate only. Not promoted into the governed runtime sequence.
-- Depends on 20260802_03_spec014_hostinger_storage_execution_evidence.sql
-- dependency checksum cf484d413399bbd3a0ea9ff36155ceb8b369e1bd43c63c300a93a179e0a57096.
-- Requires a separate promotion PR, fresh checksum-bound authorization, same-cycle dry-run,
-- typed confirmation, Apply ledger, exact live readback, and signed schema verification.
-- No Hostinger/SSH credential access, provider dispatch, deployment, or Production authority.

CREATE TABLE IF NOT EXISTS storage_authorized_injection_states (
  injection_id VARCHAR(191) NOT NULL,
  injection_receipt_digest CHAR(64) NOT NULL,
  mount_readback_digest CHAR(64) NOT NULL,
  mount_bundle_digest CHAR(64) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  generation BIGINT UNSIGNED NOT NULL DEFAULT 1,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  row_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (injection_id),
  UNIQUE KEY uq_storage_authorized_injection_receipt (injection_receipt_digest),
  UNIQUE KEY uq_storage_authorized_injection_readback (mount_readback_digest),
  KEY idx_storage_authorized_injection_bundle (mount_bundle_digest),
  KEY idx_storage_authorized_injection_active_generation (active, generation),
  CONSTRAINT chk_storage_authorized_injection_state_digests
    CHECK (
      injection_receipt_digest REGEXP '^[0-9a-f]{64}$'
      AND mount_readback_digest REGEXP '^[0-9a-f]{64}$'
      AND mount_bundle_digest REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_authorized_injection_state_version
    CHECK (generation >= 1 AND row_version >= 1),
  CONSTRAINT chk_storage_authorized_injection_state_active
    CHECK (active IN (0, 1)),
  CONSTRAINT chk_storage_authorized_injection_state_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS storage_authorized_injection_rollbacks (
  id CHAR(36) NOT NULL,
  injection_id VARCHAR(191) NOT NULL,
  rollback_receipt_digest CHAR(64) NOT NULL,
  record_digest CHAR(64) NOT NULL,
  record_json JSON NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_storage_authorized_injection_rollback_once (injection_id),
  UNIQUE KEY uq_storage_authorized_injection_rollback_digest (rollback_receipt_digest),
  CONSTRAINT fk_storage_authorized_injection_rollback_state
    FOREIGN KEY (injection_id)
    REFERENCES storage_authorized_injection_states(injection_id),
  CONSTRAINT chk_storage_authorized_injection_rollback_digests
    CHECK (
      rollback_receipt_digest REGEXP '^[0-9a-f]{64}$'
      AND record_digest REGEXP '^[0-9a-f]{64}$'
    ),
  CONSTRAINT chk_storage_authorized_injection_rollback_no_secrets
    CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The canonical registry owns the only write path for these tables.
-- Active state registration is data-only and may replay only with exact evidence parity.
-- Rollback updates the state through active + row_version compare-and-swap, increments
-- the SQL generation and row_version, and inserts one immutable rollback receipt.
-- No UPDATE or DELETE path is authorized for storage_authorized_injection_rollbacks.
-- This contract grants no migration Apply, provider dispatch, deployment, or Production authority.
