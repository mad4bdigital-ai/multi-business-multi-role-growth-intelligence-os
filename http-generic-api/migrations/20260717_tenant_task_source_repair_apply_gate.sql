-- Task Source Repair Apply Gate.
-- Additive governed registration only.
-- Internal tenant task-registry mutation; no provider call, no external write,
-- no credential payload read, no resolved transition, and no secrets.

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`,`display_name`,`description`,`http_method`,`http_path`,`path_param_keys`,`input_schema`,`fixed_body`,`tags`,`is_enabled`,`sort_order`)
VALUES
  ('tenant_resolution_apply',
   'Apply Tenant Task Source Repair',
   'Apply an approved Task Source Repair preflight to one tenant-owned pending task. Requires a matching apply-authorized capability envelope, approved hold, typed confirmation, no drift, and moves the case only to verifying.',
   'POST','/tenant/resolution/cases/{caseId}/task-source-repair/apply',JSON_ARRAY('caseId'),
   JSON_OBJECT('type','object','required',JSON_ARRAY('preview_fingerprint_sha256','capability_envelope_id','approval_hold_id','confirm'),
     'properties',JSON_OBJECT(
       'caseId',JSON_OBJECT('type','string','maxLength',64),
       'workspace_id',JSON_OBJECT('type','string','maxLength',64),
       'preview_fingerprint_sha256',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
       'capability_envelope_id',JSON_OBJECT('type','string','maxLength',64),
       'approval_hold_id',JSON_OBJECT('type','string','maxLength',64),
       'confirm',JSON_OBJECT('type','string','maxLength',80)
     ),'additionalProperties',FALSE),NULL,
   'tenant,activation,state_changing,approval,capability_envelope,typed_confirmation,same_cycle_dry_run,no_provider_call,no_external_write,no_secrets',
   1,420)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),description=VALUES(description),http_method=VALUES(http_method),
  http_path=VALUES(http_path),path_param_keys=VALUES(path_param_keys),input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body),tags=VALUES(tags),is_enabled=VALUES(is_enabled),sort_order=VALUES(sort_order);

INSERT INTO `platform_plugin_capabilities`
  (`capability_key`,`plugin_key`,`display_name`,`capability_family`,`source_table`,`source_key`,`operation_class`,`risk_class`,
   `runtime_status`,`exposure_scope`,`authority_requirement_type`,`resource_authority_required`,`dispatch_allowed`,`apply_allowed`,
   `requires_audit_evidence`,`requires_readback`,`legacy_evidence_ref`,`metadata_json`,`status`)
VALUES
  ('tenant_task_source_repair','platform_orchestration','Tenant Task Source Repair Apply Gate',
   'tenant_resolution','tenant_platform_endpoint_tools','tenant_resolution_apply','internal_write','C',
   'shadow','tenant','approval',1,1,0,1,1,
   'migration:20260717_tenant_task_source_repair_apply_gate.sql',
   JSON_OBJECT('root_family','task_source_quality','playbook_key','task_source_repair_v1',
     'typed_confirmation_required',true,'same_cycle_dry_run_required',true,'approved_hold_required',true,
     'task_registry_write_tables',JSON_ARRAY('platform_pending_tasks'),
     'provider_calls',false,'external_writes',false,'resolved_transition_allowed',false,'secrets_included',false),
   'active')
ON DUPLICATE KEY UPDATE
  plugin_key=VALUES(plugin_key),display_name=VALUES(display_name),capability_family=VALUES(capability_family),
  source_table=VALUES(source_table),source_key=VALUES(source_key),operation_class=VALUES(operation_class),risk_class=VALUES(risk_class),
  runtime_status=VALUES(runtime_status),exposure_scope=VALUES(exposure_scope),authority_requirement_type=VALUES(authority_requirement_type),
  resource_authority_required=VALUES(resource_authority_required),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),
  legacy_evidence_ref=VALUES(legacy_evidence_ref),metadata_json=VALUES(metadata_json),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_bindings`
  (`binding_key`,`capability_key`,`binding_family`,`source_table`,`source_key`,`binding_status`,`exposure_scope`,
   `credential_source`,`dispatch_allowed`,`apply_allowed`,`metadata_json`)
VALUES
  ('binding:tenant:tenant_task_source_repair','tenant_task_source_repair','tenant_platform_tool',
   'tenant_platform_endpoint_tools','tenant_resolution_apply','active','tenant','none',1,0,
   JSON_OBJECT('runtime_surface','tenant_resolution_apply','operation_intent','tenant_resolution_apply',
     'capability_envelope_required',true,'approval_hold_required',true,'typed_confirmation_required',true,
     'same_cycle_dry_run_required',true,'same_cycle_readback_required',true,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),binding_family=VALUES(binding_family),source_table=VALUES(source_table),
  source_key=VALUES(source_key),binding_status=VALUES(binding_status),exposure_scope=VALUES(exposure_scope),
  credential_source=VALUES(credential_source),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_capability_exports`
  (`export_key`,`capability_key`,`export_surface`,`source_table`,`source_key`,`export_status`,`exposure_scope`,`http_method`,`http_path`,`notes`)
VALUES
  ('export:tenant:tenant_task_source_repair','tenant_task_source_repair','tenant_platform_tool',
   'tenant_platform_endpoint_tools','tenant_resolution_apply','active','tenant','POST',
   '/tenant/resolution/cases/{caseId}/task-source-repair/apply',
   'Tenant-scoped internal SQL apply gate. Provider calls, external writes, task-id changes, resolved transitions, and secrets are forbidden.')
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),export_surface=VALUES(export_surface),source_table=VALUES(source_table),
  source_key=VALUES(source_key),export_status=VALUES(export_status),exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method),http_path=VALUES(http_path),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `app_integration_tool_bindings`
  (`binding_id`,`app_key`,`tool_key`,`tool_surface`,`binding_role`,`credential_source`,`exposure_scope`,`status`,`notes`)
VALUES
  ('bind_tool_tenant_resolution_apply','platform_orchestration','tenant_resolution_apply',
   'tenant_platform_tool','state_changing','none','tenant','active',
   'Apply-authorized internal task-registry write only. No provider call, external write, resolved transition, or secrets.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),tool_key=VALUES(tool_key),tool_surface=VALUES(tool_surface),binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),exposure_scope=VALUES(exposure_scope),status=VALUES(status),
  notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `runtime_dispatch_certification_registry`
  (`certification_key`,`surface_key`,`surface_family`,`tool_or_action_key`,`risk_class`,`certification_status`,`smoke_strategy`,
   `dispatch_allowed`,`apply_allowed`,`requires_resource_authority`,`requires_dry_run`,`requires_audit_evidence`,`requires_readback`,
   `last_evidence_ref`,`last_certified_at`,`notes`)
VALUES
  ('tenant_task_source_repair','tenant_resolution_apply','tenant_resolution','tenant_resolution_apply','C',
   'migration_registered_apply_envelope_required',
   'approved_preview_fingerprint_plus_typed_confirmation_plus_hold_plus_no_drift_then_internal_update_and_verifying_transition',
   1,0,1,1,1,1,'migration:20260717_tenant_task_source_repair_apply_gate.sql',CURRENT_TIMESTAMP,
   'Dispatch is registered. Apply remains capability-envelope and approval-hold gated and ends at verifying.')
ON DUPLICATE KEY UPDATE
  surface_key=VALUES(surface_key),surface_family=VALUES(surface_family),tool_or_action_key=VALUES(tool_or_action_key),
  risk_class=VALUES(risk_class),certification_status=VALUES(certification_status),smoke_strategy=VALUES(smoke_strategy),
  dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  requires_resource_authority=VALUES(requires_resource_authority),requires_dry_run=VALUES(requires_dry_run),
  requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),
  last_evidence_ref=VALUES(last_evidence_ref),last_certified_at=VALUES(last_certified_at),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `capability_apply_authorization_policy_registry`
  (`policy_key`,`app_key`,`capability_key`,`operation_intent`,`runtime_surface`,`status`,`allow_external_write`,
   `allow_credential_binding`,`allow_no_credential_binding`,`requires_ready_for_dispatch`,`requires_dispatch_allowed`,
   `requires_zero_blocking_gaps`,`requires_audit_evidence`,`requires_readback`,`requires_typed_confirmation`,
   `requires_same_cycle_dry_run`,`allowed_source_tiers_json`,`policy_json`,`notes`)
VALUES
  ('tenant_task_source_repair_apply_v1','platform_orchestration','tenant_task_source_repair',
   'tenant_resolution_apply','tenant_resolution_apply','active',0,0,1,1,1,1,1,1,1,1,
   JSON_ARRAY('platform_managed_fallback','tenant_managed'),
   JSON_OBJECT('external_write_allowed',false,'provider_call_allowed',false,'credential_payload_read_allowed',false,
     'internal_registry_write_expected',true,'allowed_write_tables',JSON_ARRAY('platform_pending_tasks','tenant_resolution_cases','tenant_resolution_case_events'),
     'allowed_task_fields',JSON_ARRAY('task_key','title','source_surface','source_ref'),
     'task_id_change_allowed',false,'tenant_scope_change_allowed',false,'resolved_transition_allowed',false,
     'requires_preview_fingerprint',true,'requires_approved_hold',true,'requires_no_drift',true,
     'requires_typed_confirmation',true,'same_cycle_dry_run',true,'same_cycle_readback_required',true,'secrets_included',false),
   'Authorize only a ready Task Source Repair preview for one tenant-owned pending task and stop at verifying.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),capability_key=VALUES(capability_key),operation_intent=VALUES(operation_intent),
  runtime_surface=VALUES(runtime_surface),status=VALUES(status),allow_external_write=VALUES(allow_external_write),
  allow_credential_binding=VALUES(allow_credential_binding),allow_no_credential_binding=VALUES(allow_no_credential_binding),
  requires_ready_for_dispatch=VALUES(requires_ready_for_dispatch),requires_dispatch_allowed=VALUES(requires_dispatch_allowed),
  requires_zero_blocking_gaps=VALUES(requires_zero_blocking_gaps),requires_audit_evidence=VALUES(requires_audit_evidence),
  requires_readback=VALUES(requires_readback),requires_typed_confirmation=VALUES(requires_typed_confirmation),
  requires_same_cycle_dry_run=VALUES(requires_same_cycle_dry_run),allowed_source_tiers_json=VALUES(allowed_source_tiers_json),
  policy_json=VALUES(policy_json),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `execution_policies`
  (`policy_group`,`policy_key`,`policy_value`,`active`,`execution_scope`,`affects_layer`,`blocking`,`notes`)
SELECT
  'Tenant Resolution','tenant_task_source_repair_apply_policy_v1',
  JSON_OBJECT('rule','tenant_task_source_repair_apply','requires',JSON_ARRAY('ready_to_apply_case','approved_preview_fingerprint',
      'approved_capability_envelope','approved_hold','typed_confirmation','no_drift','transaction','verifying_transition'),
    'allowed_write_tables',JSON_ARRAY('platform_pending_tasks','tenant_resolution_cases','tenant_resolution_case_events'),
    'allowed_task_fields',JSON_ARRAY('task_key','title','source_surface','source_ref'),
    'task_id_change_forbidden',true,'tenant_scope_change_forbidden',true,'provider_call_forbidden',true,
    'external_write_forbidden',true,'resolved_transition_forbidden',true,'secrets_included',false),
  'TRUE','tenant_resolution_apply|gpt_tools_call|tool_dispatch|internal_registry_write',
  'tenantTaskSourceRepairApplyService|platform_pending_tasks|tenant_resolution_cases|tenant_resolution_case_events',
  'TRUE','Blocking apply-gate policy. Runtime must consume the envelope only after the internal mutation and must stop at verifying.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Tenant Resolution'
     AND `policy_key`='tenant_task_source_repair_apply_policy_v1'
);

INSERT INTO `governed_migration_authorization_registry`
  (`migration_file`,`authorization_status`,`authorization_source`,`policy_key`,`risk_tier`,`requires_preflight`,`requires_confirmation`,`allow_record_only`,`allow_apply`,`notes`,`metadata_json`)
VALUES
  ('20260717_tenant_task_source_repair_apply_gate.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize additive registration of the tenant Task Source Repair Apply Gate. Runtime apply remains separately envelope and approval gated.',
   JSON_OBJECT('scope','tenant_task_source_repair_apply_gate_registration','runtime_apply_included',false,
     'provider_calls',false,'external_writes',false,'resolved_transitions',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),authorization_source=VALUES(authorization_source),policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),requires_preflight=VALUES(requires_preflight),requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),allow_apply=VALUES(allow_apply),notes=VALUES(notes),metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
