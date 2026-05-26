-- Sprint 65: normalize Platform Plugin and app connection join-key collations.
-- Problem: older tables inherited utf8mb4_uca1400_ai_ci while newer plugin/binding tables use utf8mb4_unicode_ci.
-- This breaks natural joins on app_key, action_key, tenant_id, user_id, and status.
-- Safety: create prefixed snapshot tables before altering original tables. No JSON columns or secret payloads are modified.

CREATE TABLE IF NOT EXISTS collation_backup_app_integrations_20260526 AS SELECT * FROM app_integrations;
CREATE TABLE IF NOT EXISTS collation_backup_user_app_connections_20260526 AS SELECT * FROM user_app_connections;
CREATE TABLE IF NOT EXISTS collation_backup_app_action_grants_20260526 AS SELECT * FROM app_action_grants;
CREATE TABLE IF NOT EXISTS collation_backup_app_action_requests_20260526 AS SELECT * FROM app_action_requests;

ALTER TABLE app_integrations
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY status ENUM('active','beta','deprecated') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';

ALTER TABLE user_app_connections
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY user_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY status ENUM('active','expired','revoked','error') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';

ALTER TABLE app_action_grants
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY action_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY status ENUM('active','revoked','expired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';

ALTER TABLE app_action_requests
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY action_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY status ENUM('pending','approved','denied','expired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending';

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
    'app_action_grants',
    'app_action_requests',
    'actions',
    'endpoints',
    'platform_plugin_contributions'
  )
  AND column_name IN ('app_key','action_key','tool_key','tenant_id','user_id','status','plugin_key','endpoint_key','parent_action_key')
  AND character_set_name = 'utf8mb4'
  AND collation_name <> 'utf8mb4_unicode_ci';

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
SELECT
  'schema_governance',
  'platform_plugin_join_key_collation',
  JSON_OBJECT(
    'expected_collation', 'utf8mb4_unicode_ci',
    'diagnostic_view', 'v_platform_plugin_collation_issues',
    'tables', JSON_ARRAY(
      'app_integrations',
      'app_integration_action_bindings',
      'app_integration_tool_bindings',
      'tenant_integration_policies',
      'user_app_connections',
      'app_action_grants',
      'app_action_requests',
      'actions',
      'endpoints',
      'platform_plugin_contributions'
    )
  ),
  'true',
  'schema_and_runtime_joins',
  'platform_plugin_registry',
  'true',
  'Blocking policy: Platform Plugin/app connection join keys must share utf8mb4_unicode_ci to avoid illegal mix of collations in runtime joins.'
WHERE NOT EXISTS (
  SELECT 1 FROM execution_policies
  WHERE policy_group = 'schema_governance'
    AND policy_key = 'platform_plugin_join_key_collation'
);

UPDATE execution_policies
SET active = 'true',
    blocking = 'true',
    execution_scope = 'schema_and_runtime_joins',
    affects_layer = 'platform_plugin_registry',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'schema_governance'
  AND policy_key = 'platform_plugin_join_key_collation';
