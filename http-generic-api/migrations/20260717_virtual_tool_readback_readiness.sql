-- Spec 007: bind virtual governed tools to explicit readback contracts and readiness.
-- Additive SQL-primary registry update only. No provider execution or runtime cutover.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

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
              'properties',JSON_OBJECT(
                'verification_state',JSON_OBJECT('type','string'),
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

CREATE OR REPLACE VIEW v_platform_capability_readiness_vector AS
SELECT
  c.capability_key,c.display_name,c.capability_family,c.source_table,c.source_key,c.operation_class,c.risk_class,
  c.runtime_status,c.exposure_scope,c.authority_requirement_type,c.resource_authority_required,
  1 AS discoverable,
  1 AS registered,
  CASE WHEN c.exposure_scope NOT IN ('admin','tenant') OR EXISTS (
    SELECT 1 FROM platform_plugin_capability_exports x WHERE x.capability_key=c.capability_key AND x.export_status='active'
  ) THEN 1 ELSE 0 END AS exported,
  CASE WHEN c.dispatch_allowed=1 THEN 1 ELSE 0 END AS routable,
  1 AS authority_model_ready,
  CASE
    WHEN c.authority_requirement_type IN ('none','invocation','approval','quota') THEN 1
    WHEN c.legacy_evidence_ref IS NOT NULL THEN 1
    WHEN EXISTS (
      SELECT 1
      FROM platform_capability_envelope_binding_links bl
      JOIN capability_resolution_envelope_ledger e ON e.envelope_id=bl.envelope_id
      JOIN v_effective_platform_resource_authority_bindings eb ON eb.binding_id=bl.binding_id
      WHERE bl.status='active' AND e.envelope_status='ready_for_dispatch' AND e.dispatch_allowed=1
        AND (e.expires_at IS NULL OR e.expires_at>CURRENT_TIMESTAMP)
        AND e.capability_key IN (c.capability_key,c.source_key)
    ) THEN 1 ELSE 0
  END AS resource_binding_ready,
  CASE WHEN c.dispatch_allowed=1 THEN 1 ELSE 0 END AS dispatchable,
  CASE WHEN c.apply_allowed=1 THEN 1 ELSE 0 END AS applyable,
  CASE WHEN c.requires_readback=0 THEN 1
       WHEN EXISTS (SELECT 1 FROM v_platform_capability_readback_readiness rb
                     WHERE rb.capability_key=c.capability_key
                       AND rb.readiness_state IN ('ready','shadow_only')) THEN 1
       ELSE 0 END AS readback_contract_ready,
  CASE WHEN EXISTS (SELECT 1 FROM platform_capability_certifications pc
                     WHERE pc.capability_key=c.capability_key AND pc.revoked_at IS NULL
                       AND pc.certification_status NOT IN ('failed','blocked','revoked','expired')
                       AND (pc.expires_at IS NULL OR pc.expires_at>CURRENT_TIMESTAMP))
       OR c.runtime_status IN ('read_only_certified','diagnostic_certified','certified') THEN 1 ELSE 0 END AS certified,
  CASE WHEN EXISTS (SELECT 1 FROM platform_capability_source_links sl
                     WHERE sl.capability_key=c.capability_key AND sl.resolution_status='resolved') THEN 1 ELSE 0 END AS provenance_ready,
  CASE WHEN EXISTS (SELECT 1 FROM platform_evidence_events ev
                     WHERE ev.capability_key=c.capability_key AND ev.evidence_status='passed' AND ev.revoked_at IS NULL
                       AND (ev.expires_at IS NULL OR ev.expires_at>CURRENT_TIMESTAMP)) THEN 1 ELSE 0 END AS evidence_linked,
  c.dispatch_allowed,c.apply_allowed,c.requires_audit_evidence,c.requires_readback,c.legacy_evidence_ref,
  (
    CASE WHEN c.dispatch_allowed=0 THEN 1 ELSE 0 END +
    CASE WHEN c.authority_requirement_type IN ('resource','combined') AND c.legacy_evidence_ref IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM platform_capability_envelope_binding_links bl
                JOIN capability_resolution_envelope_ledger e ON e.envelope_id=bl.envelope_id
                JOIN v_effective_platform_resource_authority_bindings eb ON eb.binding_id=bl.binding_id
                WHERE bl.status='active' AND e.envelope_status='ready_for_dispatch' AND e.dispatch_allowed=1
                  AND (e.expires_at IS NULL OR e.expires_at>CURRENT_TIMESTAMP)
                  AND e.capability_key IN (c.capability_key,c.source_key)
              ) THEN 1 ELSE 0 END +
    CASE WHEN c.requires_readback=1 AND NOT EXISTS (
      SELECT 1 FROM v_platform_capability_readback_readiness rb
      WHERE rb.capability_key=c.capability_key AND rb.readiness_state IN ('ready','shadow_only')
    ) THEN 1 ELSE 0 END
  ) AS hard_block_count
FROM platform_plugin_capabilities c
WHERE c.status='active';
