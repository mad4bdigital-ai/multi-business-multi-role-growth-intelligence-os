-- Staging-only, fail-closed correction. This migration never performs provider writes.
-- The earlier 20260911 migration must not be rewritten: its test certification was
-- not evidence of a live, same-cycle, server-authorized provider transaction.
CREATE TABLE IF NOT EXISTS staging_activation_gateway_execution_artifacts (
  artifact_ref VARCHAR(191) NOT NULL PRIMARY KEY,
  encrypted_artifact LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staging_activation_gateway_execution_plans (
  plan_id CHAR(36) NOT NULL PRIMARY KEY,
  plan_sha256 CHAR(64) NOT NULL,
  plan_body_json JSON NOT NULL,
  environment_convergence_plan_sha256 CHAR(64) NOT NULL,
  expected_source_commit CHAR(40) NOT NULL,
  expected_policy_hash CHAR(64) NOT NULL,
  resource_binding_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  bundle_sha256 CHAR(64) NOT NULL,
  secret_set_sha256 CHAR(64) NOT NULL,
  trust_key_id VARCHAR(191) NOT NULL,
  trust_public_key_sha256 CHAR(64) NOT NULL,
  bundle_ref VARCHAR(191) NOT NULL UNIQUE,
  status ENUM('ready','claimed','executing','succeeded','failed','expired') NOT NULL DEFAULT 'ready',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  claimed_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  KEY idx_staging_gateway_plan_claim (plan_sha256, environment_convergence_plan_sha256, status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS staging_activation_gateway_envelope_plan_bindings (
  envelope_id VARCHAR(191) NOT NULL PRIMARY KEY,
  plan_id CHAR(36) NOT NULL,
  plan_sha256 CHAR(64) NOT NULL,
  environment_convergence_plan_sha256 CHAR(64) NOT NULL,
  principal_type VARCHAR(64) NOT NULL,
  principal_id VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_staging_gateway_bound_plan (plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE runtime_dispatch_certification_registry
   SET certification_status='pending', dispatch_allowed=0, apply_allowed=0,
       last_evidence_ref=NULL, last_certified_at=NULL, expires_at=NULL,
       smoke_strategy='independent_same_cycle_staging_gateway_transaction_certification',
       notes='Requires independent live certification authority after exact immutable plan, provider transaction, audit, and verified rollback evidence.'
 WHERE certification_key='staging_activation_gateway_apply_v1';
