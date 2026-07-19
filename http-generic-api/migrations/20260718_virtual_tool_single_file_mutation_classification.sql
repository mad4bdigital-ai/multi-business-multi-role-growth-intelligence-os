-- Spec 007 corrective migration: classify single-file mutations deterministically.
-- Additive SQL-primary registry reconciliation only. No provider execution or runtime cutover.
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
    WHEN b.atomicity_mode IN ('compound_mutation','atomic_change_set','transactional_guarded','single_file_mutation')
      OR LOWER(b.operation_intent) REGEXP '(^|_)(create|update|write|apply|delete|merge|finalize|cleanup|install|activate|approve|dispatch|execute|sync|reconcile|promote|revoke|rotate|publish|send)(_|$)'
      THEN 'state_changing'
    WHEN b.atomicity_mode IN ('compound_read','read_only')
      OR LOWER(b.operation_intent) REGEXP '(^|_)(read|list|get|search|inspect|status|report|diagnostic|health|validate|probe|compare)(_|$)'
      THEN 'read'
    ELSE 'unclassified'
  END AS operation_family,
  CASE
    WHEN LOWER(CONCAT_WS('_', b.capability_key, b.operation_intent, b.tool_key)) REGEXP '(^|_)(delete|merge|deploy|credential|secret|token|restart|publish|send)(_|$)' THEN 'D'
    WHEN b.atomicity_mode IN ('compound_mutation','atomic_change_set','transactional_guarded','single_file_mutation')
      OR LOWER(b.operation_intent) REGEXP '(^|_)(create|update|write|apply|finalize|cleanup|install|activate|approve|dispatch|execute|sync|reconcile|promote|revoke|rotate)(_|$)' THEN 'C'
    WHEN b.atomicity_mode IN ('compound_read','read_only')
      OR LOWER(b.operation_intent) REGEXP '(^|_)(read|list|get|search|inspect|status|report|diagnostic|health|validate|probe|compare)(_|$)' THEN 'A'
    ELSE 'B'
  END AS inferred_risk_class,
  b.created_at,
  b.updated_at
FROM platform_tool_dispatch_bindings b
WHERE b.status = 'active';

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
  operation_class=VALUES(operation_class),risk_class=VALUES(risk_class),
  authority_requirement_type=VALUES(authority_requirement_type),
  resource_authority_required=GREATEST(platform_plugin_capabilities.resource_authority_required,VALUES(resource_authority_required)),
  dispatch_allowed=LEAST(platform_plugin_capabilities.dispatch_allowed,VALUES(dispatch_allowed)),
  apply_allowed=LEAST(platform_plugin_capabilities.apply_allowed,VALUES(apply_allowed)),
  requires_audit_evidence=GREATEST(platform_plugin_capabilities.requires_audit_evidence,VALUES(requires_audit_evidence)),
  requires_readback=GREATEST(platform_plugin_capabilities.requires_readback,VALUES(requires_readback)),
  metadata_json=VALUES(metadata_json),status='active',updated_at=CURRENT_TIMESTAMP;

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

INSERT INTO platform_capability_readback_contracts
  (contract_id,contract_key,contract_version,capability_key,adapter_key,verification_type,
   acknowledgement_required,verification_required,expected_effect_class,input_schema_json,observed_state_schema_json,
   provider_binding_constraints_json,certification_status,status,is_current,valid_from,source_registry,source_key,secrets_included)
SELECT
  UUID(),
  LEFT(CONCAT(LEFT(b.capability_key,80),'__',LEFT(b.readback_policy_key,80),'__',LEFT(SHA2(CONCAT(b.capability_key,'|',b.readback_policy_key),256),16)),191),
  1,b.capability_key,MIN(b.runtime_surface),'same_cycle_readback',1,1,
  CASE WHEN c.operation_class='state_changing' THEN 'external_write' ELSE 'read_only' END,
  JSON_OBJECT('type','object','additionalProperties',true),
  JSON_OBJECT('type','object','required',JSON_ARRAY('verification_state','evidence_ref'),
              'properties',JSON_OBJECT('verification_state',JSON_OBJECT('type','string'),
                                       'evidence_ref',JSON_OBJECT('type','string'),
                                       'observed_hash',JSON_OBJECT('type',JSON_ARRAY('string','null'))),
              'additionalProperties',false),
  JSON_OBJECT('source_registry','platform_tool_dispatch_bindings','readback_policy_key',b.readback_policy_key,
              'runtime_surfaces',GROUP_CONCAT(DISTINCT b.runtime_surface ORDER BY b.runtime_surface SEPARATOR ','),
              'shadow_only',true,'secrets_included',false),
  'pending','shadow',1,CURRENT_TIMESTAMP,'platform_tool_dispatch_bindings',b.readback_policy_key,0
FROM v_platform_virtual_tool_bindings_classified b
JOIN v_platform_virtual_tool_capabilities_current c ON c.capability_key=b.capability_key
WHERE COALESCE(b.readback_policy_key,'')<>''
GROUP BY b.capability_key,b.readback_policy_key,c.operation_class
ON DUPLICATE KEY UPDATE
  adapter_key=VALUES(adapter_key),verification_type=VALUES(verification_type),
  acknowledgement_required=VALUES(acknowledgement_required),verification_required=VALUES(verification_required),
  expected_effect_class=VALUES(expected_effect_class),input_schema_json=VALUES(input_schema_json),
  observed_state_schema_json=VALUES(observed_state_schema_json),provider_binding_constraints_json=VALUES(provider_binding_constraints_json),
  certification_status=CASE WHEN platform_capability_readback_contracts.certification_status='certified' THEN 'certified' ELSE VALUES(certification_status) END,
  status=CASE WHEN platform_capability_readback_contracts.status='certified' THEN 'certified' ELSE VALUES(status) END,
  is_current=1,source_registry=VALUES(source_registry),source_key=VALUES(source_key),secrets_included=0,updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_capability_source_links
  (link_id,capability_key,source_kind,source_ref,resolution_status,confidence,metadata_json)
SELECT
  SHA2(CONCAT(r.capability_key,'|readback_contract|',r.contract_key),256),
  r.capability_key,'readback_contract_registry',CONCAT('platform_capability_readback_contracts:',r.contract_key),
  'resolved',1.0000,
  JSON_OBJECT('contract_key',r.contract_key,'contract_version',r.contract_version,'status',r.status,
              'certification_status',r.certification_status,'secrets_included',false)
FROM platform_capability_readback_contracts r
WHERE r.source_registry='platform_tool_dispatch_bindings' AND r.is_current=1
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
