-- 904_sprint68_platform_resource_authority_bindings.sql
-- Sprint 68: Platform resource authority bindings
-- Purpose: generic tenant/workspace/user authority bindings for governed resource recipes.
-- V1 is binding/readback foundation only; no provider calls, no secrets, no automatic mutations.

CREATE TABLE IF NOT EXISTS platform_resource_authority_bindings (
  binding_id VARCHAR(36) NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(36) NULL,
  workspace_id VARCHAR(36) NULL,
  user_id VARCHAR(64) NULL,
  resource_type VARCHAR(128) NOT NULL,
  resource_uri VARCHAR(512) NOT NULL,
  resource_ref_json LONGTEXT NULL,
  recipe_key VARCHAR(191) NULL,
  permission_level ENUM('read_only','diagnostic','comment','label','close','patch','merge','admin') NOT NULL DEFAULT 'read_only',
  allowed_modes_json LONGTEXT NOT NULL,
  authority_source VARCHAR(128) NOT NULL DEFAULT 'admin_grant',
  source_system_id VARCHAR(36) NULL,
  source_installation_id VARCHAR(36) NULL,
  expires_at DATETIME NULL,
  status ENUM('active','suspended','revoked','expired') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_platform_resource_authority_bindings_allowed_modes_json CHECK (JSON_VALID(allowed_modes_json)),
  CONSTRAINT chk_platform_resource_authority_bindings_resource_ref_json CHECK (resource_ref_json IS NULL OR JSON_VALID(resource_ref_json))
);

CREATE INDEX idx_platform_resource_authority_bindings_scope
  ON platform_resource_authority_bindings (tenant_id, workspace_id, user_id, status);

CREATE INDEX idx_platform_resource_authority_bindings_resource
  ON platform_resource_authority_bindings (resource_type, resource_uri(191), status);

CREATE INDEX idx_platform_resource_authority_bindings_recipe
  ON platform_resource_authority_bindings (recipe_key, permission_level, status);

INSERT INTO execution_policies
  (policy_key, policy_group, policy_value_json, active, blocking, notes)
VALUES
  ('platform_resource_authority_binding_policy_v1',
   'Repository Intelligence Governance',
   JSON_OBJECT(
     'purpose', 'Require explicit tenant/workspace/user authority binding before tenant-scoped governed resource execution.',
     'scope', JSON_ARRAY('platform_resource_authority_bindings','governed_resource_run','repo.pr.reconciliation_sweep'),
     'v1', JSON_OBJECT(
       'platform_admin_without_tenant_binding', 'allowed_read_only',
       'tenant_or_workspace_scope_without_binding', 'blocked',
       'binding_required_for_modes', JSON_ARRAY('read_only','diagnostic','comment','label','close','patch','merge','apply'),
       'mutation_permissions_are_future_gated', true,
       'secrets_allowed', false
     )
   ),
   TRUE,
   TRUE,
   'Generic platform resource authority binding policy. V1 gates tenant/workspace/user scoped resource execution and does not enable mutations.')
ON DUPLICATE KEY UPDATE
  policy_value_json = VALUES(policy_value_json),
  active = VALUES(active),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
