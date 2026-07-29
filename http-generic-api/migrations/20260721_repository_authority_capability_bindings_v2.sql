ALTER TABLE workspace_resource_grants
  MODIFY COLUMN resource_type ENUM('workspace','brand','site','app','asset','workflow','agent','vault','repository') NOT NULL;

CREATE TABLE IF NOT EXISTS repository_authority_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  binding_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  binding_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  tenant_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workspace_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  brand_target_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  system_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  installation_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  connection_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  provider_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  repository_external_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  repository_node_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  canonical_owner VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  canonical_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  default_branch VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'main',
  environment VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'production',
  system_binding_mode ENUM('same_tenant','installation_bound','shared_platform_adapter') NOT NULL,
  lifecycle_status ENUM('pending','active','disabled','archived') NOT NULL DEFAULT 'pending',
  authority_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  lock_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  metadata_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_by VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_repository_authority_binding_id (binding_id),
  UNIQUE KEY uq_repository_authority_binding_key (binding_key),
  UNIQUE KEY uq_repository_authority_provider_node_environment (provider_key, repository_node_id, environment),
  KEY idx_repository_authority_tenant_workspace (tenant_id, workspace_id, lifecycle_status),
  KEY idx_repository_authority_brand_app (brand_target_key, app_key, lifecycle_status),
  KEY idx_repository_authority_system (system_id, installation_id, connection_id, lifecycle_status),
  KEY idx_repository_authority_name (provider_key, canonical_owner, canonical_name, lifecycle_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repository_authority_aliases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  alias_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  binding_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  alias_type ENUM('binding_key','node_id','external_id','full_name','owner','name','url','legacy_ref') NOT NULL,
  alias_value VARCHAR(2048) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  normalized_alias VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  lifecycle_status ENUM('active','superseded','expired','revoked') NOT NULL DEFAULT 'active',
  valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until DATETIME NULL,
  metadata_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_repository_authority_alias_id (alias_id),
  UNIQUE KEY uq_repository_authority_alias_scope (binding_id, alias_type, normalized_alias),
  KEY idx_repository_authority_alias_lookup (normalized_alias, lifecycle_status),
  KEY idx_repository_authority_alias_binding (binding_id, lifecycle_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repository_capability_bindings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  capability_binding_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  capability_binding_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  repository_binding_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  capability_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  operation_intent VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  business_activity_type_key VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  adapter_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  policy_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  readback_contract_key VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  credential_ref VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  effect_class ENUM('read','internal_write','external_write','live_execution') NOT NULL,
  configuration_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  lifecycle_status ENUM('pending','active','disabled','archived') NOT NULL DEFAULT 'pending',
  capability_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  lock_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  metadata_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_by VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_repository_capability_binding_id (capability_binding_id),
  UNIQUE KEY uq_repository_capability_binding_key (capability_binding_key),
  UNIQUE KEY uq_repository_capability_scope (repository_binding_id, capability_key),
  KEY idx_repository_capability_repo (repository_binding_id, lifecycle_status),
  KEY idx_repository_capability_operation (capability_key, operation_intent, lifecycle_status),
  KEY idx_repository_capability_adapter (adapter_key, readback_contract_key, lifecycle_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS repository_capability_policy_layers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  layer_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  capability_binding_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  scope_type ENUM('platform','tenant','workspace','brand','app','repository','environment') NOT NULL,
  scope_ref VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  precedence SMALLINT UNSIGNED NOT NULL,
  configuration_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  lifecycle_status ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  layer_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  lock_version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  metadata_json LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_by VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_repository_capability_layer_id (layer_id),
  UNIQUE KEY uq_repository_capability_layer_scope (capability_binding_id, scope_type, scope_ref),
  KEY idx_repository_capability_layer_order (capability_binding_id, precedence, lifecycle_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_repository_authority_binding_readiness AS
SELECT
  resolved.*,
  CASE
    WHEN resolved.lifecycle_status <> 'active' THEN 'repository_binding_inactive'
    WHEN resolved.repository_node_id = '' OR resolved.repository_external_id = '' THEN 'repository_identity_missing'
    WHEN resolved.brand_rows <> 1 THEN 'repository_brand_unresolved'
    WHEN resolved.app_rows <> 1 THEN 'repository_app_unresolved'
    WHEN resolved.workspace_rows <> 1 THEN 'repository_workspace_unresolved'
    WHEN resolved.workspace_app_link_rows <> 1 THEN 'repository_workspace_app_link_unresolved'
    WHEN resolved.system_authority_rows <> 1 THEN 'repository_system_authority_unresolved'
    WHEN resolved.installation_rows <> 1 THEN 'repository_installation_unresolved'
    WHEN resolved.connection_rows <> 1 THEN 'repository_connection_unresolved'
    WHEN resolved.node_alias_rows <> 1 THEN 'repository_node_alias_unresolved'
    WHEN resolved.full_name_alias_rows <> 1 THEN 'repository_full_name_alias_unresolved'
    WHEN resolved.metadata_json IS NOT NULL AND JSON_VALID(resolved.metadata_json) = 0 THEN 'repository_metadata_invalid'
    ELSE NULL
  END AS issue_code,
  CASE
    WHEN resolved.lifecycle_status = 'active'
      AND resolved.repository_node_id <> ''
      AND resolved.repository_external_id <> ''
      AND resolved.brand_rows = 1
      AND resolved.app_rows = 1
      AND resolved.workspace_rows = 1
      AND resolved.workspace_app_link_rows = 1
      AND resolved.system_authority_rows = 1
      AND resolved.installation_rows = 1
      AND resolved.connection_rows = 1
      AND resolved.node_alias_rows = 1
      AND resolved.full_name_alias_rows = 1
      AND (resolved.metadata_json IS NULL OR JSON_VALID(resolved.metadata_json) = 1)
    THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status
FROM (
  SELECT
    binding.*,
    CASE WHEN binding.brand_target_key IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM brands brand
        WHERE brand.target_key COLLATE utf8mb4_unicode_ci = binding.brand_target_key COLLATE utf8mb4_unicode_ci
          AND LOWER(COALESCE(brand.status, 'active')) NOT IN ('archived','disabled','inactive')) END AS brand_rows,
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
    CASE binding.system_binding_mode
      WHEN 'same_tenant' THEN
        (SELECT COUNT(*) FROM connected_systems system
          WHERE system.system_id COLLATE utf8mb4_unicode_ci = binding.system_id COLLATE utf8mb4_unicode_ci
            AND system.tenant_id COLLATE utf8mb4_unicode_ci = binding.tenant_id COLLATE utf8mb4_unicode_ci
            AND system.status = 'active')
      WHEN 'installation_bound' THEN
        (SELECT COUNT(*) FROM installations installation
          WHERE installation.installation_id COLLATE utf8mb4_unicode_ci = binding.installation_id COLLATE utf8mb4_unicode_ci
            AND installation.system_id COLLATE utf8mb4_unicode_ci = binding.system_id COLLATE utf8mb4_unicode_ci
            AND installation.tenant_id COLLATE utf8mb4_unicode_ci = binding.tenant_id COLLATE utf8mb4_unicode_ci
            AND installation.status = 'active')
      WHEN 'shared_platform_adapter' THEN
        (SELECT COUNT(*) FROM connected_systems system
          WHERE system.system_id COLLATE utf8mb4_unicode_ci = binding.system_id COLLATE utf8mb4_unicode_ci
            AND system.status = 'active'
            AND system.managed_capable = 1)
      ELSE 0
    END AS system_authority_rows,
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
    (SELECT COUNT(*) FROM repository_authority_aliases alias
      WHERE alias.binding_id COLLATE utf8mb4_unicode_ci = binding.binding_id COLLATE utf8mb4_unicode_ci
        AND alias.alias_type = 'node_id'
        AND alias.normalized_alias COLLATE utf8mb4_unicode_ci = LOWER(binding.repository_node_id) COLLATE utf8mb4_unicode_ci
        AND alias.lifecycle_status = 'active') AS node_alias_rows,
    (SELECT COUNT(*) FROM repository_authority_aliases alias
      WHERE alias.binding_id COLLATE utf8mb4_unicode_ci = binding.binding_id COLLATE utf8mb4_unicode_ci
        AND alias.alias_type = 'full_name'
        AND alias.normalized_alias COLLATE utf8mb4_unicode_ci = LOWER(CONCAT(binding.canonical_owner, '/', binding.canonical_name)) COLLATE utf8mb4_unicode_ci
        AND alias.lifecycle_status = 'active') AS full_name_alias_rows
  FROM repository_authority_bindings binding
) resolved;

CREATE OR REPLACE VIEW v_repository_capability_binding_readiness AS
SELECT
  resolved.*,
  CASE
    WHEN resolved.lifecycle_status <> 'active' THEN 'repository_capability_inactive'
    WHEN resolved.repository_readiness_status <> 'ready' THEN COALESCE(resolved.repository_issue_code, 'repository_authority_not_ready')
    WHEN resolved.configuration_json IS NOT NULL AND JSON_VALID(resolved.configuration_json) = 0 THEN 'repository_capability_configuration_invalid'
    WHEN resolved.business_activity_rows <> 1 THEN 'repository_capability_business_activity_unresolved'
    WHEN resolved.adapter_rows <> 1 THEN 'repository_capability_adapter_unresolved'
    WHEN resolved.readback_contract_rows <> 1 THEN 'repository_capability_readback_unresolved'
    WHEN resolved.apply_policy_rows <> 1 THEN 'repository_capability_policy_unresolved'
    WHEN resolved.credential_reference_rows <> 1 THEN 'repository_capability_credential_unresolved'
    WHEN resolved.active_policy_layer_rows < 1 THEN 'repository_capability_inheritance_layers_missing'
    ELSE NULL
  END AS issue_code,
  CASE
    WHEN resolved.lifecycle_status = 'active'
      AND resolved.repository_readiness_status = 'ready'
      AND (resolved.configuration_json IS NULL OR JSON_VALID(resolved.configuration_json) = 1)
      AND resolved.business_activity_rows = 1
      AND resolved.adapter_rows = 1
      AND resolved.readback_contract_rows = 1
      AND resolved.apply_policy_rows = 1
      AND resolved.credential_reference_rows = 1
      AND resolved.active_policy_layer_rows >= 1
    THEN 'ready'
    ELSE 'blocked'
  END AS readiness_status
FROM (
  SELECT
    capability.*,
    authority.binding_key,
    authority.tenant_id,
    authority.workspace_id,
    authority.brand_target_key,
    authority.app_key,
    authority.provider_key,
    authority.repository_external_id,
    authority.repository_node_id,
    authority.canonical_owner,
    authority.canonical_name,
    authority.default_branch,
    authority.environment,
    authority.system_binding_mode,
    authority.readiness_status AS repository_readiness_status,
    authority.issue_code AS repository_issue_code,
    CASE WHEN capability.business_activity_type_key IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM business_activity_types activity
        WHERE activity.business_activity_type_key COLLATE utf8mb4_unicode_ci = capability.business_activity_type_key COLLATE utf8mb4_unicode_ci
          AND LOWER(COALESCE(activity.status, 'active')) = 'active') END AS business_activity_rows,
    (SELECT COUNT(*) FROM platform_resource_adapters adapter
      WHERE adapter.adapter_key COLLATE utf8mb4_unicode_ci = capability.adapter_key COLLATE utf8mb4_unicode_ci
        AND adapter.status = 'active') AS adapter_rows,
    CASE WHEN capability.readback_contract_key IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM platform_capability_readback_contracts contract
        WHERE contract.contract_key COLLATE utf8mb4_unicode_ci = capability.readback_contract_key COLLATE utf8mb4_unicode_ci
          AND contract.capability_key COLLATE utf8mb4_unicode_ci = capability.capability_key COLLATE utf8mb4_unicode_ci
          AND contract.is_current = 1
          AND contract.status IN ('certified','shadow')) END AS readback_contract_rows,
    CASE WHEN capability.policy_key IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM capability_apply_authorization_policy_registry policy
        WHERE policy.policy_key COLLATE utf8mb4_unicode_ci = capability.policy_key COLLATE utf8mb4_unicode_ci
          AND policy.app_key COLLATE utf8mb4_unicode_ci = authority.app_key COLLATE utf8mb4_unicode_ci
          AND policy.capability_key COLLATE utf8mb4_unicode_ci = capability.capability_key COLLATE utf8mb4_unicode_ci
          AND policy.operation_intent COLLATE utf8mb4_unicode_ci = capability.operation_intent COLLATE utf8mb4_unicode_ci
          AND policy.runtime_surface = 'system_layer'
          AND policy.status = 'active') END AS apply_policy_rows,
    CASE WHEN capability.credential_ref IS NULL THEN 1 ELSE
      (SELECT COUNT(*) FROM secret_references secret_ref
        WHERE secret_ref.secret_key COLLATE utf8mb4_unicode_ci = REPLACE(capability.credential_ref, 'ref:secret:', '') COLLATE utf8mb4_unicode_ci
          AND secret_ref.tenant_id = '00000000-0000-0000-0000-000000000000'
          AND secret_ref.owner_type = 'platform'
          AND secret_ref.provider_family = 'github'
          AND secret_ref.connector_family = 'github_webhook'
          AND secret_ref.credential_type = 'webhook_secret'
          AND secret_ref.action_key = 'repository_main_moved_webhook_ingest'
          AND secret_ref.consent_status = 'not_required'
          AND secret_ref.status = 'active'
          AND secret_ref.store_type = 'db_encrypted'
          AND secret_ref.validation_status IN ('stored','validated')
          AND secret_ref.rotation_status IN ('provisioned_pending_validation','validated')) END AS credential_reference_rows,
    (SELECT COUNT(*) FROM repository_capability_policy_layers layer
      WHERE layer.capability_binding_id COLLATE utf8mb4_unicode_ci = capability.capability_binding_id COLLATE utf8mb4_unicode_ci
        AND layer.lifecycle_status = 'active'
        AND JSON_VALID(layer.configuration_json) = 1) AS active_policy_layer_rows
  FROM repository_capability_bindings capability
  JOIN v_repository_authority_binding_readiness authority
    ON authority.binding_id COLLATE utf8mb4_unicode_ci = capability.repository_binding_id COLLATE utf8mb4_unicode_ci
) resolved;

INSERT INTO platform_resource_adapters
  (adapter_key, resource_type, provider_key, adapter_kind, installed_tool_key, identity_resolver_key,
   metadata_normalizer_key, children_normalizer_key, content_policy, supports_plan, supports_read,
   supports_write, status, metadata_json, created_at, updated_at)
VALUES
  ('repository_authority_db_v2', 'repository', NULL, 'db_adapter', NULL,
   'platform_resource_context_resolve', 'repository_authority_normalizer_v2',
   'repository_capability_children_normalizer_v2', 'metadata_only', 1, 1, 0, 'active',
   JSON_OBJECT('authority_source','repository_authority_bindings','alias_source','repository_authority_aliases','capability_source','repository_capability_bindings','secrets_included',FALSE), NOW(), NOW()),
  ('github_repository_webhook_v2', 'repository', 'github', 'composite',
   'github_repository_main_moved_webhook_provision', 'platform_resource_context_resolve',
   'github_repository_webhook_normalizer_v2', 'repository_capability_children_normalizer_v2',
   'metadata_only', 1, 1, 1, 'active',
   JSON_OBJECT('provider','github','effect_class','external_write','credential_transport','server_side_reference_only','secrets_included',FALSE), NOW(), NOW())
ON DUPLICATE KEY UPDATE
  resource_type = VALUES(resource_type), provider_key = VALUES(provider_key), adapter_kind = VALUES(adapter_kind),
  installed_tool_key = VALUES(installed_tool_key), identity_resolver_key = VALUES(identity_resolver_key),
  metadata_normalizer_key = VALUES(metadata_normalizer_key), children_normalizer_key = VALUES(children_normalizer_key),
  content_policy = VALUES(content_policy), supports_plan = VALUES(supports_plan), supports_read = VALUES(supports_read),
  supports_write = VALUES(supports_write), status = VALUES(status), metadata_json = VALUES(metadata_json), updated_at = NOW();

INSERT INTO platform_capability_readback_contracts
  (contract_id, contract_key, contract_version, capability_key, adapter_key, verification_type,
   acknowledgement_required, verification_required, expected_effect_class, input_schema_json,
   observed_state_schema_json, provider_binding_constraints_json, certification_status, status,
   is_current, current_contract_key, valid_from, expires_at, revoked_at, source_registry, source_key,
   secrets_included, created_at, updated_at)
VALUES
  (UUID(), 'github_repository_main_moved_webhook_readback_v2', 1,
   'github_repository_main_moved_webhook_provision', 'github_repository_webhook_v2',
   'provider_signed_delivery_and_configuration_readback', 1, 1, 'external_write',
   JSON_OBJECT('type','object','required',JSON_ARRAY('binding_key','binding_sha256','capability_sha256','expected_commit_sha')),
   JSON_OBJECT('type','object','required',JSON_ARRAY('hook_id','callback_url','events','active','ping_status_code','signature_verified')),
   JSON_OBJECT('provider','github','require_repository_node_id',TRUE,'require_hook_readback',TRUE,'require_signed_ping_status',200,'secrets_included',FALSE),
   'certified', 'certified', 1, 'github_repository_main_moved_webhook_readback_v2', NOW(), NULL, NULL,
   'repository_capability_bindings', 'github_repository_main_moved_webhook', 0, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  contract_version = VALUES(contract_version), capability_key = VALUES(capability_key), adapter_key = VALUES(adapter_key),
  verification_type = VALUES(verification_type), acknowledgement_required = VALUES(acknowledgement_required),
  verification_required = VALUES(verification_required), expected_effect_class = VALUES(expected_effect_class),
  input_schema_json = VALUES(input_schema_json), observed_state_schema_json = VALUES(observed_state_schema_json),
  provider_binding_constraints_json = VALUES(provider_binding_constraints_json), certification_status = VALUES(certification_status),
  status = VALUES(status), is_current = VALUES(is_current), source_registry = VALUES(source_registry),
  source_key = VALUES(source_key), secrets_included = 0, updated_at = NOW();

INSERT INTO capability_apply_authorization_policy_registry
  (policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
   allow_external_write, allow_credential_binding, allow_no_credential_binding,
   requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
   requires_audit_evidence, requires_readback, requires_typed_confirmation,
   requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes,
   created_at, updated_at)
VALUES
  ('github_repository_main_moved_webhook_dynamic_binding_apply_v2',
   'github', 'github_repository_main_moved_webhook_provision',
   'github_repository_main_moved_webhook_provision', 'system_layer', 'active',
   1, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT(
     'authority_source','repository_authority_bindings',
     'capability_source','repository_capability_bindings',
     'external_write_allowed',TRUE,
     'provider_call_allowed',TRUE,
     'provider_call_surface','github_app.repository_hooks.create_or_update_and_ping',
     'readback_surface','github_app.repository_hooks.get_and_deliveries',
     'require_resource_uri_match',TRUE,
     'require_binding_sha256',TRUE,
     'require_capability_sha256',TRUE,
     'require_same_cycle_dry_run',TRUE,
     'require_typed_confirmation',TRUE,
     'require_atomic_claim',TRUE,
     'require_signed_ping_status',200,
     'require_hook_readback',TRUE,
     'credential_payload_return_allowed',FALSE,
     'server_side_reference_resolution_allowed',TRUE,
     'inline_sensitive_input_allowed',FALSE,
     'secrets_included',FALSE),
   'Repository capability V2 apply policy for the governed GitHub repository-main-moved webhook. Secret references resolve server-side and provider readback is mandatory.',
   NOW(), NOW())
ON DUPLICATE KEY UPDATE
  app_key = VALUES(app_key), capability_key = VALUES(capability_key),
  operation_intent = VALUES(operation_intent), runtime_surface = VALUES(runtime_surface),
  status = VALUES(status), allow_external_write = VALUES(allow_external_write),
  allow_credential_binding = VALUES(allow_credential_binding),
  allow_no_credential_binding = VALUES(allow_no_credential_binding),
  requires_ready_for_dispatch = VALUES(requires_ready_for_dispatch),
  requires_dispatch_allowed = VALUES(requires_dispatch_allowed),
  requires_zero_blocking_gaps = VALUES(requires_zero_blocking_gaps),
  requires_audit_evidence = VALUES(requires_audit_evidence),
  requires_readback = VALUES(requires_readback),
  requires_typed_confirmation = VALUES(requires_typed_confirmation),
  requires_same_cycle_dry_run = VALUES(requires_same_cycle_dry_run),
  allowed_source_tiers_json = VALUES(allowed_source_tiers_json),
  policy_json = VALUES(policy_json), notes = VALUES(notes), updated_at = NOW();

INSERT INTO workspace_app_links
  (link_id, workspace_id, workspace_key, tenant_id, connection_id, app_key, linked_by, status, permission_mode, created_at)
SELECT UUID(), 'e989a841-fce0-4ced-be76-463e8202a066', 'tenant_owner_governance',
       'e989a841-fce0-4ced-be76-463e8202a066', '005060e5-958c-44c1-996c-68b6984966b1',
       'github', 'platform_admin:0e76b224-7671-47dd-ad68-014fb042df80', 'active', 'strict', NOW()
WHERE EXISTS (SELECT 1 FROM workspace_registry WHERE workspace_id='e989a841-fce0-4ced-be76-463e8202a066' AND bootstrap_status='ready')
  AND EXISTS (SELECT 1 FROM user_app_connections WHERE connection_id='005060e5-958c-44c1-996c-68b6984966b1' AND status='active')
  AND NOT EXISTS (SELECT 1 FROM workspace_app_links WHERE workspace_id='e989a841-fce0-4ced-be76-463e8202a066' AND connection_id='005060e5-958c-44c1-996c-68b6984966b1' AND app_key='github' AND status='active');

INSERT INTO repository_authority_bindings
  (binding_id, binding_key, tenant_id, workspace_id, brand_target_key, app_key, system_id,
   installation_id, connection_id, provider_key, repository_external_id, repository_node_id,
   canonical_owner, canonical_name, default_branch, environment, system_binding_mode,
   lifecycle_status, authority_version, lock_version, is_primary, metadata_json, created_by)
VALUES
  (UUID(), 'growth_intelligence_platform.github.primary.production',
   'e989a841-fce0-4ced-be76-463e8202a066', 'e989a841-fce0-4ced-be76-463e8202a066',
   'growth_intelligence_platform', 'github', '9f94af7b-21da-4f36-a407-b08aeafbef97',
   NULL, '005060e5-958c-44c1-996c-68b6984966b1', 'github', '1213257854', 'R_kgDOSFDYfg',
   'mad4bdigital-ai', 'multi-business-multi-role-growth-intelligence-os', 'main', 'production',
   'shared_platform_adapter', 'active', 1, 1, 1,
   JSON_OBJECT('authority_model','repository-authority-v2','immutable_identity','provider+repository_node_id',
     'inheritance_order',JSON_ARRAY('platform','tenant','workspace','brand','app','repository','environment'),
     'provider_verified_at','2026-07-21T20:54:06Z','secrets_included',FALSE),
   'migration:20260721_repository_authority_capability_bindings_v2')
ON DUPLICATE KEY UPDATE
  tenant_id=VALUES(tenant_id), workspace_id=VALUES(workspace_id), brand_target_key=VALUES(brand_target_key),
  app_key=VALUES(app_key), system_id=VALUES(system_id), installation_id=VALUES(installation_id),
  connection_id=VALUES(connection_id), repository_external_id=VALUES(repository_external_id),
  repository_node_id=VALUES(repository_node_id), canonical_owner=VALUES(canonical_owner),
  canonical_name=VALUES(canonical_name), default_branch=VALUES(default_branch), environment=VALUES(environment),
  system_binding_mode=VALUES(system_binding_mode), lifecycle_status=VALUES(lifecycle_status), is_primary=VALUES(is_primary),
  metadata_json=VALUES(metadata_json), authority_version=repository_authority_bindings.authority_version+1, lock_version=repository_authority_bindings.lock_version+1, updated_at=NOW();

INSERT INTO repository_authority_aliases
  (alias_id, binding_id, alias_type, alias_value, normalized_alias, lifecycle_status, metadata_json)
SELECT UUID(), binding.binding_id, aliases.alias_type, aliases.alias_value, LOWER(aliases.normalized_alias), 'active',
       JSON_OBJECT('source','migration_seed','secrets_included',FALSE)
FROM repository_authority_bindings binding
JOIN (
  SELECT 'binding_key' AS alias_type, 'growth_intelligence_platform.github.primary.production' AS alias_value, 'growth_intelligence_platform.github.primary.production' AS normalized_alias
  UNION ALL SELECT 'node_id','R_kgDOSFDYfg','r_kgdosfdyfg'
  UNION ALL SELECT 'external_id','1213257854','1213257854'
  UNION ALL SELECT 'full_name','mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os','mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os'
  UNION ALL SELECT 'url','https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os','github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os'
) aliases
WHERE binding.binding_key='growth_intelligence_platform.github.primary.production'
ON DUPLICATE KEY UPDATE alias_value=VALUES(alias_value), lifecycle_status='active', valid_until=NULL, metadata_json=VALUES(metadata_json), updated_at=NOW();

INSERT INTO repository_capability_bindings
  (capability_binding_id, capability_binding_key, repository_binding_id, capability_key, operation_intent,
   business_activity_type_key, adapter_key, policy_key, readback_contract_key, credential_ref, effect_class,
   configuration_json, lifecycle_status, capability_version, lock_version, is_primary, metadata_json, created_by)
SELECT UUID(), 'growth_intelligence_platform.github.repository_main_moved_webhook.production', binding.binding_id,
       'github_repository_main_moved_webhook_provision', 'github_repository_main_moved_webhook_provision',
       'software', 'github_repository_webhook_v2',
       'github_repository_main_moved_webhook_dynamic_binding_apply_v2',
       'github_repository_main_moved_webhook_readback_v2',
       'ref:secret:GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET', 'external_write',
       JSON_OBJECT('hook_name','web','content_type','json','insecure_ssl','0'),
       'active', 1, 1, 1,
       JSON_OBJECT('capability_model','repository-capability-v2','server_side_secret_resolution',TRUE,
         'requires_provider_readback',TRUE,'secrets_included',FALSE),
       'migration:20260721_repository_authority_capability_bindings_v2'
FROM repository_authority_bindings binding
WHERE binding.binding_key='growth_intelligence_platform.github.primary.production'
ON DUPLICATE KEY UPDATE
  repository_binding_id=VALUES(repository_binding_id), business_activity_type_key=VALUES(business_activity_type_key),
  adapter_key=VALUES(adapter_key), policy_key=VALUES(policy_key), readback_contract_key=VALUES(readback_contract_key),
  credential_ref=VALUES(credential_ref), effect_class=VALUES(effect_class), configuration_json=VALUES(configuration_json),
  lifecycle_status='active', metadata_json=VALUES(metadata_json),
  capability_version=repository_capability_bindings.capability_version+1,
  lock_version=repository_capability_bindings.lock_version+1, updated_at=NOW();

INSERT INTO repository_capability_policy_layers
  (layer_id, capability_binding_id, scope_type, scope_ref, precedence, configuration_json,
   lifecycle_status, layer_version, lock_version, metadata_json, created_by)
SELECT UUID(), capability.capability_binding_id, layers.scope_type, layers.scope_ref, layers.precedence,
       layers.configuration_json, 'active', 1, 1,
       JSON_OBJECT('source','migration_seed','deterministic_inheritance',TRUE,'secrets_included',FALSE),
       'migration:20260721_repository_authority_capability_bindings_v2'
FROM repository_capability_bindings capability
JOIN (
  SELECT 'platform' AS scope_type, '*' AS scope_ref, 100 AS precedence,
         JSON_OBJECT('security',JSON_OBJECT('require_signed_ping',TRUE,'required_ping_status',200,'require_readback',TRUE),'retry',JSON_OBJECT('max_attempts',3)) AS configuration_json
  UNION ALL SELECT 'brand','growth_intelligence_platform',400,JSON_OBJECT('events',JSON_ARRAY('push'))
  UNION ALL SELECT 'repository','growth_intelligence_platform.github.primary.production',600,
         JSON_OBJECT('callback_url','https://auth.mad4b.com/webhooks/github/repository-main-moved')
  UNION ALL SELECT 'environment','production',700,JSON_OBJECT('active',TRUE)
) layers
WHERE capability.capability_binding_key='growth_intelligence_platform.github.repository_main_moved_webhook.production'
ON DUPLICATE KEY UPDATE precedence=VALUES(precedence), configuration_json=VALUES(configuration_json),
  lifecycle_status='active',
  layer_version=repository_capability_policy_layers.layer_version+1,
  lock_version=repository_capability_policy_layers.lock_version+1,
  metadata_json=VALUES(metadata_json), updated_at=NOW();

INSERT INTO workspace_resource_grants
  (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source,
   granted_by, granted_at, metadata_json, created_at, updated_at)
SELECT UUID(), 'e989a841-fce0-4ced-be76-463e8202a066', '0e76b224-7671-47dd-ad68-014fb042df80',
       'repository', 'growth_intelligence_platform.github.primary.production', 'owner', 'active',
       'owner_assignment', '0e76b224-7671-47dd-ad68-014fb042df80', NOW(),
       JSON_OBJECT('authority_source','repository_authority_bindings','inheritance_enabled',TRUE,'secrets_included',FALSE), NOW(), NOW()
WHERE EXISTS (SELECT 1 FROM memberships WHERE tenant_id='e989a841-fce0-4ced-be76-463e8202a066' AND user_id='0e76b224-7671-47dd-ad68-014fb042df80' AND role='owner' AND status='active')
  AND NOT EXISTS (SELECT 1 FROM workspace_resource_grants WHERE tenant_id='e989a841-fce0-4ced-be76-463e8202a066' AND grantee_user_id='0e76b224-7671-47dd-ad68-014fb042df80' AND resource_type='repository' AND resource_ref='growth_intelligence_platform.github.primary.production' AND status='active');
