export const VIRTUAL_TOOL_RECONCILIATION_SQL = [
  `INSERT INTO platform_plugins
     (plugin_key,display_name,plugin_family,source_kind,owner_scope,trust_level,status,source_table,source_key)
   VALUES ('platform_tool_dispatch_bindings','Virtual Governed Tools','virtual_tool','virtual_tool_registry',
           'admin','governed','active','platform_tool_dispatch_bindings','platform_tool_dispatch_bindings')
   ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),plugin_family=VALUES(plugin_family),
     source_kind=VALUES(source_kind),trust_level=VALUES(trust_level),status=VALUES(status),
     source_table=VALUES(source_table),source_key=VALUES(source_key),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_plugin_capabilities
     (capability_key,plugin_key,display_name,capability_family,source_table,source_key,operation_class,risk_class,
      runtime_status,exposure_scope,authority_requirement_type,resource_authority_required,dispatch_allowed,
      apply_allowed,requires_audit_evidence,requires_readback,legacy_evidence_ref,metadata_json,status)
   SELECT capability_key,'platform_tool_dispatch_bindings',display_name,capability_family,source_table,source_key,
          operation_class,risk_class,runtime_status,exposure_scope,
          CASE WHEN operation_class='state_changing' THEN 'combined' ELSE 'invocation' END,
          resource_authority_required,dispatch_allowed,0,requires_audit_evidence,requires_readback,NULL,
          JSON_OBJECT('projection_source','platform_tool_dispatch_bindings','rollout_mode','shadow',
                      'apply_allowed',false,'source_notes',notes,'secrets_included',false),'active'
     FROM v_platform_virtual_tool_capabilities_current
   ON DUPLICATE KEY UPDATE
     resource_authority_required=GREATEST(platform_plugin_capabilities.resource_authority_required,VALUES(resource_authority_required)),
     dispatch_allowed=LEAST(platform_plugin_capabilities.dispatch_allowed,VALUES(dispatch_allowed)),
     apply_allowed=LEAST(platform_plugin_capabilities.apply_allowed,VALUES(apply_allowed)),
     requires_audit_evidence=GREATEST(platform_plugin_capabilities.requires_audit_evidence,VALUES(requires_audit_evidence)),
     requires_readback=GREATEST(platform_plugin_capabilities.requires_readback,VALUES(requires_readback)),
     updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_plugin_bindings
     (binding_key,capability_key,binding_family,source_table,source_key,binding_status,exposure_scope,
      credential_source,dispatch_allowed,apply_allowed,metadata_json)
   SELECT binding_key,capability_key,binding_family,source_table,source_key,binding_status,exposure_scope,
          credential_source,dispatch_allowed,0,
          JSON_OBJECT('notes',notes,'rollout_mode','shadow','secrets_included',false)
     FROM v_platform_virtual_tool_bindings_current
   ON DUPLICATE KEY UPDATE capability_key=VALUES(capability_key),binding_family=VALUES(binding_family),
     source_table=VALUES(source_table),source_key=VALUES(source_key),binding_status=VALUES(binding_status),
     exposure_scope=VALUES(exposure_scope),credential_source=VALUES(credential_source),
     dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=0,metadata_json=VALUES(metadata_json),
     updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_plugin_capability_exports
     (export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes)
   SELECT export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes
     FROM v_platform_virtual_tool_exports_current
   ON DUPLICATE KEY UPDATE capability_key=VALUES(capability_key),export_surface=VALUES(export_surface),
     source_table=VALUES(source_table),source_key=VALUES(source_key),export_status=VALUES(export_status),
     exposure_scope=VALUES(exposure_scope),http_method=VALUES(http_method),http_path=VALUES(http_path),
     notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_capability_source_links
     (link_id,capability_key,source_kind,source_ref,resolution_status,confidence,metadata_json)
   SELECT SHA2(CONCAT(capability_key,'|tool_dispatch_binding|',binding_id),256),capability_key,
          'tool_dispatch_binding',CONCAT('platform_tool_dispatch_bindings:',binding_id),'resolved',1.0000,
          JSON_OBJECT('tool_key',tool_key,'parent_action_key',parent_action_key,'endpoint_key',endpoint_key,
                      'runtime_surface',runtime_surface,'readback_policy_key',readback_policy_key,
                      'atomicity_mode',atomicity_mode,'secrets_included',false)
     FROM v_platform_virtual_tool_bindings_classified b
    WHERE b.capability_key IS NOT NULL
      AND EXISTS (SELECT 1 FROM v_platform_virtual_tool_capabilities_current c
                   WHERE c.capability_key=b.capability_key)
   ON DUPLICATE KEY UPDATE resolution_status='resolved',confidence=1.0000,
     metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_capability_readback_contracts
     (contract_id,contract_key,contract_version,capability_key,adapter_key,verification_type,
      acknowledgement_required,verification_required,expected_effect_class,input_schema_json,
      observed_state_schema_json,provider_binding_constraints_json,certification_status,status,is_current,
      valid_from,source_registry,source_key,secrets_included)
   SELECT UUID(),
          LEFT(CONCAT(LEFT(b.capability_key,80),'__',LEFT(b.readback_policy_key,80),'__',
                      LEFT(SHA2(CONCAT(b.capability_key,'|',b.readback_policy_key),256),16)),191),
          1,b.capability_key,MIN(b.runtime_surface),'same_cycle_readback',1,1,
          CASE WHEN c.operation_class='state_changing' THEN 'external_write' ELSE 'read_only' END,
          JSON_OBJECT('type','object','additionalProperties',true),
          JSON_OBJECT('type','object','required',JSON_ARRAY('verification_state','evidence_ref'),
                      'properties',JSON_OBJECT('verification_state',JSON_OBJECT('type','string'),
                                               'evidence_ref',JSON_OBJECT('type','string')),
                      'additionalProperties',false),
          JSON_OBJECT('source_registry','platform_tool_dispatch_bindings',
                      'readback_policy_key',b.readback_policy_key,
                      'runtime_surfaces',GROUP_CONCAT(DISTINCT b.runtime_surface ORDER BY b.runtime_surface SEPARATOR ','),
                      'shadow_only',true,'secrets_included',false),
          'pending','shadow',1,CURRENT_TIMESTAMP,'platform_tool_dispatch_bindings',b.readback_policy_key,0
     FROM v_platform_virtual_tool_bindings_classified b
     JOIN v_platform_virtual_tool_capabilities_current c ON c.capability_key=b.capability_key
    WHERE COALESCE(b.readback_policy_key,'')<>''
    GROUP BY b.capability_key,b.readback_policy_key,c.operation_class
   ON DUPLICATE KEY UPDATE adapter_key=VALUES(adapter_key),verification_type=VALUES(verification_type),
     acknowledgement_required=VALUES(acknowledgement_required),verification_required=VALUES(verification_required),
     expected_effect_class=VALUES(expected_effect_class),input_schema_json=VALUES(input_schema_json),
     observed_state_schema_json=VALUES(observed_state_schema_json),
     provider_binding_constraints_json=VALUES(provider_binding_constraints_json),
     certification_status=CASE WHEN platform_capability_readback_contracts.certification_status='certified'
                               THEN 'certified' ELSE VALUES(certification_status) END,
     status=CASE WHEN platform_capability_readback_contracts.status='certified'
                 THEN 'certified' ELSE VALUES(status) END,
     is_current=1,source_registry=VALUES(source_registry),source_key=VALUES(source_key),
     secrets_included=0,updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_capability_source_links
     (link_id,capability_key,source_kind,source_ref,resolution_status,confidence,metadata_json)
   SELECT SHA2(CONCAT(capability_key,'|readback_contract|',contract_key),256),capability_key,
          'readback_contract_registry',CONCAT('platform_capability_readback_contracts:',contract_key),
          'resolved',1.0000,
          JSON_OBJECT('contract_key',contract_key,'status',status,
                      'certification_status',certification_status,'secrets_included',false)
     FROM platform_capability_readback_contracts
    WHERE source_registry='platform_tool_dispatch_bindings' AND is_current=1
   ON DUPLICATE KEY UPDATE resolution_status='resolved',confidence=1.0000,
     metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP`,
  `INSERT INTO platform_capability_debt
     (debt_id,capability_key,gap_key,severity,source_view,status,blocks_dispatch,blocks_apply,recommended_fix,metadata_json)
   SELECT SHA2(CONCAT(capability_key,'|',gap_key),256),capability_key,gap_key,gap_severity,
          'v_platform_virtual_tool_capability_gaps','open',
          CASE WHEN gap_key IN ('CAPABILITY_IDENTITY_MISSING','CAPABILITY_AMBIGUOUS',
                                'PROJECTION_SCOPE_AMBIGUOUS','OPERATION_CLASS_AMBIGUOUS',
                                'TENANT_TO_ADMIN_SURFACE_BLOCKED','CAPABILITY_IDENTITY_TOO_LONG') THEN 1 ELSE 0 END,
          1,gap_description,
          JSON_OBJECT('reconciled_by','platform_virtual_tool_capability_reconcile','secrets_included',false)
     FROM v_platform_virtual_tool_capability_gaps
   ON DUPLICATE KEY UPDATE severity=VALUES(severity),
     status=CASE WHEN platform_capability_debt.status='resolved' THEN 'open' ELSE platform_capability_debt.status END,
     resolved_at=NULL,blocks_dispatch=VALUES(blocks_dispatch),blocks_apply=VALUES(blocks_apply),
     recommended_fix=VALUES(recommended_fix),last_seen_at=CURRENT_TIMESTAMP,
     metadata_json=VALUES(metadata_json)`,
  `UPDATE platform_capability_debt d
      SET d.status='resolved',d.resolved_at=CURRENT_TIMESTAMP,d.last_seen_at=CURRENT_TIMESTAMP
    WHERE d.source_view='v_platform_virtual_tool_capability_gaps'
      AND d.status IN ('open','in_progress')
      AND NOT EXISTS (SELECT 1 FROM v_platform_virtual_tool_capability_gaps g
                       WHERE g.capability_key=d.capability_key AND g.gap_key=d.gap_key)`,
];

export async function reconcileVirtualToolCapabilities(connection) {
  if (!connection || typeof connection.query !== "function") {
    throw Object.assign(new Error("A transactional database connection is required"), {
      code: "virtual_tool_reconcile_connection_required",
    });
  }
  for (const sql of VIRTUAL_TOOL_RECONCILIATION_SQL) await connection.query(sql);
  return {
    ok: true,
    statements_executed: VIRTUAL_TOOL_RECONCILIATION_SQL.length,
    provider_calls_made: 0,
    external_writes_made: 0,
    secrets_included: false,
  };
}
