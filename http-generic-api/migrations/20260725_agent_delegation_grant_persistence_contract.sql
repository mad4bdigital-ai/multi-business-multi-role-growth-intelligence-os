-- Spec 011 Phase 3 Slice C: additive canonical delegation-grant persistence contract.
-- Contract only. This migration is not applied by adding it to the repository.
-- Legacy rows remain dispatch-ineligible because canonical_status stays NULL and
-- runtime_policy_ready defaults to 0.

ALTER TABLE agent_delegations
  ADD COLUMN IF NOT EXISTS grant_schema_version VARCHAR(64) NULL AFTER delegation_id,
  ADD COLUMN IF NOT EXISTS approval_mode VARCHAR(64) NULL AFTER grant_schema_version,
  ADD COLUMN IF NOT EXISTS plan_hash CHAR(64) NULL AFTER plan_id,
  ADD COLUMN IF NOT EXISTS resource_scope_json JSON NULL AFTER plan_hash,
  ADD COLUMN IF NOT EXISTS resource_scope_hash CHAR(64) NULL AFTER resource_scope_json,
  ADD COLUMN IF NOT EXISTS allowed_intents_json JSON NULL AFTER resource_scope_hash,
  ADD COLUMN IF NOT EXISTS denied_intents_json JSON NULL AFTER allowed_intents_json,
  ADD COLUMN IF NOT EXISTS max_risk_tier VARCHAR(16) NULL AFTER denied_intents_json,
  ADD COLUMN IF NOT EXISTS max_mutations INT UNSIGNED NULL AFTER max_risk_tier,
  ADD COLUMN IF NOT EXISTS consumed_mutations INT UNSIGNED NOT NULL DEFAULT 0 AFTER max_mutations,
  ADD COLUMN IF NOT EXISTS max_retries TINYINT UNSIGNED NULL AFTER consumed_mutations,
  ADD COLUMN IF NOT EXISTS consumed_retries TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER max_retries,
  ADD COLUMN IF NOT EXISTS max_pull_requests TINYINT UNSIGNED NULL AFTER consumed_retries,
  ADD COLUMN IF NOT EXISTS consumed_pull_requests TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER max_pull_requests,
  ADD COLUMN IF NOT EXISTS require_readback TINYINT(1) NULL AFTER consumed_pull_requests,
  ADD COLUMN IF NOT EXISTS stop_on_drift TINYINT(1) NULL AFTER require_readback,
  ADD COLUMN IF NOT EXISTS policy_version VARCHAR(64) NULL AFTER stop_on_drift,
  ADD COLUMN IF NOT EXISTS grant_hash CHAR(64) NULL AFTER policy_version,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(191) NULL AFTER grant_hash,
  ADD COLUMN IF NOT EXISTS canonical_status VARCHAR(32) NULL AFTER status,
  ADD COLUMN IF NOT EXISTS approval_hold_id CHAR(36) NULL AFTER canonical_status,
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(191) NULL AFTER approval_hold_id,
  ADD COLUMN IF NOT EXISTS approved_at DATETIME(3) NULL AFTER approved_by,
  ADD COLUMN IF NOT EXISTS revoked_by VARCHAR(191) NULL AFTER approved_at,
  ADD COLUMN IF NOT EXISTS revoked_at DATETIME(3) NULL AFTER revoked_by,
  ADD COLUMN IF NOT EXISTS revocation_reason VARCHAR(500) NULL AFTER revoked_at,
  ADD COLUMN IF NOT EXISTS runtime_policy_ready TINYINT(1) NOT NULL DEFAULT 0 AFTER revocation_reason,
  ADD COLUMN IF NOT EXISTS canonical_created_at DATETIME(3) NULL AFTER runtime_policy_ready,
  ADD COLUMN IF NOT EXISTS canonical_updated_at DATETIME(3) NULL AFTER canonical_created_at,
  ADD UNIQUE INDEX IF NOT EXISTS ux_agent_delegations_tenant_user_idempotency
    (tenant_id, user_id, idempotency_key),
  ADD INDEX IF NOT EXISTS ix_agent_delegations_canonical_active
    (tenant_id, user_id, canonical_status, runtime_policy_ready, expires_at),
  ADD INDEX IF NOT EXISTS ix_agent_delegations_plan_hash
    (tenant_id, plan_id, plan_hash),
  ADD INDEX IF NOT EXISTS ix_agent_delegations_grant_hash
    (tenant_id, grant_hash),
  ADD INDEX IF NOT EXISTS ix_agent_delegations_approval_hold
    (tenant_id, approval_hold_id);

CREATE OR REPLACE VIEW effective_agent_delegation_grants_v AS
SELECT
  d.delegation_id AS grant_id,
  d.grant_schema_version,
  d.tenant_id,
  d.user_id AS delegated_by,
  d.agent_id AS delegated_to,
  d.approval_mode,
  d.intent_key,
  d.brand_key,
  d.plan_id,
  d.plan_hash,
  d.resource_scope_json,
  d.resource_scope_hash,
  d.allowed_intents_json,
  d.denied_intents_json,
  d.max_risk_tier,
  d.max_mutations,
  d.consumed_mutations,
  d.max_retries,
  d.consumed_retries,
  d.max_pull_requests,
  d.consumed_pull_requests,
  d.require_readback,
  d.stop_on_drift,
  d.policy_version,
  d.grant_hash,
  d.idempotency_key,
  d.canonical_status,
  d.approval_hold_id,
  d.approved_by,
  d.approved_at,
  d.expires_at,
  d.canonical_created_at,
  d.canonical_updated_at
FROM agent_delegations d
WHERE d.runtime_policy_ready = 1
  AND d.grant_schema_version = 'spec011-delegation-grant-v1'
  AND d.canonical_status = 'active'
  AND d.status IN ('pending', 'executing')
  AND d.expires_at IS NOT NULL
  AND d.expires_at > UTC_TIMESTAMP(3)
  AND d.revoked_at IS NULL
  AND d.tenant_id IS NOT NULL
  AND d.user_id IS NOT NULL
  AND d.agent_id IS NOT NULL
  AND d.plan_id IS NOT NULL
  AND d.plan_hash REGEXP '^[0-9a-f]{64}$'
  AND d.resource_scope_json IS NOT NULL
  AND JSON_VALID(d.resource_scope_json) = 1
  AND JSON_LENGTH(d.resource_scope_json) > 0
  AND d.resource_scope_hash REGEXP '^[0-9a-f]{64}$'
  AND d.allowed_intents_json IS NOT NULL
  AND JSON_VALID(d.allowed_intents_json) = 1
  AND JSON_LENGTH(d.allowed_intents_json) > 0
  AND d.denied_intents_json IS NOT NULL
  AND JSON_VALID(d.denied_intents_json) = 1
  AND d.approval_mode IN (
    'user_approval_only',
    'agent_recommend_only',
    'agent_queue_for_approval',
    'delegated_low_risk',
    'delegated_plan_bound',
    'human_on_exception',
    'multi_agent_approval',
    'break_glass'
  )
  AND d.max_risk_tier IN ('read_only', 'low', 'medium', 'high', 'critical')
  AND d.max_mutations IS NOT NULL
  AND d.max_retries IS NOT NULL
  AND d.max_pull_requests IS NOT NULL
  AND d.consumed_mutations <= d.max_mutations
  AND d.consumed_retries <= d.max_retries
  AND d.consumed_pull_requests <= d.max_pull_requests
  AND d.require_readback = 1
  AND d.stop_on_drift = 1
  AND d.grant_hash REGEXP '^[0-9a-f]{64}$'
  AND d.idempotency_key IS NOT NULL
  AND CHAR_LENGTH(TRIM(d.idempotency_key)) > 0
  AND d.approved_by IS NOT NULL
  AND CHAR_LENGTH(TRIM(d.approved_by)) > 0
  AND d.approved_at IS NOT NULL;
