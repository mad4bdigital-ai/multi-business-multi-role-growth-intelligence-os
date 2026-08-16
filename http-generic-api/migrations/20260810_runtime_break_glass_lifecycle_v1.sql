-- Spec 018 / Runtime Break-Glass Lifecycle D01-D06
--
-- Additive persistence contract only. This migration source does not authorize
-- or execute a Hostinger/local-runtime mutation. Applying it is a separate
-- governed migration action.
--
-- Reuse boundaries:
-- - capability_envelope_id binds approval/authority to the existing capability
--   resolution ledger instead of creating a parallel authorization primitive.
-- - release_gate_id / release_operation_id are nullable integration bindings;
--   this migration does not repurpose the existing Hostinger deploy gate as a
--   local-patch authority.
-- - runtime_policy_ready defaults to 0, so a persisted incident cannot become
--   mutation-eligible merely because the schema exists.
--
-- Safety attestations:
-- no_provider_call
-- no_credential_payload_read
-- no_external_send
-- no_external_write
-- no_hostinger_runtime_mutation
-- no_protected_branch_write
-- no_unrestricted_shell
-- migration_source_only
-- secrets_included_false

CREATE TABLE IF NOT EXISTS runtime_break_glass_incidents (
  break_glass_id CHAR(36) NOT NULL,
  incident_id VARCHAR(191) NOT NULL,
  target_id CHAR(36) NOT NULL,
  target_application_root VARCHAR(1024) NOT NULL,
  environment_key VARCHAR(64) NOT NULL DEFAULT 'production',
  lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'OPEN',
  approving_principal VARCHAR(191) NOT NULL,
  executing_principal VARCHAR(191) NOT NULL,
  capability_envelope_id CHAR(36) NOT NULL,
  release_gate_id CHAR(36) NULL,
  release_operation_id CHAR(36) NULL,
  expected_commit_sha CHAR(40) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  allowed_paths_json JSON NOT NULL,
  pre_change_hashes_json JSON NOT NULL,
  rollback_plan_json JSON NOT NULL,
  audit_correlation_json JSON NOT NULL,
  approved_scope_sha256 CHAR(64) NULL,
  post_change_hashes_json JSON NULL,
  post_change_readback_json JSON NULL,
  runtime_verification_run_id CHAR(36) NULL,
  runtime_verification_json JSON NULL,
  runtime_policy_ready TINYINT(1) NOT NULL DEFAULT 0,
  authorization_expires_at DATETIME(3) NOT NULL,
  approved_at DATETIME(3) NULL,
  local_patch_applied_at DATETIME(3) NULL,
  runtime_verified_at DATETIME(3) NULL,
  reconciliation_started_at DATETIME(3) NULL,
  rolled_back_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (break_glass_id),
  UNIQUE KEY uq_runtime_break_glass_incident (incident_id),
  UNIQUE KEY uq_runtime_break_glass_identity_pair (break_glass_id, incident_id),
  KEY idx_runtime_break_glass_target_state (target_id, lifecycle_state, authorization_expires_at),
  KEY idx_runtime_break_glass_envelope (capability_envelope_id),
  KEY idx_runtime_break_glass_release_gate (release_gate_id),
  KEY idx_runtime_break_glass_verification (runtime_verification_run_id),
  KEY idx_runtime_break_glass_approved_scope (approved_scope_sha256),
  KEY idx_runtime_break_glass_policy_ready (runtime_policy_ready, lifecycle_state, authorization_expires_at),
  CONSTRAINT chk_runtime_break_glass_incidents_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_break_glass_audit_events (
  break_glass_event_id CHAR(36) NOT NULL,
  break_glass_id CHAR(36) NOT NULL,
  incident_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  from_state VARCHAR(32) NULL,
  to_state VARCHAR(32) NOT NULL,
  actor VARCHAR(191) NOT NULL,
  evidence_json JSON NOT NULL,
  audit_correlation_json JSON NOT NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (break_glass_event_id),
  KEY idx_runtime_break_glass_audit_incident (break_glass_id, created_at),
  KEY idx_runtime_break_glass_audit_correlation (incident_id, created_at),
  CONSTRAINT fk_runtime_break_glass_audit_incident
    FOREIGN KEY (break_glass_id, incident_id) REFERENCES runtime_break_glass_incidents (break_glass_id, incident_id),
  CONSTRAINT chk_runtime_break_glass_audit_no_secrets CHECK (secrets_included = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
