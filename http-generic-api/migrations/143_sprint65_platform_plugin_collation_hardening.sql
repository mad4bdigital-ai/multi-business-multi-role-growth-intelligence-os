-- Sprint 65: Platform Plugin collation hardening delta
--
-- Complements 142_sprint65_platform_plugin_collation_normalization.sql.
-- Keeps future DDL aligned with utf8mb4_unicode_ci and closes join-key gaps
-- for workspace app links and connection/workspace identifiers.
-- Safety: snapshot the additional table before mutation; do not touch JSON or
-- encrypted credential payload columns.

ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collation_backup_workspace_app_links_20260526 AS SELECT * FROM workspace_app_links;

ALTER TABLE workspace_app_links
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY link_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY workspace_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY workspace_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY connection_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY linked_by VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  MODIFY status ENUM('active','suspended','removed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  MODIFY permission_mode ENUM('strict','permissive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'strict';

DROP VIEW IF EXISTS v_platform_plugin_collation_issues;

CREATE VIEW v_platform_plugin_collation_issues AS
SELECT
  table_name,
  column_name,
  column_type,
  character_set_name,
  collation_name,
  'expected utf8mb4_unicode_ci for Platform Plugin join key' AS issue_detail
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN (
    'app_integrations',
    'app_integration_action_bindings',
    'app_integration_tool_bindings',
    'tenant_integration_policies',
    'user_app_connections',
    'workspace_app_links',
    'app_action_grants',
    'app_action_requests',
    'actions',
    'endpoints',
    'platform_plugin_contributions'
  )
  AND column_name IN (
    'app_key',
    'action_key',
    'tool_key',
    'tenant_id',
    'user_id',
    'workspace_id',
    'connection_id',
    'status',
    'plugin_key',
    'endpoint_key',
    'parent_action_key'
  )
  AND character_set_name = 'utf8mb4'
  AND collation_name <> 'utf8mb4_unicode_ci';

UPDATE execution_policies
SET active = 'true',
    blocking = 'true',
    execution_scope = 'schema_and_runtime_joins',
    affects_layer = 'platform_plugin_registry',
    policy_value = JSON_SET(
      COALESCE(policy_value, JSON_OBJECT()),
      '$.expected_collation', 'utf8mb4_unicode_ci',
      '$.diagnostic_view', 'v_platform_plugin_collation_issues',
      '$.includes_workspace_app_links', true,
      '$.includes_connection_workspace_keys', true
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'schema_governance'
  AND policy_key = 'platform_plugin_join_key_collation';
