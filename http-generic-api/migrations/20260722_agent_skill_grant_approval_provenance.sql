-- Agent skill grant approval provenance authority.
-- Additive, SQL-primary, fail-closed, no provider calls, no external writes, no secrets.

CREATE TABLE IF NOT EXISTS agent_skill_grant_requests (
  request_id VARCHAR(36) NOT NULL PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL,
  skill_id VARCHAR(36) NOT NULL,
  tenant_id VARCHAR(36) NULL,
  brand_key VARCHAR(128) NULL,
  tenant_scope_key VARCHAR(64)
    GENERATED ALWAYS AS (COALESCE(tenant_id, '__global__')) STORED,
  brand_scope_key VARCHAR(128)
    GENERATED ALWAYS AS (COALESCE(brand_key, '__all_brands__')) STORED,
  request_status ENUM('pending','approved','rejected','deferred','expired','not_required') NOT NULL DEFAULT 'pending',
  approval_policy_key VARCHAR(128) NOT NULL,
  approval_hold_id VARCHAR(36) NULL,
  requested_by VARCHAR(128) NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decision_by VARCHAR(128) NULL,
  decision_note VARCHAR(512) NULL,
  decided_at DATETIME NULL,
  provenance_type ENUM('runtime_request','tenant_owner_decision','platform_admin_decision','platform_bootstrap_migration','not_required') NOT NULL DEFAULT 'runtime_request',
  provenance_ref VARCHAR(255) NULL,
  idempotency_key VARCHAR(191) NULL,
  expires_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  open_effective_scope_key VARCHAR(512)
    GENERATED ALWAYS AS (
      CASE
        WHEN request_status IN ('pending','deferred') THEN CONCAT(
          agent_id, '|', skill_id, '|', COALESCE(tenant_id, '__global__'), '|', COALESCE(brand_key, '__all_brands__')
        )
        ELSE NULL
      END
    ) STORED,
  UNIQUE KEY uq_agent_skill_grant_requests_open_scope (open_effective_scope_key),
  UNIQUE KEY uq_agent_skill_grant_requests_idempotency (requested_by, idempotency_key),
  INDEX idx_agent_skill_grant_requests_subject (tenant_id, brand_key, request_status, requested_at),
  INDEX idx_agent_skill_grant_requests_agent (agent_id, skill_id, request_status),
  INDEX idx_agent_skill_grant_requests_hold (approval_hold_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE agent_skill_grants
  ADD COLUMN IF NOT EXISTS grant_request_id VARCHAR(36) NULL AFTER status;

CREATE INDEX IF NOT EXISTS idx_agent_skill_grants_request
  ON agent_skill_grants (grant_request_id);

-- Reject legacy brand-scoped grants that have no brand identity.
INSERT IGNORE INTO agent_skill_grant_requests (
  request_id, agent_id, skill_id, tenant_id, brand_key, request_status,
  approval_policy_key, requested_by, requested_at, decision_by, decision_note,
  decided_at, provenance_type, provenance_ref
)
SELECT g.grant_id, g.agent_id, g.skill_id, g.tenant_id, g.brand_key, 'rejected',
       'brand_scope_required_v1', COALESCE(g.granted_by, 'legacy_seed'), g.granted_at,
       'platform_bootstrap_migration',
       'Rejected during approval-provenance migration because the brand-scoped grant had no brand_key.',
       NOW(), 'platform_bootstrap_migration',
       'migration://20260722_agent_skill_grant_approval_provenance.sql'
  FROM agent_skill_grants g
  JOIN agent_skills s ON s.skill_id = g.skill_id
 WHERE g.status = 'active'
   AND s.requires_approval = 1
   AND s.scope = 'brand'
   AND g.brand_key IS NULL;

-- Preserve required system bootstrap grants with explicit immutable provenance.
INSERT IGNORE INTO agent_skill_grant_requests (
  request_id, agent_id, skill_id, tenant_id, brand_key, request_status,
  approval_policy_key, requested_by, requested_at, decision_by, decision_note,
  decided_at, provenance_type, provenance_ref
)
SELECT g.grant_id, g.agent_id, g.skill_id, g.tenant_id, g.brand_key, 'approved',
       'platform_bootstrap_skill_grant_v1', COALESCE(g.granted_by, 'master_data_seed'), g.granted_at,
       'platform_bootstrap_migration',
       'Grandfathered system bootstrap grant with migration provenance and runtime readback requirement.',
       NOW(), 'platform_bootstrap_migration',
       'migration://20260722_agent_skill_grant_approval_provenance.sql'
  FROM agent_skill_grants g
  JOIN agent_skills s ON s.skill_id = g.skill_id
  JOIN agents a ON a.agent_id = g.agent_id
 WHERE g.status = 'active'
   AND s.requires_approval = 1
   AND a.is_system = 1
   AND NOT (s.scope = 'brand' AND g.brand_key IS NULL);

-- Any remaining approval-required active grant becomes a pending request and is fail-closed.
INSERT IGNORE INTO agent_skill_grant_requests (
  request_id, agent_id, skill_id, tenant_id, brand_key, request_status,
  approval_policy_key, requested_by, requested_at, provenance_type, provenance_ref
)
SELECT g.grant_id, g.agent_id, g.skill_id, g.tenant_id, g.brand_key, 'pending',
       CASE WHEN g.tenant_id IS NULL THEN 'platform_admin_skill_grant_v1' ELSE 'tenant_owner_skill_grant_v1' END,
       COALESCE(g.granted_by, 'legacy_seed'), g.granted_at, 'runtime_request',
       'migration://20260722_agent_skill_grant_approval_provenance.sql'
  FROM agent_skill_grants g
  JOIN agent_skills s ON s.skill_id = g.skill_id
  LEFT JOIN agent_skill_grant_requests r ON r.request_id = g.grant_id
 WHERE g.status = 'active'
   AND s.requires_approval = 1
   AND r.request_id IS NULL;

UPDATE agent_skill_grants g
JOIN agent_skill_grant_requests r ON r.request_id = g.grant_id
JOIN agent_skills s ON s.skill_id = g.skill_id AND s.requires_approval = 1
   SET g.grant_request_id = r.request_id,
       g.status = CASE WHEN r.request_status = 'approved' THEN 'active' ELSE 'revoked' END
 WHERE g.grant_request_id IS NULL
    OR g.grant_request_id <> r.request_id
    OR g.status <> CASE WHEN r.request_status = 'approved' THEN 'active' ELSE 'revoked' END;

CREATE OR REPLACE VIEW v_effective_agent_skill_grants AS
SELECT g.id, g.grant_id, g.agent_id, g.skill_id, g.tenant_id, g.brand_key,
       g.granted_by, g.granted_at, g.expires_at, g.status,
       g.active_effective_scope_key, g.grant_request_id,
       r.request_status, r.approval_policy_key, r.approval_hold_id,
       r.provenance_type, r.provenance_ref, r.decided_at AS approval_decided_at
  FROM agent_skill_grants g
  JOIN agent_skills s ON s.skill_id = g.skill_id AND s.status = 'active'
  LEFT JOIN agent_skill_grant_requests r ON r.request_id = g.grant_request_id
 WHERE g.status = 'active'
   AND (g.expires_at IS NULL OR g.expires_at > NOW())
   AND (
     s.requires_approval = 0
     OR (
       r.request_status = 'approved'
       AND r.decided_at IS NOT NULL
       AND r.approval_policy_key IS NOT NULL
     )
   );

CREATE OR REPLACE VIEW v_activation_agent_skill_grants AS
SELECT e.grant_id, e.tenant_id, e.brand_key, e.agent_id,
       a.name AS agent_name, a.display_name AS agent_display_name,
       e.skill_id, s.skill_key, s.display_name AS skill_display_name,
       s.skill_type, s.scope AS skill_scope, s.requires_approval,
       e.status AS grant_status, e.expires_at, e.granted_at, 0 AS secrets_included
  FROM v_effective_agent_skill_grants e
  JOIN agent_skills s ON s.skill_id = e.skill_id
  LEFT JOIN agents a ON a.agent_id = e.agent_id;

CREATE OR REPLACE VIEW v_activation_agent_skill_grant_requests AS
SELECT r.request_id, r.tenant_id, r.brand_key, r.agent_id,
       a.name AS agent_name, a.display_name AS agent_display_name,
       r.skill_id, s.skill_key, s.display_name AS skill_display_name,
       s.skill_type, s.scope AS skill_scope, s.requires_approval,
       r.request_status, r.approval_policy_key, r.approval_hold_id,
       r.requested_by, r.requested_at, r.decision_by, r.decision_note,
       r.decided_at, r.expires_at, r.provenance_type, r.provenance_ref,
       0 AS secrets_included
  FROM agent_skill_grant_requests r
  JOIN agent_skills s ON s.skill_id = r.skill_id
  LEFT JOIN agents a ON a.agent_id = r.agent_id
 WHERE r.request_status IN ('pending','deferred');

INSERT INTO operational_alert_rule_registry (
  rule_key, source_type, condition_key, severity, reason_code,
  recommended_action_key, requires_confirmation, lookback_hours, dedupe_scope, status
)
VALUES (
  'alert_skill_approval', 'v_activation_agent_skill_grant_requests',
  'request_status IN pending,deferred', 'medium', 'skill_requires_approval',
  'skill.review_approval', 1, 168, 'record', 'active'
)
ON DUPLICATE KEY UPDATE
  source_type = VALUES(source_type),
  condition_key = VALUES(condition_key),
  severity = VALUES(severity),
  reason_code = VALUES(reason_code),
  recommended_action_key = VALUES(recommended_action_key),
  requires_confirmation = VALUES(requires_confirmation),
  lookback_hours = VALUES(lookback_hours),
  dedupe_scope = VALUES(dedupe_scope),
  status = VALUES(status);

-- backward_compatible=true
-- additive_only=true
-- internal_registry_write_only=true
-- approval_required_grants_fail_closed=true
-- same_cycle_readback_required=true
-- provider_calls=false
-- external_writes=false
-- secrets_included=false
