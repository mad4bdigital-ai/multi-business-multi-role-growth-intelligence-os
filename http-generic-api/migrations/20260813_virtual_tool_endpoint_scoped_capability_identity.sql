-- Sprint 69 follow-up: endpoint-scoped virtual-tool capability identity reconciliation.
-- This migration changes SQL-primary registry projections only. It performs no provider call,
-- reads no credential payload, performs no external send, and leaves apply disabled.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

UPDATE platform_tool_dispatch_bindings
   SET capability_key = 'github_pr_ci_readback',
       metadata_json = JSON_SET(
         COALESCE(metadata_json, JSON_OBJECT()),
         '$.capability_identity_scope', 'tool_parent_action_endpoint',
         '$.capability_identity_reason', 'read-only CI gate readback binding',
         '$.secrets_included', FALSE
       ),
       updated_at = CURRENT_TIMESTAMP
 WHERE binding_id = 'ptdb_github_pr_ci_gate_get_pr'
   AND (capability_key IS NULL OR capability_key = '');

CREATE OR REPLACE VIEW v_platform_virtual_tool_identity_resolution AS
SELECT
  tool_key,
  parent_action_key,
  endpoint_key,
  MIN(capability_key) AS resolved_capability_key,
  COUNT(DISTINCT capability_key) AS capability_count,
  SUM(CASE WHEN capability_key IS NULL THEN 1 ELSE 0 END) AS missing_identity_count,
  COUNT(DISTINCT scope_class) AS scope_count,
  GROUP_CONCAT(DISTINCT capability_key ORDER BY capability_key SEPARATOR ',') AS capability_keys,
  GROUP_CONCAT(DISTINCT binding_id ORDER BY binding_id SEPARATOR ',') AS binding_ids
FROM v_platform_virtual_tool_bindings_classified
GROUP BY tool_key, parent_action_key, endpoint_key;

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
    'Canonical endpoint-scoped virtual-tool projection. identity_scope=tool+parent_action+endpoint; aliases=',
    GROUP_CONCAT(DISTINCT b.tool_key ORDER BY b.tool_key SEPARATOR ','),
    '; readback_policies=',
    COALESCE(GROUP_CONCAT(DISTINCT NULLIF(b.readback_policy_key, '') ORDER BY b.readback_policy_key SEPARATOR ','), 'none')
  ) AS notes
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key = b.tool_key
 AND i.parent_action_key = b.parent_action_key
 AND i.endpoint_key = b.endpoint_key
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
  CONCAT('tool=', b.tool_key, '; parent_action=', b.parent_action_key, '; endpoint=', b.endpoint_key,
         '; readback=', COALESCE(b.readback_policy_key, 'none')) AS notes
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key = b.tool_key
 AND i.parent_action_key = b.parent_action_key
 AND i.endpoint_key = b.endpoint_key
 AND i.capability_count = 1
 AND i.missing_identity_count = 0
 AND i.resolved_capability_key = b.capability_key
JOIN v_platform_virtual_tool_capabilities_current c ON c.capability_key = b.capability_key;

CREATE OR REPLACE VIEW v_platform_virtual_tool_exports_current AS
SELECT
  CONCAT('virtual_tool_export.', b.tool_key, '.', b.parent_action_key, '.', b.endpoint_key) AS export_key,
  i.resolved_capability_key AS capability_key,
  MIN(b.surface_class) AS export_surface,
  'platform_tool_dispatch_bindings' AS source_table,
  CAST(CONCAT(b.tool_key, '.', b.parent_action_key, '.', b.endpoint_key) AS CHAR(255)) AS source_key,
  'active' AS export_status,
  MIN(b.scope_class) AS exposure_scope,
  NULL AS http_method,
  NULL AS http_path,
  CONCAT('Endpoint-scoped alias export. parent_action=', b.parent_action_key,
         '; endpoint=', b.endpoint_key,
         '; capability=', i.resolved_capability_key) AS notes
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key = b.tool_key
 AND i.parent_action_key = b.parent_action_key
 AND i.endpoint_key = b.endpoint_key
 AND i.capability_count = 1
 AND i.missing_identity_count = 0
JOIN v_platform_virtual_tool_capabilities_current c ON c.capability_key = i.resolved_capability_key
GROUP BY b.tool_key, b.parent_action_key, b.endpoint_key, i.resolved_capability_key
HAVING COUNT(DISTINCT b.scope_class) = 1
   AND CHAR_LENGTH(CONCAT('virtual_tool_export.', b.tool_key, '.', b.parent_action_key, '.', b.endpoint_key)) <= 191;

CREATE OR REPLACE VIEW v_platform_virtual_tool_capability_gaps AS
SELECT CONCAT('virtual_tool_scope.', SHA2(CONCAT(i.tool_key, '|', i.parent_action_key, '|', i.endpoint_key), 256)) AS capability_key,
       'CAPABILITY_IDENTITY_MISSING' AS gap_key,
       'critical' AS gap_severity,
       CONCAT('Endpoint-scoped virtual tool binding has no canonical capability identity: ',
              i.tool_key, ' / ', i.parent_action_key, ' / ', i.endpoint_key) AS gap_description
FROM v_platform_virtual_tool_identity_resolution i
WHERE i.capability_count = 0
UNION ALL
SELECT CONCAT('virtual_tool_scope.', SHA2(CONCAT(i.tool_key, '|', i.parent_action_key, '|', i.endpoint_key), 256)),
       'CAPABILITY_AMBIGUOUS',
       'critical',
       CONCAT('One endpoint-scoped virtual tool binding maps to multiple canonical capabilities: ',
              i.tool_key, ' / ', i.parent_action_key, ' / ', i.endpoint_key, ' => ', COALESCE(i.capability_keys, 'unknown'))
FROM v_platform_virtual_tool_identity_resolution i
WHERE i.capability_count > 1
UNION ALL
SELECT CONCAT('virtual_tool_scope.', SHA2(CONCAT(i.tool_key, '|', i.parent_action_key, '|', i.endpoint_key), 256)),
       'CAPABILITY_IDENTITY_PARTIAL',
       'high',
       CONCAT('Some bindings for the endpoint-scoped virtual tool omit the canonical capability identity: ',
              i.tool_key, ' / ', i.parent_action_key, ' / ', i.endpoint_key)
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
  (plugin_key, display_name, plugin_family, source_kind, owner_scope, trust_level, status, source_table, source_key)
VALUES
  ('platform_tool_dispatch_bindings', 'Virtual Governed Tools', 'virtual_tool', 'virtual_tool_registry', 'admin', 'governed', 'active',
   'platform_tool_dispatch_bindings', 'platform_tool_dispatch_bindings')
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), plugin_family=VALUES(plugin_family), source_kind=VALUES(source_kind),
  trust_level=VALUES(trust_level), status=VALUES(status), source_table=VALUES(source_table),
  source_key=VALUES(source_key), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_plugin_capabilities
  (capability_key, plugin_key, display_name, capability_family, source_table, source_key, operation_class, risk_class,
   runtime_status, exposure_scope, authority_requirement_type, resource_authority_required, dispatch_allowed, apply_allowed,
   requires_audit_evidence, requires_readback, legacy_evidence_ref, metadata_json, status)
SELECT
  v.capability_key, 'platform_tool_dispatch_bindings', v.display_name, v.capability_family, v.source_table, v.source_key,
  v.operation_class, v.risk_class, v.runtime_status, v.exposure_scope,
  CASE WHEN v.operation_class='state_changing' THEN 'combined' ELSE 'invocation' END,
  v.resource_authority_required, v.dispatch_allowed, 0, v.requires_audit_evidence, v.requires_readback, NULL,
  JSON_OBJECT('projection_source','platform_tool_dispatch_bindings','identity_scope','tool_parent_action_endpoint',
              'rollout_mode','shadow','apply_allowed',false,'source_notes',v.notes,'secrets_included',false), 'active'
FROM v_platform_virtual_tool_capabilities_current v
ON DUPLICATE KEY UPDATE
  resource_authority_required=GREATEST(platform_plugin_capabilities.resource_authority_required,VALUES(resource_authority_required)),
  dispatch_allowed=LEAST(platform_plugin_capabilities.dispatch_allowed,VALUES(dispatch_allowed)),
  apply_allowed=LEAST(platform_plugin_capabilities.apply_allowed,VALUES(apply_allowed)),
  requires_audit_evidence=GREATEST(platform_plugin_capabilities.requires_audit_evidence,VALUES(requires_audit_evidence)),
  requires_readback=GREATEST(platform_plugin_capabilities.requires_readback,VALUES(requires_readback)),
  metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_plugin_bindings
  (binding_key, capability_key, binding_family, source_table, source_key, binding_status, exposure_scope,
   credential_source, dispatch_allowed, apply_allowed, metadata_json)
SELECT binding_key, capability_key, binding_family, source_table, source_key, binding_status, exposure_scope,
       credential_source, dispatch_allowed, 0,
       JSON_OBJECT('notes',notes,'identity_scope','tool_parent_action_endpoint','rollout_mode','shadow','secrets_included',false)
FROM v_platform_virtual_tool_bindings_current
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key), binding_family=VALUES(binding_family), source_table=VALUES(source_table),
  source_key=VALUES(source_key), binding_status=VALUES(binding_status), exposure_scope=VALUES(exposure_scope),
  credential_source=VALUES(credential_source), dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=0,
  metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP;

UPDATE platform_plugin_capability_exports e
LEFT JOIN v_platform_virtual_tool_exports_current v ON v.export_key = e.export_key
SET e.export_status = 'disabled', e.updated_at = CURRENT_TIMESTAMP
WHERE e.source_table = 'platform_tool_dispatch_bindings'
  AND e.export_status = 'active'
  AND v.export_key IS NULL;

INSERT INTO platform_plugin_capability_exports
  (export_key, capability_key, export_surface, source_table, source_key, export_status, exposure_scope, http_method, http_path, notes)
SELECT export_key, capability_key, export_surface, source_table, source_key, export_status, exposure_scope, http_method, http_path, notes
FROM v_platform_virtual_tool_exports_current
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key), export_surface=VALUES(export_surface), source_table=VALUES(source_table),
  source_key=VALUES(source_key), export_status=VALUES(export_status), exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method), http_path=VALUES(http_path), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_capability_readback_contracts
  (contract_id, contract_key, contract_version, capability_key, adapter_key, verification_type,
   acknowledgement_required, verification_required, expected_effect_class, input_schema_json,
   observed_state_schema_json, provider_binding_constraints_json, certification_status, status,
   is_current, valid_from, source_registry, source_key, secrets_included)
SELECT
  UUID(),
  LEFT(CONCAT(LEFT(b.capability_key,80),'__',LEFT(b.readback_policy_key,80),'__',LEFT(SHA2(CONCAT(b.capability_key,'|',b.readback_policy_key),256),16)),191),
  1,
  b.capability_key,
  MIN(b.runtime_surface),
  'same_cycle_readback',
  1,
  1,
  CASE WHEN c.operation_class='state_changing' THEN 'external_write' ELSE 'read_only' END,
  JSON_OBJECT('type','object','additionalProperties',true),
  JSON_OBJECT('type','object','required',JSON_ARRAY('verification_state','evidence_ref'),
              'properties',JSON_OBJECT('verification_state',JSON_OBJECT('type','string'),
                                       'evidence_ref',JSON_OBJECT('type','string'),
                                       'observed_hash',JSON_OBJECT('type',JSON_ARRAY('string','null'))),
              'additionalProperties',false),
  JSON_OBJECT('source_registry','platform_tool_dispatch_bindings',
              'identity_scope','tool_parent_action_endpoint',
              'readback_policy_key',b.readback_policy_key,
              'runtime_surfaces',GROUP_CONCAT(DISTINCT b.runtime_surface ORDER BY b.runtime_surface SEPARATOR ','),
              'shadow_only',true,'secrets_included',false),
  'pending',
  'shadow',
  1,
  CURRENT_TIMESTAMP,
  'platform_tool_dispatch_bindings',
  b.readback_policy_key,
  0
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key=b.tool_key AND i.parent_action_key=b.parent_action_key AND i.endpoint_key=b.endpoint_key
 AND i.capability_count=1 AND i.missing_identity_count=0 AND i.resolved_capability_key=b.capability_key
JOIN v_platform_virtual_tool_capabilities_current c ON c.capability_key=b.capability_key
WHERE COALESCE(b.readback_policy_key,'') <> ''
GROUP BY b.capability_key, b.readback_policy_key, c.operation_class
ON DUPLICATE KEY UPDATE
  adapter_key=VALUES(adapter_key), verification_type=VALUES(verification_type),
  acknowledgement_required=VALUES(acknowledgement_required), verification_required=VALUES(verification_required),
  expected_effect_class=VALUES(expected_effect_class), input_schema_json=VALUES(input_schema_json),
  observed_state_schema_json=VALUES(observed_state_schema_json),
  provider_binding_constraints_json=VALUES(provider_binding_constraints_json),
  certification_status=CASE WHEN platform_capability_readback_contracts.certification_status='certified' THEN 'certified' ELSE VALUES(certification_status) END,
  status=CASE WHEN platform_capability_readback_contracts.status='certified' THEN 'certified' ELSE VALUES(status) END,
  is_current=1, source_registry=VALUES(source_registry), source_key=VALUES(source_key),
  secrets_included=0, updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_capability_source_links
  (link_id, capability_key, source_kind, source_ref, resolution_status, confidence, metadata_json)
SELECT SHA2(CONCAT(b.capability_key,'|tool_dispatch_binding|',b.binding_id),256), b.capability_key,
       'tool_dispatch_binding', CONCAT('platform_tool_dispatch_bindings:',b.binding_id), 'resolved', 1.0000,
       JSON_OBJECT('tool_key',b.tool_key,'parent_action_key',b.parent_action_key,'endpoint_key',b.endpoint_key,
                   'identity_scope','tool_parent_action_endpoint','runtime_surface',b.runtime_surface,
                   'readback_policy_key',b.readback_policy_key,'atomicity_mode',b.atomicity_mode,'secrets_included',false)
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_identity_resolution i
  ON i.tool_key=b.tool_key AND i.parent_action_key=b.parent_action_key AND i.endpoint_key=b.endpoint_key
 AND i.capability_count=1 AND i.missing_identity_count=0 AND i.resolved_capability_key=b.capability_key
JOIN v_platform_virtual_tool_capabilities_current c ON c.capability_key=b.capability_key
ON DUPLICATE KEY UPDATE
  resolution_status='resolved', confidence=1.0000, metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_capability_debt
  (debt_id, capability_key, gap_key, severity, source_view, status, blocks_dispatch, blocks_apply, recommended_fix, metadata_json)
SELECT SHA2(CONCAT(capability_key,'|',gap_key),256), capability_key, gap_key, gap_severity,
       'v_platform_virtual_tool_capability_gaps', 'open',
       CASE WHEN gap_key IN ('CAPABILITY_IDENTITY_MISSING','CAPABILITY_AMBIGUOUS','PROJECTION_SCOPE_AMBIGUOUS',
                             'OPERATION_CLASS_AMBIGUOUS','TENANT_TO_ADMIN_SURFACE_BLOCKED','CAPABILITY_IDENTITY_TOO_LONG') THEN 1 ELSE 0 END,
       1, gap_description,
       JSON_OBJECT('projection_source','platform_tool_dispatch_bindings','identity_scope','tool_parent_action_endpoint','secrets_included',false)
FROM v_platform_virtual_tool_capability_gaps
ON DUPLICATE KEY UPDATE
  severity=VALUES(severity), status=CASE WHEN platform_capability_debt.status='resolved' THEN 'open' ELSE platform_capability_debt.status END,
  resolved_at=NULL, blocks_dispatch=VALUES(blocks_dispatch), blocks_apply=VALUES(blocks_apply),
  recommended_fix=VALUES(recommended_fix), last_seen_at=CURRENT_TIMESTAMP, metadata_json=VALUES(metadata_json);

UPDATE platform_capability_debt d
SET d.status='resolved', d.resolved_at=CURRENT_TIMESTAMP, d.last_seen_at=CURRENT_TIMESTAMP
WHERE d.source_view='v_platform_virtual_tool_capability_gaps'
  AND d.status IN ('open','in_progress')
  AND NOT EXISTS (
    SELECT 1 FROM v_platform_virtual_tool_capability_gaps g
    WHERE g.capability_key=d.capability_key AND g.gap_key=d.gap_key
  );

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('20260813_virtual_tool_endpoint_scoped_capability_identity.sql', 'authorized', 'migration_seed',
   'governed_migration_runner_authorization_v1', 'medium', 1, 1, 1, 1,
   'Endpoint-scoped virtual-tool capability identity reconciliation. Registry projection only; no provider calls or external writes.',
   JSON_OBJECT('scope','virtual_tool_capability_identity_projection','provider_calls',false,'external_writes',false,
               'apply_enabled',false,'identity_scope','tool_parent_action_endpoint','secrets_included',false))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status), authorization_source=VALUES(authorization_source),
  policy_key=VALUES(policy_key), risk_tier=VALUES(risk_tier), requires_preflight=VALUES(requires_preflight),
  requires_confirmation=VALUES(requires_confirmation), allow_record_only=VALUES(allow_record_only),
  allow_apply=VALUES(allow_apply), notes=VALUES(notes), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP;
