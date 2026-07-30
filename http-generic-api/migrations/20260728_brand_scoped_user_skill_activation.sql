-- Brand-scoped user skill activation authority.
-- Additive, SQL-primary, fail-closed when a policy is configured.
-- No provider calls, external writes, credential reads, or automatic skill activation.

CREATE TABLE IF NOT EXISTS brand_skill_policies (
  policy_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  brand_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  skill_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  activation_mode ENUM('self_service','approval_required','temporary_only','admin_only','disabled') NOT NULL DEFAULT 'approval_required',
  allowed_roles_json JSON NULL,
  allowed_agent_ids_json JSON NULL,
  allowed_operations_json JSON NULL,
  max_ttl_hours INT UNSIGNED NULL,
  requires_resource_binding TINYINT(1) NOT NULL DEFAULT 1,
  constraints_json JSON NULL,
  status ENUM('active','inactive','revoked') NOT NULL DEFAULT 'active',
  created_by VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_brand_skill_policy_scope (tenant_id, brand_key, skill_id),
  KEY idx_brand_skill_policy_status (tenant_id, brand_key, status),
  KEY idx_brand_skill_policy_skill (skill_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS user_brand_skill_grants (
  grant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  user_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  brand_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  agent_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  skill_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NOT NULL,
  policy_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL,
  workspace_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL,
  resource_grant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci NULL,
  resource_type VARCHAR(64) NULL,
  resource_ref VARCHAR(255) NULL,
  allowed_operations_json JSON NOT NULL,
  constraints_json JSON NULL,
  granted_by VARCHAR(128) NULL,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  revoked_by VARCHAR(128) NULL,
  revoked_at DATETIME NULL,
  provenance_type VARCHAR(64) NOT NULL DEFAULT 'brand_self_service',
  provenance_ref VARCHAR(255) NULL,
  status ENUM('active','pending','suspended','revoked','expired') NOT NULL DEFAULT 'active',
  active_scope_hash CHAR(64) GENERATED ALWAYS AS (
    CASE WHEN status = 'active' THEN SHA2(CONCAT_WS('|',
      HEX(tenant_id),
      HEX(user_id),
      HEX(brand_key),
      HEX(agent_id),
      HEX(skill_id),
      HEX(COALESCE(resource_type, '')),
      HEX(COALESCE(resource_ref, ''))
    ), 256) ELSE NULL END
  ) STORED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_brand_skill_grant_active_scope (active_scope_hash),
  KEY idx_user_brand_skill_grant_lookup (tenant_id, user_id, brand_key, agent_id, skill_id, status),
  KEY idx_user_brand_skill_grant_expiry (status, expires_at),
  KEY idx_user_brand_skill_grant_policy (policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE OR REPLACE VIEW v_effective_user_brand_skill_grants AS
SELECT
  g.grant_id,
  g.tenant_id,
  g.user_id,
  g.brand_key,
  g.agent_id,
  g.skill_id,
  s.skill_key,
  g.policy_id,
  p.activation_mode,
  g.workspace_id,
  g.resource_grant_id,
  g.resource_type,
  g.resource_ref,
  g.allowed_operations_json,
  g.constraints_json,
  g.granted_by,
  g.granted_at,
  g.expires_at,
  g.provenance_type,
  g.provenance_ref,
  g.status
FROM user_brand_skill_grants g
JOIN agent_skills s
  ON s.skill_id = g.skill_id
 AND s.status = 'active'
JOIN brand_skill_policies p
  ON p.policy_id = g.policy_id
 AND p.tenant_id = g.tenant_id
 AND p.brand_key = g.brand_key
 AND p.skill_id = g.skill_id
 AND p.status = 'active'
WHERE g.status = 'active'
  AND (g.expires_at IS NULL OR g.expires_at > CURRENT_TIMESTAMP);

-- Runtime policy markers:
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- authority=user_jwt_plus_membership_plus_workspace_resource_grants
-- legacy_agent_skill_grants_preserved=true
-- configured_brand_policy_enforcement_fail_closed=true
-- automatic_skill_activation=false
-- same_cycle_readback_required=true
-- read_only_preflight=brand_skill_migration_preflight_v1
-- rollback_runbook=docs/runbooks/brand-skill-migration.md
-- secrets_included_false
