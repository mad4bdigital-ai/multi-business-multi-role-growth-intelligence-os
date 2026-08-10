-- Platform runtime/registry drift reconciliation — 2026-08-10
--
-- Safety contract:
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- no_runtime_dispatch=true
-- secrets_included=false
--
-- Purpose:
-- 1. Keep platform_plugin_capabilities as the single canonical capability identity.
-- 2. Backfill active platform_semantic_capabilities into that canonical identity only
--    when no canonical row exists, with dispatch/apply disabled by default.
-- 3. Link every semantic row to the canonical graph through explicit provenance.
-- 4. Repair WordPress action/diagnostic registry bindings without creating a second
--    wordpress_api action or exposing the shadow semantic draft binding as a live tool.
-- 5. Provide fail-closed reconciliation views for release/readiness checks.

INSERT INTO platform_plugins (
  plugin_key, display_name, plugin_family, source_kind, owner_scope, trust_level,
  status, version, manifest_json, governance_policy_key, credential_policy_key,
  runtime_policy_key, source_table, source_key
) VALUES (
  'semantic_capability_registry',
  'Semantic Capability Registry',
  'semantic_registry',
  'sql_registry',
  'internal',
  'governed',
  'active',
  '1',
  JSON_OBJECT(
    'canonical_identity_table','platform_plugin_capabilities',
    'semantic_source_table','platform_semantic_capabilities',
    'semantic_rows_grant_dispatch',FALSE,
    'semantic_rows_grant_apply',FALSE,
    'secrets_included',FALSE
  ),
  'semantic_capability_canonical_reconciliation_v1',
  'connection_ownership_context_kernel_v1',
  'semantic_capability_shadow_first_v1',
  'platform_semantic_capabilities',
  'semantic_capability_registry'
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  plugin_family=VALUES(plugin_family),
  source_kind=VALUES(source_kind),
  owner_scope=VALUES(owner_scope),
  trust_level=VALUES(trust_level),
  status=VALUES(status),
  manifest_json=VALUES(manifest_json),
  governance_policy_key=VALUES(governance_policy_key),
  credential_policy_key=VALUES(credential_policy_key),
  runtime_policy_key=VALUES(runtime_policy_key),
  source_table=VALUES(source_table),
  source_key=VALUES(source_key),
  updated_at=CURRENT_TIMESTAMP;

-- Missing semantic identities are represented in the canonical graph, but they
-- remain non-dispatchable/non-applicable until the normal assurance graph and
-- certification authorities explicitly promote them.
INSERT INTO platform_plugin_capabilities (
  capability_key, plugin_key, display_name, capability_family,
  source_table, source_key, operation_class, risk_class, runtime_status,
  exposure_scope, authority_requirement_type, resource_authority_required,
  dispatch_allowed, apply_allowed, requires_audit_evidence, requires_readback,
  legacy_evidence_ref, metadata_json, status
)
SELECT
  s.capability_key,
  'semantic_capability_registry',
  s.display_name,
  CONCAT('semantic.', s.resource_type),
  'platform_semantic_capabilities',
  s.capability_key,
  CONCAT('semantic.', s.operation_key),
  s.risk_class,
  s.status,
  'shadow',
  CASE
    WHEN s.requires_workspace_authority = 1 AND s.requires_approval = 1 THEN 'combined'
    WHEN s.requires_workspace_authority = 1 THEN 'resource'
    WHEN s.requires_approval = 1 THEN 'approval'
    ELSE 'none'
  END,
  s.requires_workspace_authority,
  0,
  0,
  s.requires_audit_evidence,
  s.requires_readback,
  CONCAT('semantic_registry:', s.capability_key),
  JSON_OBJECT(
    'semantic_registry_source',TRUE,
    'semantic_schema_version',s.schema_version,
    'default_execution_mode',s.default_execution_mode,
    'requires_connection',s.requires_connection,
    'default_policy_key',s.default_policy_key,
    'shadow_first',TRUE,
    'dispatch_apply_must_be_promoted_elsewhere',TRUE,
    'secrets_included',FALSE
  ),
  s.status
FROM platform_semantic_capabilities s
LEFT JOIN platform_plugin_capabilities c
  ON BINARY c.capability_key <=> BINARY s.capability_key
WHERE s.status='active'
  AND c.capability_key IS NULL;

-- Explicit provenance is required even when the canonical row predates the
-- semantic registry. Exact capability_key identity is intentionally used; no
-- fuzzy or first-row mapping is allowed.
INSERT INTO platform_capability_source_links (
  link_id, capability_key, source_kind, source_ref, source_sha,
  resolution_status, confidence, evidence_id, metadata_json
)
SELECT
  SHA2(CONCAT('semantic_registry|', s.capability_key), 256),
  c.capability_key,
  'semantic_registry',
  CONCAT('platform_semantic_capabilities:', s.capability_key),
  SHA2(CONCAT_WS('|',
    s.capability_key,
    s.resource_type,
    s.operation_key,
    s.risk_class,
    s.schema_version,
    s.status,
    s.requires_connection,
    s.requires_workspace_authority,
    s.requires_approval,
    s.requires_audit_evidence,
    s.requires_readback
  ), 256),
  'resolved',
  1.0000,
  NULL,
  JSON_OBJECT(
    'mapping_mode','exact_capability_key',
    'semantic_source_table','platform_semantic_capabilities',
    'canonical_target_table','platform_plugin_capabilities',
    'semantic_is_canonical_authority',FALSE,
    'secrets_included',FALSE
  )
FROM platform_semantic_capabilities s
JOIN platform_plugin_capabilities c
  ON BINARY c.capability_key <=> BINARY s.capability_key
WHERE s.status='active'
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),
  source_kind=VALUES(source_kind),
  source_ref=VALUES(source_ref),
  source_sha=VALUES(source_sha),
  resolution_status=VALUES(resolution_status),
  confidence=VALUES(confidence),
  metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_platform_semantic_capability_canonical_reconciliation AS
SELECT
  s.capability_key,
  s.resource_type,
  s.operation_key,
  s.risk_class AS semantic_risk_class,
  s.requires_workspace_authority,
  s.requires_approval,
  s.requires_audit_evidence,
  s.requires_readback,
  s.status AS semantic_status,
  c.plugin_key AS canonical_plugin_key,
  c.risk_class AS canonical_risk_class,
  c.authority_requirement_type,
  c.resource_authority_required,
  c.requires_audit_evidence AS canonical_requires_audit_evidence,
  c.requires_readback AS canonical_requires_readback,
  c.dispatch_allowed,
  c.apply_allowed,
  c.status AS canonical_status,
  l.link_id AS semantic_source_link_id,
  l.resolution_status AS semantic_source_resolution_status,
  CASE
    WHEN c.capability_key IS NULL THEN 'canonical_identity_missing'
    WHEN l.link_id IS NULL OR l.resolution_status <> 'resolved' THEN 'semantic_source_link_missing'
    WHEN LOWER(COALESCE(c.status,'')) <> 'active' THEN 'canonical_identity_inactive'
    WHEN UPPER(COALESCE(c.risk_class,'')) <> UPPER(COALESCE(s.risk_class,'')) THEN 'risk_class_mismatch'
    WHEN s.requires_workspace_authority = 1 AND c.resource_authority_required <> 1 THEN 'resource_authority_underclassified'
    WHEN s.requires_approval = 1 AND c.authority_requirement_type NOT IN ('approval','combined') THEN 'approval_underclassified'
    WHEN s.requires_audit_evidence = 1 AND c.requires_audit_evidence <> 1 THEN 'audit_evidence_underclassified'
    WHEN s.requires_readback = 1 AND c.requires_readback <> 1 THEN 'readback_underclassified'
    ELSE 'pass'
  END AS reconciliation_status
FROM platform_semantic_capabilities s
LEFT JOIN platform_plugin_capabilities c
  ON BINARY c.capability_key <=> BINARY s.capability_key
LEFT JOIN platform_capability_source_links l
  ON BINARY l.capability_key <=> BINARY s.capability_key
 AND l.source_kind='semantic_registry'
 AND BINARY l.source_ref <=> BINARY CONCAT('platform_semantic_capabilities:', s.capability_key)
WHERE s.status='active';

-- WordPress action identity already exists. Reassert its canonical app binding
-- instead of inserting a second wordpress action.
INSERT INTO app_integration_action_bindings (
  binding_id, app_key, action_key, binding_role, credential_source,
  exposure_default, status, notes
) VALUES (
  'bind_wordpress_rest_wordpress_api',
  'wordpress_rest',
  'wordpress_api',
  'primary_api',
  'user_connection',
  'runtime_only',
  'active',
  'Canonical WordPress REST action binding. Runtime exposure remains governed by endpoint/capability/export/certification authorities.'
)
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),
  action_key=VALUES(action_key),
  binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),
  exposure_default=VALUES(exposure_default),
  status=VALUES(status),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

-- The existing admin diagnostic becomes discoverable from the WordPress app
-- taxonomy. This does not expose credentials and does not make publish callable.
INSERT INTO app_integration_tool_bindings (
  binding_id, app_key, tool_key, tool_surface, binding_role,
  credential_source, exposure_scope, status, notes
) VALUES (
  'bind_tool_wordpress_publish_authority_diagnostic',
  'wordpress_rest',
  'wordpress_publish_authority_diagnostic',
  'admin_platform_tool',
  'diagnostic',
  'user_connection',
  'admin',
  'active',
  'Read-only/no-secret WordPress publish authority diagnostic bound to the canonical wordpress_rest app taxonomy.'
)
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),
  tool_key=VALUES(tool_key),
  tool_surface=VALUES(tool_surface),
  binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),
  exposure_scope=VALUES(exposure_scope),
  status=VALUES(status),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

-- Record the semantic WordPress draft projection in the canonical assurance
-- graph as shadow metadata only. platform_plugin_capability_exports is a
-- capability graph descriptor; it is not platform_endpoint_tool_exports and
-- therefore does not create a callable tenant mutation surface.
INSERT INTO platform_plugin_capability_exports (
  export_key, capability_key, export_surface, source_table, source_key,
  export_status, exposure_scope, http_method, http_path, notes
)
SELECT
  'semantic_shadow__content_article_create_draft__wordpress',
  c.capability_key,
  'semantic_shadow_projection',
  'platform_capability_provider_bindings',
  b.binding_id,
  'shadow',
  'tenant',
  e.method,
  e.endpoint_path_or_function,
  'Shadow descriptor only. Does not create platform_endpoint_tool_exports or grant WordPress provider dispatch/apply.'
FROM platform_plugin_capabilities c
JOIN platform_capability_provider_bindings b
  ON BINARY b.capability_key <=> BINARY c.capability_key
 AND b.binding_id='semantic-wordpress-create-draft-v1'
 AND b.status='active'
 AND b.rollout_mode='shadow'
LEFT JOIN endpoints e
  ON e.parent_action_key=b.parent_action_key
 AND e.endpoint_key=b.endpoint_key
 AND e.status='active'
WHERE c.capability_key='content.article.create_draft'
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),
  export_surface=VALUES(export_surface),
  source_table=VALUES(source_table),
  source_key=VALUES(source_key),
  export_status=VALUES(export_status),
  exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_wordpress_registry_runtime_reconciliation AS
SELECT
  'wordpress_rest' AS app_key,
  'wordpress_api' AS action_key,
  (SELECT COUNT(*) FROM app_integrations ai WHERE ai.app_key='wordpress_rest' AND ai.status IN ('active','beta')) AS active_app_rows,
  (SELECT COUNT(*) FROM actions a WHERE a.action_key='wordpress_api' AND LOWER(COALESCE(a.status,'')) IN ('active','ready','enabled','beta')) AS active_action_rows,
  (SELECT COUNT(*) FROM app_integration_action_bindings b
    WHERE b.app_key='wordpress_rest' AND b.action_key='wordpress_api' AND b.status='active') AS active_action_bindings,
  (SELECT COUNT(*) FROM endpoints e
    WHERE e.parent_action_key='wordpress_api' AND e.endpoint_key='wordpress_create_post'
      AND e.status='active' AND e.execution_readiness='ready' AND e.schema_json IS NOT NULL) AS create_post_ready_endpoints,
  (SELECT COUNT(*) FROM endpoints e
    WHERE e.parent_action_key='wordpress_api' AND e.endpoint_key='wordpress_get_post'
      AND e.status='active' AND e.execution_readiness='ready' AND e.schema_json IS NOT NULL) AS get_post_ready_endpoints,
  (SELECT COUNT(*) FROM admin_platform_endpoint_tools t
    WHERE t.tool_key='wordpress_publish_authority_diagnostic' AND t.is_enabled=1) AS enabled_diagnostic_tools,
  (SELECT COUNT(*) FROM app_integration_tool_bindings t
    WHERE t.app_key='wordpress_rest' AND t.tool_key='wordpress_publish_authority_diagnostic'
      AND t.status='active' AND t.binding_role='diagnostic' AND t.exposure_scope='admin') AS active_diagnostic_bindings,
  (SELECT COUNT(*) FROM v_platform_semantic_capability_canonical_reconciliation r
    WHERE r.capability_key='content.article.create_draft' AND r.reconciliation_status='pass') AS canonical_draft_capability_rows,
  (SELECT COUNT(*) FROM platform_capability_provider_bindings b
    WHERE b.binding_id='semantic-wordpress-create-draft-v1' AND b.capability_key='content.article.create_draft'
      AND b.app_key='wordpress_rest' AND b.parent_action_key='wordpress_api'
      AND b.endpoint_key='wordpress_create_post' AND b.rollout_mode='shadow' AND b.status='active') AS shadow_provider_bindings,
  (SELECT COUNT(*) FROM platform_plugin_capability_exports x
    WHERE x.export_key='semantic_shadow__content_article_create_draft__wordpress'
      AND x.capability_key='content.article.create_draft' AND x.export_status='shadow') AS shadow_export_descriptors,
  CASE
    WHEN (SELECT COUNT(*) FROM app_integrations ai WHERE ai.app_key='wordpress_rest' AND ai.status IN ('active','beta')) <> 1 THEN 'wordpress_app_missing_or_ambiguous'
    WHEN (SELECT COUNT(*) FROM actions a WHERE a.action_key='wordpress_api' AND LOWER(COALESCE(a.status,'')) IN ('active','ready','enabled','beta')) <> 1 THEN 'wordpress_action_missing_or_ambiguous'
    WHEN (SELECT COUNT(*) FROM app_integration_action_bindings b WHERE b.app_key='wordpress_rest' AND b.action_key='wordpress_api' AND b.status='active') <> 1 THEN 'wordpress_action_binding_missing_or_ambiguous'
    WHEN (SELECT COUNT(*) FROM endpoints e WHERE e.parent_action_key='wordpress_api' AND e.endpoint_key='wordpress_create_post' AND e.status='active' AND e.execution_readiness='ready' AND e.schema_json IS NOT NULL) <> 1 THEN 'wordpress_create_post_endpoint_not_ready'
    WHEN (SELECT COUNT(*) FROM endpoints e WHERE e.parent_action_key='wordpress_api' AND e.endpoint_key='wordpress_get_post' AND e.status='active' AND e.execution_readiness='ready' AND e.schema_json IS NOT NULL) <> 1 THEN 'wordpress_get_post_endpoint_not_ready'
    WHEN (SELECT COUNT(*) FROM admin_platform_endpoint_tools t WHERE t.tool_key='wordpress_publish_authority_diagnostic' AND t.is_enabled=1) <> 1 THEN 'wordpress_diagnostic_tool_missing'
    WHEN (SELECT COUNT(*) FROM app_integration_tool_bindings t WHERE t.app_key='wordpress_rest' AND t.tool_key='wordpress_publish_authority_diagnostic' AND t.status='active' AND t.binding_role='diagnostic' AND t.exposure_scope='admin') <> 1 THEN 'wordpress_diagnostic_binding_missing'
    WHEN (SELECT COUNT(*) FROM v_platform_semantic_capability_canonical_reconciliation r WHERE r.capability_key='content.article.create_draft' AND r.reconciliation_status='pass') <> 1 THEN 'wordpress_semantic_canonical_drift'
    WHEN (SELECT COUNT(*) FROM platform_capability_provider_bindings b WHERE b.binding_id='semantic-wordpress-create-draft-v1' AND b.capability_key='content.article.create_draft' AND b.app_key='wordpress_rest' AND b.parent_action_key='wordpress_api' AND b.endpoint_key='wordpress_create_post' AND b.rollout_mode='shadow' AND b.status='active') <> 1 THEN 'wordpress_shadow_provider_binding_drift'
    WHEN (SELECT COUNT(*) FROM platform_plugin_capability_exports x WHERE x.export_key='semantic_shadow__content_article_create_draft__wordpress' AND x.capability_key='content.article.create_draft' AND x.export_status='shadow') <> 1 THEN 'wordpress_shadow_export_descriptor_missing'
    ELSE 'pass'
  END AS reconciliation_status,
  0 AS provider_calls_made,
  0 AS external_writes_performed,
  0 AS secrets_included;
