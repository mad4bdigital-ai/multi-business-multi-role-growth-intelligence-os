-- MariaDB 11.4 compatibility bridge for immutable migration 20260728.
-- SHA2() is not permitted in a STORED generated column (ERROR 1901).
-- Materialize the active-scope digest and maintain its exact active/null
-- semantics through DDL-defined BEFORE INSERT/UPDATE triggers.
-- No DML or provider/runtime action.

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
  active_scope_hash CHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_brand_skill_grant_active_scope (active_scope_hash),
  KEY idx_user_brand_skill_grant_lookup (tenant_id, user_id, brand_key, agent_id, skill_id, status),
  KEY idx_user_brand_skill_grant_expiry (status, expires_at),
  KEY idx_user_brand_skill_grant_policy (policy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE OR REPLACE TRIGGER trg_user_brand_skill_grants_active_scope_hash_bi
BEFORE INSERT ON user_brand_skill_grants
FOR EACH ROW
SET NEW.active_scope_hash = CASE WHEN NEW.status = 'active' THEN SHA2(CONCAT_WS('|',
  HEX(NEW.tenant_id), HEX(NEW.user_id), HEX(NEW.brand_key), HEX(NEW.agent_id), HEX(NEW.skill_id),
  HEX(COALESCE(NEW.resource_type, '')), HEX(COALESCE(NEW.resource_ref, ''))
), 256) ELSE NULL END;

CREATE OR REPLACE TRIGGER trg_user_brand_skill_grants_active_scope_hash_bu
BEFORE UPDATE ON user_brand_skill_grants
FOR EACH ROW
SET NEW.active_scope_hash = CASE WHEN NEW.status = 'active' THEN SHA2(CONCAT_WS('|',
  HEX(NEW.tenant_id), HEX(NEW.user_id), HEX(NEW.brand_key), HEX(NEW.agent_id), HEX(NEW.skill_id),
  HEX(COALESCE(NEW.resource_type, '')), HEX(COALESCE(NEW.resource_ref, ''))
), 256) ELSE NULL END;
