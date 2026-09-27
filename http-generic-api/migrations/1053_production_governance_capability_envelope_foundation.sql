-- Production Governance Foundation Bootstrap — split-topology successor to Migration 225.
-- This migration owns only the Governance DB table required to issue and persist
-- capability-resolution envelopes. Runtime-owned policy/tool rows from Migration 225
-- intentionally remain outside this migration and must keep their own provenance.
-- Additive and idempotent: no DROP, DELETE, ALTER, GRANT, provider call, or secret value.

CREATE TABLE IF NOT EXISTS capability_resolution_envelope_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  envelope_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  workspace_id VARCHAR(64) NULL,
  workspace_key VARCHAR(191) NULL,
  brand_key VARCHAR(191) NULL,
  app_key VARCHAR(128) NULL,
  capability_key VARCHAR(191) NULL,
  operation_intent VARCHAR(128) NULL,
  risk_class VARCHAR(64) NULL,
  selected_source_tier VARCHAR(96) NULL,
  selected_runtime_surface VARCHAR(128) NULL,
  authority_status VARCHAR(64) NULL,
  decision VARCHAR(96) NULL,
  envelope_status ENUM('dry_run','ready_for_dispatch','ready_requires_approval','blocked','superseded','expired') NOT NULL DEFAULT 'dry_run',
  dispatch_allowed TINYINT(1) NOT NULL DEFAULT 0,
  apply_allowed TINYINT(1) NOT NULL DEFAULT 0,
  approval_required TINYINT(1) NOT NULL DEFAULT 0,
  quota_required TINYINT(1) NOT NULL DEFAULT 0,
  audit_required TINYINT(1) NOT NULL DEFAULT 1,
  readback_required TINYINT(1) NOT NULL DEFAULT 0,
  blocking_gap_count INT UNSIGNED NOT NULL DEFAULT 0,
  envelope_sha256 CHAR(64) NOT NULL,
  envelope_json JSON NOT NULL,
  requested_by VARCHAR(191) NULL,
  execution_ref VARCHAR(191) NULL,
  execution_status ENUM('not_executed','referenced','executed','failed','cancelled') NOT NULL DEFAULT 'not_executed',
  expires_at DATETIME NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_capability_resolution_envelope_id (envelope_id),
  KEY idx_capability_resolution_envelope_tenant (tenant_id, created_at),
  KEY idx_capability_resolution_envelope_app (app_key, operation_intent, created_at),
  KEY idx_capability_resolution_envelope_status (envelope_status, expires_at),
  KEY idx_capability_resolution_envelope_decision (decision, created_at),
  CONSTRAINT chk_capability_resolution_envelope_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
