-- 1035_sprint69_capability_enablement_broker_ledgers.sql
-- Purpose: add no-secret internal ledgers for the Capability Enablement Broker.
-- Safety: additive/idempotent SQL only; no provider call; no credential payload read;
-- no raw secrets; no external send; no external write; no deployment; secrets_included=false.

CREATE TABLE IF NOT EXISTS capability_enablement_requests (
  request_id VARCHAR(64) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NULL,
  caller_type VARCHAR(32) NOT NULL DEFAULT 'tenant',
  capability_key VARCHAR(191) NOT NULL,
  operation_intent VARCHAR(64) NOT NULL,
  app_key VARCHAR(128) NULL,
  runtime_surface VARCHAR(191) NULL,
  workspace_id VARCHAR(64) NULL,
  resource_uri VARCHAR(512) NULL,
  decision VARCHAR(128) NOT NULL,
  next_allowed_mode VARCHAR(64) NULL,
  reason_codes_json JSON NULL,
  input_hash_sha256 CHAR(64) NOT NULL,
  effective_hash_sha256 CHAR(64) NULL,
  dry_run_hash_sha256 CHAR(64) NULL,
  classification_json JSON NULL,
  projection_json JSON NULL,
  provider_calls_made TINYINT(1) NOT NULL DEFAULT 0,
  external_mutations_executed TINYINT(1) NOT NULL DEFAULT 0,
  internal_persistence_executed TINYINT(1) NOT NULL DEFAULT 1,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  KEY idx_ceb_req_tenant_created (tenant_id, created_at),
  KEY idx_ceb_req_user_created (user_id, created_at),
  KEY idx_ceb_req_decision_created (decision, created_at),
  KEY idx_ceb_req_capability_created (capability_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS capability_enablement_steps (
  step_id VARCHAR(64) NOT NULL PRIMARY KEY,
  request_id VARCHAR(64) NOT NULL,
  step_order INT NOT NULL,
  action_key VARCHAR(191) NOT NULL,
  required_role VARCHAR(128) NULL,
  reason_code VARCHAR(128) NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'proposed',
  proposal_json JSON NULL,
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ceb_steps_request_order (request_id, step_order),
  KEY idx_ceb_steps_action_created (action_key, created_at),
  CONSTRAINT fk_ceb_steps_request
    FOREIGN KEY (request_id) REFERENCES capability_enablement_requests (request_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_capability_enablement_decision_rollup AS
SELECT
  tenant_id,
  capability_key,
  operation_intent,
  decision,
  COUNT(*) AS request_count,
  SUM(CASE WHEN provider_calls_made = 0 THEN 1 ELSE 0 END) AS no_provider_call_count,
  SUM(CASE WHEN external_mutations_executed = 0 THEN 1 ELSE 0 END) AS no_external_mutation_count,
  SUM(CASE WHEN secrets_included = 0 THEN 1 ELSE 0 END) AS no_secret_count,
  MAX(created_at) AS latest_created_at
FROM capability_enablement_requests
GROUP BY tenant_id, capability_key, operation_intent, decision;
