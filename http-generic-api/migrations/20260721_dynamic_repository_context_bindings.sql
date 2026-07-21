CREATE TABLE IF NOT EXISTS repository_context_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  binding_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workspace_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  brand_target_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  system_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  installation_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  connection_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  repository_provider VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'github',
  repository_owner VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  repository_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  repository_node_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  default_branch VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'main',
  environment VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'production',
  webhook_callback_url VARCHAR(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  webhook_events_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  webhook_secret_ref VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active','pending','disabled','archived') NOT NULL DEFAULT 'pending',
  metadata_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_by VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_repository_context_binding_id (binding_id),
  UNIQUE KEY uq_repository_context_binding_key (binding_key),
  UNIQUE KEY uq_repository_context_scope (tenant_id, brand_target_key, app_key, repository_provider, repository_owner, repository_name, environment),
  KEY idx_repository_context_brand_app (brand_target_key, app_key, status),
  KEY idx_repository_context_workspace (workspace_id, status),
  KEY idx_repository_context_system (system_id, installation_id, status),
  KEY idx_repository_context_connection (connection_id, status),
  KEY idx_repository_context_repo (repository_provider, repository_owner, repository_name, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_repository_context_binding_readiness AS
SELECT
  resolved.*,
  CASE
    WHEN resolved.status <> 'active' THEN 'repository_context_binding_inactive'
    WHEN resolved.brand_rows <> 1 THEN 'repository_context_brand_unresolved'
    WHEN resolved.app_rows <> 1 THEN 'repository_context_app_unresolved'
    WHEN resolved.workspace_rows <> 1 THEN 'repository_context_workspace_unresolved'
    WHEN resolved.workspace_app_link_rows <> 1 THEN 'repository_context_workspace_app_link_unresolved'
    WHEN resolved.system_rows <> 1 THEN 'repository_context_system_unresolved'
    WHEN resolved.installation_rows <> 1 THEN 'repository_context_installation_unresolved'
    WHEN resolved.connection_rows <> 1 THEN 'repository_context_connection_unresolved'
    WHEN resolved.secret_reference_rows <> 1 THEN 'repository_context_secret_reference_unresolved'
    WHEN resolved.repository_provider <> 'github' THEN 'repository_context_provider_unsupported'
    WHEN resolved.repository_owner = '' OR resolved.repository_name = '' THEN 'repository_context_repository_invalid'
    WHEN resolved.webhook_callback_url NOT LIKE 'https://auth.mad4b.com/%' THEN 'repository_context_callback_not_governed'
    WHEN JSON_VALID(resolved.webhook_events_json) = 0 THEN 'repository_context_events_invalid'
    WHEN JSON_CONTAINS(resolved.webhook_events_json, JSON_QUOTE('push')) = 0 THEN 'repository_context_push_event_missing'
    ELSE NULL
  END AS issue_code,
  CASE
    WHEN resolved.status = 'active'
      AND resolved.brand_rows = 1
      AND resolved.app_rows = 1
      AND resolved.workspace_rows = 1
      AND resolved.workspace_app_link_rows = 1
      AND resolved.system_rows = 1
      AND resolved.installation_rows = 1
      AND resolved.connection_rows = 1
      AND resolved.secret_reference_rows = 1
      AND resolved.repository_provider = 'github'
      AND resolved.repository_owner <> ''
      AND resolved.repository_name <> ''
      AND resolved.webhook_callback_url LIKE 'https://auth.mad4b.com/%'
      AND JSON_VALID(resolved.webhook_events_json) = 1
      AND JSON_CONTAINS(resolved.webhook_events_json, JSON_QUOTE('push')) = 1
    THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status
FROM (
  SELECT
    binding.*,
    (SELECT COUNT(*) FROM brands brand
      WHERE brand.target_key COLLATE utf8mb4_unicode_ci = binding.brand_target_key COLLATE utf8mb4_unicode_ci
        AND LOWER(COALESCE(brand.status, 'active')) NOT IN ('archived','disabled','inactive')) AS brand_rows,
    (SELECT COUNT(*) FROM app_integrations app
      WHERE app.app_key COLLATE utf8mb4_unicode_ci = binding.app_key COLLATE utf8mb4_unicode_ci
        AND app.status = 'active') AS app_rows,
    CASE WHEN binding.workspace_id IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM workspace_registry workspace
        WHERE workspace.workspace_id COLLATE utf8mb4_unicode_ci = binding.workspace_id COLLATE utf8mb4_unicode_ci
          AND workspace.tenant_id COLLATE utf8mb4_unicode_ci = binding.tenant_id COLLATE utf8mb4_unicode_ci
          AND workspace.bootstrap_status = 'ready') END AS workspace_rows,
    CASE WHEN binding.workspace_id IS NULL OR binding.connection_id IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM workspace_app_links link
        WHERE link.workspace_id COLLATE utf8mb4_unicode_ci = binding.workspace_id COLLATE utf8mb4_unicode_ci
          AND link.tenant_id COLLATE utf8mb4_unicode_ci = binding.tenant_id COLLATE utf8mb4_unicode_ci
          AND link.connection_id COLLATE utf8mb4_unicode_ci = binding.connection_id COLLATE utf8mb4_unicode_ci
          AND link.app_key COLLATE utf8mb4_unicode_ci = binding.app_key COLLATE utf8mb4_unicode_ci
          AND link.status = 'active') END AS workspace_app_link_rows,
    (SELECT COUNT(*) FROM connected_systems system
      WHERE system.system_id COLLATE utf8mb4_unicode_ci = binding.system_id COLLATE utf8mb4_unicode_ci
        AND system.status = 'active') AS system_rows,
    CASE WHEN binding.installation_id IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM installations installation
        WHERE installation.installation_id COLLATE utf8mb4_unicode_ci = binding.installation_id COLLATE utf8mb4_unicode_ci
          AND installation.system_id COLLATE utf8mb4_unicode_ci = binding.system_id COLLATE utf8mb4_unicode_ci
          AND installation.status = 'active') END AS installation_rows,
    CASE WHEN binding.connection_id IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM user_app_connections connection
        WHERE connection.connection_id COLLATE utf8mb4_unicode_ci = binding.connection_id COLLATE utf8mb4_unicode_ci
          AND connection.tenant_id COLLATE utf8mb4_unicode_ci = binding.tenant_id COLLATE utf8mb4_unicode_ci
          AND connection.app_key COLLATE utf8mb4_unicode_ci = binding.app_key COLLATE utf8mb4_unicode_ci
          AND connection.status = 'active') END AS connection_rows,
    (SELECT COUNT(*) FROM secret_references secret_ref
      WHERE secret_ref.secret_key COLLATE utf8mb4_unicode_ci = REPLACE(binding.webhook_secret_ref, 'ref:secret:', '') COLLATE utf8mb4_unicode_ci
        AND secret_ref.owner_type = 'platform'
        AND secret_ref.status = 'active'
        AND secret_ref.store_type = 'db_encrypted'
        AND secret_ref.validation_status IN ('stored','validated')
        AND secret_ref.rotation_status IN ('provisioned_pending_validation','validated')) AS secret_reference_rows
  FROM repository_context_bindings binding
) resolved;

INSERT INTO workspace_app_links
  (link_id, workspace_id, workspace_key, tenant_id, connection_id, app_key, linked_by, status, permission_mode, created_at)
SELECT
  UUID(),
  'e989a841-fce0-4ced-be76-463e8202a066',
  'tenant_owner_governance',
  'e989a841-fce0-4ced-be76-463e8202a066',
  '005060e5-958c-44c1-996c-68b6984966b1',
  'github',
  'platform_admin:0e76b224-7671-47dd-ad68-014fb042df80',
  'active',
  'strict',
  NOW()
WHERE EXISTS (
  SELECT 1 FROM workspace_registry
   WHERE workspace_id = 'e989a841-fce0-4ced-be76-463e8202a066'
     AND tenant_id = 'e989a841-fce0-4ced-be76-463e8202a066'
     AND bootstrap_status = 'ready'
)
AND EXISTS (
  SELECT 1 FROM user_app_connections
   WHERE connection_id = '005060e5-958c-44c1-996c-68b6984966b1'
     AND tenant_id = 'e989a841-fce0-4ced-be76-463e8202a066'
     AND app_key = 'github'
     AND status = 'active'
)
AND NOT EXISTS (
  SELECT 1 FROM workspace_app_links
   WHERE workspace_id = 'e989a841-fce0-4ced-be76-463e8202a066'
     AND tenant_id = 'e989a841-fce0-4ced-be76-463e8202a066'
     AND connection_id = '005060e5-958c-44c1-996c-68b6984966b1'
     AND app_key = 'github'
     AND status = 'active'
);

INSERT INTO repository_context_bindings
  (binding_id, binding_key, tenant_id, workspace_id, brand_target_key, app_key, system_id, installation_id,
   connection_id, repository_provider, repository_owner, repository_name, repository_node_id, default_branch,
   environment, webhook_callback_url, webhook_events_json, webhook_secret_ref, is_primary, status, metadata_json, created_by)
SELECT
  UUID(),
  'growth_intelligence_platform.github.primary.production',
  'e989a841-fce0-4ced-be76-463e8202a066',
  'e989a841-fce0-4ced-be76-463e8202a066',
  'growth_intelligence_platform',
  'github',
  '9f94af7b-21da-4f36-a407-b08aeafbef97',
  NULL,
  '005060e5-958c-44c1-996c-68b6984966b1',
  'github',
  'mad4bdigital-ai',
  'multi-business-multi-role-growth-intelligence-os',
  NULL,
  'main',
  'production',
  'https://auth.mad4b.com/webhooks/github/repository-main-moved',
  JSON_ARRAY('push'),
  'ref:secret:GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET',
  1,
  'active',
  JSON_OBJECT(
    'authority_source', 'repository_context_bindings',
    'binding_version', 'repository-context-binding-v1',
    'provisioning_tool', 'github_repository_main_moved_webhook_provision',
    'resource_uri_mode', 'binding_key',
    'secrets_included', FALSE
  ),
  'migration:20260721_dynamic_repository_context_bindings'
WHERE EXISTS (SELECT 1 FROM brands WHERE target_key = 'growth_intelligence_platform')
  AND EXISTS (SELECT 1 FROM app_integrations WHERE app_key = 'github' AND status = 'active')
  AND EXISTS (SELECT 1 FROM connected_systems WHERE system_id = '9f94af7b-21da-4f36-a407-b08aeafbef97' AND status = 'active')
  AND EXISTS (SELECT 1 FROM workspace_registry WHERE workspace_id = 'e989a841-fce0-4ced-be76-463e8202a066' AND bootstrap_status = 'ready')
  AND EXISTS (SELECT 1 FROM user_app_connections WHERE connection_id = '005060e5-958c-44c1-996c-68b6984966b1' AND status = 'active')
ON DUPLICATE KEY UPDATE
  tenant_id = VALUES(tenant_id),
  workspace_id = VALUES(workspace_id),
  brand_target_key = VALUES(brand_target_key),
  app_key = VALUES(app_key),
  system_id = VALUES(system_id),
  installation_id = VALUES(installation_id),
  connection_id = VALUES(connection_id),
  repository_provider = VALUES(repository_provider),
  repository_owner = VALUES(repository_owner),
  repository_name = VALUES(repository_name),
  default_branch = VALUES(default_branch),
  environment = VALUES(environment),
  webhook_callback_url = VALUES(webhook_callback_url),
  webhook_events_json = VALUES(webhook_events_json),
  webhook_secret_ref = VALUES(webhook_secret_ref),
  is_primary = VALUES(is_primary),
  status = VALUES(status),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO capability_apply_authorization_policy_registry
  (policy_key, display_name, app_key, capability_key, operation_intent, selected_source_tier,
   selected_runtime_surface, allow_without_credential_binding, allow_local_device_execution,
   allow_provider_credential_replacement, allow_provider_installation, allow_external_write,
   allow_live_execution, active, policy_metadata_json, created_by, updated_by)
VALUES
  ('github_repository_main_moved_webhook_dynamic_binding_apply_v1',
   'GitHub repository-main-moved webhook dynamic repository binding apply',
   'github',
   'github_repository_main_moved_webhook_provision',
   'github_repository_main_moved_webhook_provision',
   'platform_managed_fallback',
   'system_layer',
   1,
   0,
   0,
   0,
   1,
   1,
   1,
   JSON_OBJECT(
     'policy_version', 'github-repository-main-moved-webhook-dynamic-binding-v1',
     'authority_source', 'repository_context_bindings',
     'require_binding_readiness', TRUE,
     'require_binding_sha256', TRUE,
     'require_resource_uri_match', TRUE,
     'require_same_cycle_dry_run', TRUE,
     'require_typed_confirmation', TRUE,
     'require_signed_ping_status_200', TRUE,
     'require_hook_readback', TRUE,
     'require_envelope_atomic_claim', TRUE,
     'secrets_included', FALSE
   ),
   'migration:20260721_dynamic_repository_context_bindings',
   'migration:20260721_dynamic_repository_context_bindings')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  selected_source_tier = VALUES(selected_source_tier),
  selected_runtime_surface = VALUES(selected_runtime_surface),
  allow_without_credential_binding = VALUES(allow_without_credential_binding),
  allow_local_device_execution = VALUES(allow_local_device_execution),
  allow_provider_credential_replacement = VALUES(allow_provider_credential_replacement),
  allow_provider_installation = VALUES(allow_provider_installation),
  allow_external_write = VALUES(allow_external_write),
  allow_live_execution = VALUES(allow_live_execution),
  active = VALUES(active),
  policy_metadata_json = VALUES(policy_metadata_json),
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP;
