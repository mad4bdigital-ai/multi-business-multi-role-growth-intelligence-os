-- Spec 007: project governed virtual tools into the canonical capability graph.
-- Additive SQL-primary registry projection only. No runtime cutover or provider execution.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

CREATE OR REPLACE VIEW v_platform_virtual_tool_bindings_classified AS
SELECT
  b.id,
  b.binding_id,
  b.parent_action_key,
  b.endpoint_key,
  b.source_endpoint_id,
  b.export_key,
  b.tool_key,
  b.surface_class,
  b.scope_class,
  NULLIF(b.capability_key, '') AS capability_key,
  b.operation_intent,
  b.runtime_surface,
  b.readback_policy_key,
  b.partial_success_policy_key,
  b.atomicity_mode,
  b.status,
  b.metadata_json,
  CASE
    WHEN b.atomicity_mode IN ('compound_mutation','atomic_change_set','transactional_guarded')
      OR LOWER(b.operation_intent) REGEXP '(^|_)(create|update|write|apply|delete|merge|finalize|cleanup|install|activate|approve|dispatch|execute|sync|reconcile|promote|revoke|rotate|publish|send)(_|$)'
      THEN 'state_changing'
    WHEN b.atomicity_mode IN ('compound_read','read_only')
      OR LOWER(b.operation_intent) REGEXP '(^|_)(read|list|get|search|inspect|status|report|diagnostic|health|validate|probe|compare)(_|$)'
      THEN 'read'
    ELSE 'unclassified'
  END AS operation_family,
  CASE
    WHEN LOWER(CONCAT_WS('_', b.capability_key, b.operation_intent, b.tool_key)) REGEXP '(^|_)(delete|merge|deploy|credential|secret|token|restart|publish|send)(_|$)' THEN 'D'
    WHEN b.atomicity_mode IN ('compound_mutation','atomic_change_set','transactional_guarded')
      OR LOWER(b.operation_intent) REGEXP '(^|_)(create|update|write|apply|finalize|cleanup|install|activate|approve|dispatch|execute|sync|reconcile|promote|revoke|rotate)(_|$)' THEN 'C'
    WHEN b.atomicity_mode IN ('compound_read','read_only')
      OR LOWER(b.operation_intent) REGEXP '(^|_)(read|list|get|search|inspect|status|report|diagnostic|health|validate|probe|compare)(_|$)' THEN 'A'
    ELSE 'B'
  END AS inferred_risk_class,
  b.created_at,
  b.updated_at
FROM platform_tool_dispatch_bindings b
WHERE b.status = 'active';

CREATE OR REPLACE VIEW v_platform_virtual_tool_identity_resolution AS
SELECT
  tool_key,
  MIN(capability_key) AS resolved_capability_key,
  COUNT(DISTINCT capability_key) AS capability_count,
  SUM(CASE WHEN capability_key IS NULL THEN 1 ELSE 0 END) AS missing_identity_count,
  COUNT(DISTINCT scope_class) AS scope_count,
  GROUP_CONCAT(DISTINCT capability_key ORDER BY capability_key SEPARATOR ',') AS capability_keys,
  GROUP_CONCAT(DISTINCT binding_id ORDER BY binding_id SEPARATOR ',') AS binding_ids
FROM v_platform_virtual_tool_bindings_classified
GROUP BY tool_key;

CREATE OR REPLACE VIEW v_platform_virtual_tool_capabilities_current AS
SELECT
  b.capability_key,
  REPLACE(MIN(b.tool_key), '_', ' ') AS display_name,
  'virtual_tool' AS capability_family,
  'platform_tool_dispatch_bindings' AS source_table,
  CAST(b.capability_key AS CHAR(255)) AS source_key,
  CASE
    WHEN SUM(b.operation_family = 'state_changing') > 0 THEN 'state_changing'
    WHEN SUM(b.operation_family = 'read') = COUNT(*) THEN 'read'
    ELSE 'unclassified'
  END AS operation_class,
  CASE
    WHEN SUM(b.inferred_risk_class = 'D') > 0 THEN 'D'
    WHEN SUM(b.inferred_risk_class = 'C') > 0 THEN 'C'
    WHEN SUM(b.inferred_risk_class = 'B') > 0 THEN 'B'
    ELSE 'A'
  END AS risk_class,
  'active' AS runtime_status,
  MIN(b.scope_class) AS exposure_scope,
  CASE WHEN SUM(b.operation_family = 'state_changing') > 0 THEN 1 ELSE 0 END AS resource_authority_required,
  1 AS dispatch_allowed,
  0 AS apply_allowed,
  CASE WHEN SUM(b.operation_family = 'state_changing') > 0 THEN 1 ELSE 0 END AS requires_audit_evidence,
  CASE WHEN SUM(b.operation_family = 'state_changing') > 0 OR SUM(COALESCE(b.readback_policy_key, '') <> '') > 0 THEN 1 ELSE 0 END AS requires_readback,
  NULL AS evidence_ref,
  CONCAT(
    'Canonical virtual-tool projection. aliases=',
    GROUP_CONCAT(DISTINCT b.tool_key ORDER BY b.tool_key SEPARATOR ','),
    '; readback_policies=',
    COALESCE(GROUP_CONCAT(DISTINCT NULLIF(b.readback_policy_key, '') ORDER BY b.readback_policy_key SEPARATOR ','), 'none')
  ) AS notes
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key = b.tool_key
 AND i.capability_count = 1
 AND i.missing_identity_count = 0
 AND i.resolved_capability_key = b.capability_key
WHERE b.capability_key IS NOT NULL
GROUP BY b.capability_key
HAVING COUNT(DISTINCT b.scope_class) = 1
   AND COUNT(DISTINCT b.operation_family) = 1
   AND MAX(CHAR_LENGTH(b.capability_key)) <= 191;

CREATE OR REPLACE VIEW v_platform_virtual_tool_bindings_current AS
SELECT
  b.binding_id AS binding_key,
  b.capability_key,
  'virtual_tool_dispatch' AS binding_family,
  'platform_tool_dispatch_bindings' AS source_table,
  CAST(b.binding_id AS CHAR(255)) AS source_key,
  b.status AS binding_status,
  b.scope_class AS exposure_scope,
  'server_side_registry' AS credential_source,
  1 AS dispatch_allowed,
  0 AS apply_allowed,
  CONCAT('tool=', b.tool_key, '; endpoint=', b.parent_action_key, '/', b.endpoint_key, '; readback=', COALESCE(b.readback_policy_key, 'none')) AS notes
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key = b.tool_key
 AND i.capability_count = 1
 AND i.missing_identity_count = 0
 AND i.resolved_capability_key = b.capability_key
JOIN v_platform_virtual_tool_capabilities_current c
  ON c.capability_key = b.capability_key;

CREATE OR REPLACE VIEW v_platform_virtual_tool_exports_current AS
SELECT
  CONCAT('virtual_tool_export.', b.tool_key) AS export_key,
  i.resolved_capability_key AS capability_key,
  MIN(b.surface_class) AS export_surface,
  'platform_tool_dispatch_bindings' AS source_table,
  CAST(b.tool_key AS CHAR(255)) AS source_key,
  'active' AS export_status,
  MIN(b.scope_class) AS exposure_scope,
  NULL AS http_method,
  NULL AS http_path,
  CONCAT('Derived alias export from active bindings. endpoints=', GROUP_CONCAT(DISTINCT b.endpoint_key ORDER BY b.endpoint_key SEPARATOR ',')) AS notes
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key = b.tool_key
 AND i.capability_count = 1
 AND i.missing_identity_count = 0
JOIN v_platform_virtual_tool_capabilities_current c
  ON c.capability_key = i.resolved_capability_key
GROUP BY b.tool_key, i.resolved_capability_key
HAVING COUNT(DISTINCT b.scope_class) = 1;

CREATE OR REPLACE VIEW v_platform_governed_capabilities_current AS
SELECT c.capability_key,c.display_name,c.capability_family,c.source_table,c.source_key,c.operation_class,c.risk_class,
       c.runtime_status,c.exposure_scope,c.resource_authority_required,c.dispatch_allowed,c.apply_allowed,
       c.requires_audit_evidence,c.requires_readback,c.evidence_ref,c.notes
FROM v_platform_capabilities_current c
UNION ALL
SELECT v.capability_key,v.display_name,v.capability_family,v.source_table,v.source_key,v.operation_class,v.risk_class,
       v.runtime_status,v.exposure_scope,v.resource_authority_required,v.dispatch_allowed,v.apply_allowed,
       v.requires_audit_evidence,v.requires_readback,v.evidence_ref,v.notes
FROM v_platform_virtual_tool_capabilities_current v
WHERE NOT EXISTS (
  SELECT 1 FROM v_platform_capabilities_current c WHERE c.capability_key = v.capability_key
);

CREATE OR REPLACE VIEW v_platform_governed_bindings_current AS
SELECT b.binding_key,b.capability_key,b.binding_family,b.source_table,b.source_key,b.binding_status,b.exposure_scope,
       b.credential_source,b.dispatch_allowed,b.apply_allowed,b.notes
FROM v_platform_bindings_current b
UNION ALL
SELECT v.binding_key,v.capability_key,v.binding_family,v.source_table,v.source_key,v.binding_status,v.exposure_scope,
       v.credential_source,v.dispatch_allowed,v.apply_allowed,v.notes
FROM v_platform_virtual_tool_bindings_current v
WHERE NOT EXISTS (
  SELECT 1 FROM v_platform_bindings_current b WHERE b.binding_key = v.binding_key
);

CREATE OR REPLACE VIEW v_platform_governed_exports_current AS
SELECT x.export_key,x.capability_key,x.export_surface,x.source_table,x.source_key,x.export_status,x.exposure_scope,
       x.http_method,x.http_path,x.notes
FROM v_platform_exports_current x
UNION ALL
SELECT v.export_key,v.capability_key,v.export_surface,v.source_table,v.source_key,v.export_status,v.exposure_scope,
       v.http_method,v.http_path,v.notes
FROM v_platform_virtual_tool_exports_current v
WHERE NOT EXISTS (
  SELECT 1 FROM v_platform_exports_current x WHERE x.export_key = v.export_key
);

CREATE OR REPLACE VIEW v_platform_virtual_tool_capability_gaps AS
SELECT CONCAT('virtual_tool.', i.tool_key) AS capability_key,
       'CAPABILITY_IDENTITY_MISSING' AS gap_key,
       'critical' AS gap_severity,
       'Active virtual tool bindings have no canonical capability identity.' AS gap_description
FROM v_platform_virtual_tool_identity_resolution i
WHERE i.capability_count = 0
UNION ALL
SELECT CONCAT('virtual_tool.', i.tool_key),
       'CAPABILITY_AMBIGUOUS',
       'critical',
       CONCAT('One virtual tool maps to multiple canonical capabilities: ', COALESCE(i.capability_keys, 'unknown'))
FROM v_platform_virtual_tool_identity_resolution i
WHERE i.capability_count > 1
UNION ALL
SELECT CONCAT('virtual_tool.', i.tool_key),
       'CAPABILITY_IDENTITY_PARTIAL',
       'high',
       'Some active bindings for the virtual tool omit the canonical capability identity.'
FROM v_platform_virtual_tool_identity_resolution i
WHERE i.capability_count = 1 AND i.missing_identity_count > 0
UNION ALL
SELECT b.capability_key,
       'PROJECTION_SCOPE_AMBIGUOUS',
       'critical',
       'Aliases for one canonical capability declare conflicting Admin/Tenant exposure scopes.'
FROM v_platform_virtual_tool_bindings_classified b
WHERE b.capability_key IS NOT NULL
GROUP BY b.capability_key
HAVING COUNT(DISTINCT b.scope_class) > 1
UNION ALL
SELECT b.capability_key,
       'OPERATION_CLASS_AMBIGUOUS',
       'high',
       'Aliases for one canonical capability disagree on read versus state-changing semantics.'
FROM v_platform_virtual_tool_bindings_classified b
WHERE b.capability_key IS NOT NULL
GROUP BY b.capability_key
HAVING COUNT(DISTINCT b.operation_family) > 1
UNION ALL
SELECT DISTINCT b.capability_key,
       'MUTATION_CLASSIFICATION_REQUIRED',
       'high',
       'Virtual tool binding operation semantics could not be classified deterministically.'
FROM v_platform_virtual_tool_bindings_classified b
WHERE b.capability_key IS NOT NULL AND b.operation_family = 'unclassified'
UNION ALL
SELECT DISTINCT b.capability_key,
       'READBACK_CONTRACT_REQUIRED',
       'high',
       'State-changing virtual tool binding has no declared readback policy.'
FROM v_platform_virtual_tool_bindings_classified b
WHERE b.capability_key IS NOT NULL
  AND b.operation_family = 'state_changing'
  AND COALESCE(b.readback_policy_key, '') = ''
UNION ALL
SELECT DISTINCT b.capability_key,
       'TENANT_TO_ADMIN_SURFACE_BLOCKED',
       'critical',
       'Tenant scope cannot project a virtual Admin or Admin CLI surface.'
FROM v_platform_virtual_tool_bindings_classified b
WHERE b.capability_key IS NOT NULL
  AND b.scope_class = 'tenant'
  AND b.surface_class IN ('virtual_admin_tool','admin_cli_fallback')
UNION ALL
SELECT DISTINCT b.capability_key,
       'CAPABILITY_IDENTITY_TOO_LONG',
       'critical',
       'Canonical capability identity exceeds the canonical registry key length.'
FROM v_platform_virtual_tool_bindings_classified b
WHERE b.capability_key IS NOT NULL AND CHAR_LENGTH(b.capability_key) > 191
UNION ALL
SELECT v.capability_key,
       'CANONICAL_SOURCE_COLLISION_REVIEW_REQUIRED',
       'high',
       CONCAT('Canonical capability already exists from source ', p.source_table, '; virtual bindings remain source links only.')
FROM v_platform_virtual_tool_capabilities_current v
JOIN platform_plugin_capabilities p ON p.capability_key = v.capability_key
WHERE p.source_table <> 'platform_tool_dispatch_bindings';

INSERT INTO platform_plugins
  (plugin_key,display_name,plugin_family,source_kind,owner_scope,trust_level,status,source_table,source_key)
VALUES
  ('platform_tool_dispatch_bindings','Virtual Governed Tools','virtual_tool','virtual_tool_registry','admin','governed','active',
   'platform_tool_dispatch_bindings','platform_tool_dispatch_bindings')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),plugin_family=VALUES(plugin_family),source_kind=VALUES(source_kind),
  trust_level=VALUES(trust_level),status=VALUES(status),source_table=VALUES(source_table),source_key=VALUES(source_key),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_plugin_capabilities
  (capability_key,plugin_key,display_name,capability_family,source_table,source_key,operation_class,risk_class,runtime_status,
   exposure_scope,authority_requirement_type,resource_authority_required,dispatch_allowed,apply_allowed,requires_audit_evidence,
   requires_readback,legacy_evidence_ref,metadata_json,status)
SELECT
  v.capability_key,'platform_tool_dispatch_bindings',v.display_name,v.capability_family,v.source_table,v.source_key,
  v.operation_class,v.risk_class,v.runtime_status,v.exposure_scope,
  CASE WHEN v.operation_class='state_changing' THEN 'combined' ELSE 'invocation' END,
  v.resource_authority_required,v.dispatch_allowed,0,v.requires_audit_evidence,v.requires_readback,NULL,
  JSON_OBJECT('projection_source','platform_tool_dispatch_bindings','rollout_mode','shadow','apply_allowed',false,
              'source_notes',v.notes,'secrets_included',false),'active'
FROM v_platform_virtual_tool_capabilities_current v
ON DUPLICATE KEY UPDATE
  resource_authority_required=GREATEST(platform_plugin_capabilities.resource_authority_required,VALUES(resource_authority_required)),
  dispatch_allowed=LEAST(platform_plugin_capabilities.dispatch_allowed,VALUES(dispatch_allowed)),
  apply_allowed=LEAST(platform_plugin_capabilities.apply_allowed,VALUES(apply_allowed)),
  requires_audit_evidence=GREATEST(platform_plugin_capabilities.requires_audit_evidence,VALUES(requires_audit_evidence)),
  requires_readback=GREATEST(platform_plugin_capabilities.requires_readback,VALUES(requires_readback)),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_plugin_bindings
  (binding_key,capability_key,binding_family,source_table,source_key,binding_status,exposure_scope,credential_source,
   dispatch_allowed,apply_allowed,metadata_json)
SELECT binding_key,capability_key,binding_family,source_table,source_key,binding_status,exposure_scope,credential_source,
       dispatch_allowed,0,JSON_OBJECT('notes',notes,'rollout_mode','shadow','secrets_included',false)
FROM v_platform_virtual_tool_bindings_current
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),binding_family=VALUES(binding_family),source_table=VALUES(source_table),
  source_key=VALUES(source_key),binding_status=VALUES(binding_status),exposure_scope=VALUES(exposure_scope),
  credential_source=VALUES(credential_source),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=0,
  metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_plugin_capability_exports
  (export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes)
SELECT export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes
FROM v_platform_virtual_tool_exports_current
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),export_surface=VALUES(export_surface),source_table=VALUES(source_table),
  source_key=VALUES(source_key),export_status=VALUES(export_status),exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method),http_path=VALUES(http_path),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_capability_source_links
  (link_id,capability_key,source_kind,source_ref,resolution_status,confidence,metadata_json)
SELECT
  SHA2(CONCAT(b.capability_key,'|tool_dispatch_binding|',b.binding_id),256),
  b.capability_key,'tool_dispatch_binding',CONCAT('platform_tool_dispatch_bindings:',b.binding_id),'resolved',1.0000,
  JSON_OBJECT('tool_key',b.tool_key,'parent_action_key',b.parent_action_key,'endpoint_key',b.endpoint_key,
              'runtime_surface',b.runtime_surface,'readback_policy_key',b.readback_policy_key,
              'atomicity_mode',b.atomicity_mode,'secrets_included',false)
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key=b.tool_key AND i.capability_count=1 AND i.missing_identity_count=0
JOIN v_platform_virtual_tool_capabilities_current c ON c.capability_key=b.capability_key
ON DUPLICATE KEY UPDATE
  resolution_status='resolved',confidence=1.0000,metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_capability_debt
  (debt_id,capability_key,gap_key,severity,source_view,status,blocks_dispatch,blocks_apply,recommended_fix,metadata_json)
SELECT
  SHA2(CONCAT(capability_key,'|',gap_key),256),capability_key,gap_key,gap_severity,
  'v_platform_virtual_tool_capability_gaps','open',
  CASE WHEN gap_key IN ('CAPABILITY_IDENTITY_MISSING','CAPABILITY_AMBIGUOUS','PROJECTION_SCOPE_AMBIGUOUS',
                        'OPERATION_CLASS_AMBIGUOUS','TENANT_TO_ADMIN_SURFACE_BLOCKED','CAPABILITY_IDENTITY_TOO_LONG') THEN 1 ELSE 0 END,
  1,gap_description,
  JSON_OBJECT('projection_source','platform_tool_dispatch_bindings','secrets_included',false)
FROM v_platform_virtual_tool_capability_gaps
ON DUPLICATE KEY UPDATE
  severity=VALUES(severity),status=CASE WHEN platform_capability_debt.status='resolved' THEN 'open' ELSE platform_capability_debt.status END,
  resolved_at=NULL,blocks_dispatch=VALUES(blocks_dispatch),blocks_apply=VALUES(blocks_apply),
  recommended_fix=VALUES(recommended_fix),last_seen_at=CURRENT_TIMESTAMP,metadata_json=VALUES(metadata_json);

UPDATE platform_capability_debt d
SET d.status='resolved',d.resolved_at=CURRENT_TIMESTAMP,d.last_seen_at=CURRENT_TIMESTAMP
WHERE d.source_view='v_platform_virtual_tool_capability_gaps'
  AND d.status IN ('open','in_progress')
  AND NOT EXISTS (
    SELECT 1 FROM v_platform_virtual_tool_capability_gaps g
    WHERE g.capability_key=d.capability_key AND g.gap_key=d.gap_key
  );

INSERT INTO platform_closure_threads
  (thread_key,capability_key,state,required_evidence_json,observed_evidence_json,blocker_json,next_action,owner_engine_key)
VALUES
  ('spec007_virtual_tool_projection',NULL,'validating',
   JSON_ARRAY('canonical_identity','admin_projection','readback_contract','generic_certification','shadow_evidence'),
   JSON_ARRAY('platform_tool_dispatch_bindings_projection'),
   JSON_ARRAY('apply_remains_disabled','certification_required'),
   'Run governed reconciliation, compile manifests, and collect dev/staging shadow evidence before any cutover.',
   'resource_authority_engine')
ON DUPLICATE KEY UPDATE
  state=VALUES(state),required_evidence_json=VALUES(required_evidence_json),observed_evidence_json=VALUES(observed_evidence_json),
  blocker_json=VALUES(blocker_json),next_action=VALUES(next_action),owner_engine_key=VALUES(owner_engine_key),updated_at=CURRENT_TIMESTAMP;
