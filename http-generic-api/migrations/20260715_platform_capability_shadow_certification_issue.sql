-- Governed fixed shadow certification writer for one read-only Tenant connection capability.
-- Additive Admin registration only; certification issue is a separate envelope-gated operation.
-- no_provider_call
-- no_external_write
-- no_tenant_authority_change
-- no_tenant_tool_enablement
-- no_runtime_dispatch_change_for_target
-- no_active_tenant_export_creation
-- secrets_included=false

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`,`display_name`,`description`,`http_method`,`http_path`,`path_param_keys`,`input_schema`,`fixed_body`,`tags`,`is_enabled`,`sort_order`)
VALUES
  ('platform_capability_shadow_certification_issue','Issue Fixed Platform Capability Shadow Certification',
   'Dry-run or apply one fixed shadow certification for tenant_connection_effective_credential_plan_view. Apply requires typed confirmation and an apply-authorized platform_orchestration capability envelope. It keeps the Tenant tool disabled, keeps the readback contract status shadow, never writes runtime dispatch certification, creates no active Tenant export, calls no provider, and returns no secrets.',
   'VIRTUAL','internal://platform-capability-shadow-certification-issue',JSON_ARRAY(),
   JSON_OBJECT(
     'type','object','properties',JSON_OBJECT(
       'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply'),'default','dry_run'),
       'expected_plan_hash',JSON_OBJECT('type','string','pattern','^[0-9a-f]{64}$'),
       'confirm',JSON_OBJECT('type','string','const','ISSUE_SHADOW_CERTIFICATION_TENANT_CONNECTION_EFFECTIVE_CREDENTIAL_PLAN_VIEW'),
       'capability_envelope_id',JSON_OBJECT('type','string','minLength',1,'maxLength',64)
     ),'additionalProperties',FALSE
   ),NULL,
   'admin,capability,tenant_connection,certification,shadow,read_only,state_changing,dry_run_default,typed_confirmation,capability_envelope,same_cycle_readback,no_provider_call,no_external_write,no_tenant_authority_change,no_runtime_dispatch_change,no_secrets',
   1,747)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),description=VALUES(description),http_method=VALUES(http_method),
  http_path=VALUES(http_path),path_param_keys=VALUES(path_param_keys),input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body),tags=VALUES(tags),is_enabled=VALUES(is_enabled),sort_order=VALUES(sort_order),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_capabilities`
  (`capability_key`,`plugin_key`,`display_name`,`capability_family`,`source_table`,`source_key`,`operation_class`,`risk_class`,
   `runtime_status`,`exposure_scope`,`authority_requirement_type`,`resource_authority_required`,`dispatch_allowed`,`apply_allowed`,
   `requires_audit_evidence`,`requires_readback`,`legacy_evidence_ref`,`metadata_json`,`status`)
VALUES
  ('platform_capability_shadow_certification_issue','platform_orchestration',
   'Issue Fixed Platform Capability Shadow Certification','capability_governance','virtual_admin_tools',
   'platform_capability_shadow_certification_issue','internal_write','C','shadow','admin','approval',0,1,0,1,1,
   'migration:20260715_platform_capability_shadow_certification_issue.sql',
   JSON_OBJECT('typed_confirmation','ISSUE_SHADOW_CERTIFICATION_TENANT_CONNECTION_EFFECTIVE_CREDENTIAL_PLAN_VIEW',
               'same_cycle_readback',true,'fixed_capability_key','tenant_tool.tenant_connection_effective_credential_plan_view',
               'fixed_contract_key','tenant_connection_effective_credential_plan_view_readback_v1',
               'certification_status','shadow_certified','contract_status_after','shadow',
               'target_tool_enabled_after',false,'runtime_dispatch_changed',false,
               'active_tenant_exports_created',false,'provider_calls',false,
               'external_writes',false,'tenant_authority_changes',false,'secrets_included',false),'active')
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
  ('binding:admin:platform_capability_shadow_certification_issue','platform_capability_shadow_certification_issue',
   'admin_virtual_tool','virtual_admin_tools','platform_capability_shadow_certification_issue','active','admin','none',1,0,
   JSON_OBJECT('runtime_surface','platform_capability_shadow_certification_issue','capability_envelope_required',true,
               'typed_confirmation_required',true,'same_cycle_readback',true,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),binding_family=VALUES(binding_family),source_table=VALUES(source_table),
  source_key=VALUES(source_key),binding_status=VALUES(binding_status),exposure_scope=VALUES(exposure_scope),
  credential_source=VALUES(credential_source),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `platform_plugin_capability_exports`
  (`export_key`,`capability_key`,`export_surface`,`source_table`,`source_key`,`export_status`,`exposure_scope`,`http_method`,`http_path`,`notes`)
VALUES
  ('export:admin:platform_capability_shadow_certification_issue','platform_capability_shadow_certification_issue',
   'admin_virtual_tool','virtual_admin_tools','platform_capability_shadow_certification_issue','active','admin','VIRTUAL',
   'internal://platform-capability-shadow-certification-issue',
   'Admin-only internal writer. It does not create active Tenant exports or enable Tenant tools.')
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),export_surface=VALUES(export_surface),source_table=VALUES(source_table),
  source_key=VALUES(source_key),export_status=VALUES(export_status),exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method),http_path=VALUES(http_path),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `app_integration_action_bindings`
  (`binding_id`,`app_key`,`action_key`,`binding_role`,`credential_source`,`exposure_default`,`status`,`notes`)
VALUES
  ('bind_action_platform_capability_shadow_cert_issue','platform_orchestration',
   'platform_capability_shadow_certification_issue','resolver','none','manual_tools','active',
   'Internal no-credential writer for one fixed read-only shadow certification.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),action_key=VALUES(action_key),binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),exposure_default=VALUES(exposure_default),status=VALUES(status),
  notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `app_integration_tool_bindings`
  (`binding_id`,`app_key`,`tool_key`,`tool_surface`,`binding_role`,`credential_source`,`exposure_scope`,`status`,`notes`)
VALUES
  ('bind_tool_platform_capability_shadow_cert_issue','platform_orchestration',
   'platform_capability_shadow_certification_issue','admin_platform_tool','state_changing','none','admin','active',
   'Apply-authorized internal registry write only. No runtime dispatch change, provider calls, external writes, Tenant authority changes, or secrets.')
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),tool_key=VALUES(tool_key),tool_surface=VALUES(tool_surface),binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),exposure_scope=VALUES(exposure_scope),status=VALUES(status),
  notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `runtime_dispatch_certification_registry`
  (`certification_key`,`surface_key`,`surface_family`,`tool_or_action_key`,`risk_class`,`certification_status`,`smoke_strategy`,
   `dispatch_allowed`,`apply_allowed`,`requires_resource_authority`,`requires_dry_run`,`requires_audit_evidence`,`requires_readback`,
   `last_evidence_ref`,`last_certified_at`,`expires_at`,`notes`)
VALUES
  ('platform_capability_shadow_certification_issue','platform_capability_shadow_certification_issue','capability_governance',
   'platform_capability_shadow_certification_issue','C','migration_registered_apply_envelope_required',
   'fixed_read_only_shadow_certification_same_cycle_readback',1,0,0,1,1,1,
   'migration:20260715_platform_capability_shadow_certification_issue.sql',CURRENT_TIMESTAMP,NULL,
   'This certification applies only to the Admin writer. It does not certify or enable the target Tenant tool for runtime dispatch.')
ON DUPLICATE KEY UPDATE
  certification_status=VALUES(certification_status),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  requires_resource_authority=VALUES(requires_resource_authority),requires_dry_run=VALUES(requires_dry_run),
  requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),
  last_evidence_ref=VALUES(last_evidence_ref),last_certified_at=VALUES(last_certified_at),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO `capability_apply_authorization_policy_registry`
  (`policy_key`,`app_key`,`capability_key`,`operation_intent`,`runtime_surface`,`status`,`allow_external_write`,
   `allow_credential_binding`,`allow_no_credential_binding`,`requires_ready_for_dispatch`,`requires_dispatch_allowed`,
   `requires_zero_blocking_gaps`,`requires_audit_evidence`,`requires_readback`,`requires_typed_confirmation`,
   `requires_same_cycle_dry_run`,`allowed_source_tiers_json`,`policy_json`,`notes`)
VALUES
  ('platform_capability_shadow_certification_issue_apply_v1','platform_orchestration',
   'platform_capability_shadow_certification_issue','platform_capability_shadow_certification_issue',
   'platform_capability_shadow_certification_issue','active',0,0,1,1,1,1,1,1,1,1,
   JSON_ARRAY('platform_managed_fallback','tenant_managed'),
   JSON_OBJECT('external_write_allowed',false,'provider_call_allowed',false,'credential_payload_read_allowed',false,
               'tenant_authority_change_allowed',false,'internal_registry_write_expected',true,
               'typed_confirmation','ISSUE_SHADOW_CERTIFICATION_TENANT_CONNECTION_EFFECTIVE_CREDENTIAL_PLAN_VIEW',
               'fixed_capability_key','tenant_tool.tenant_connection_effective_credential_plan_view',
               'fixed_contract_key','tenant_connection_effective_credential_plan_view_readback_v1',
               'certification_status','shadow_certified','contract_status_after','shadow',
               'tenant_tool_enablement_change_allowed',false,'runtime_dispatch_change_allowed',false,
               'active_tenant_export_creation_allowed',false,'same_cycle_readback',true,'secrets_included',false),
   'Authorize only the fixed read-only shadow certification after dry-run and explicit typed confirmation.')
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
  'Tenant Connection Self Repair','platform_capability_shadow_certification_issue_policy_v1',
  JSON_OBJECT('rule','platform_capability_shadow_certification_issue','tool_key','platform_capability_shadow_certification_issue',
              'requires',JSON_ARRAY('approved_capability_envelope','apply_allowed','expected_plan_hash',
                                    'typed_confirmation','same_cycle_readback'),
              'writes_tables',JSON_ARRAY('platform_capability_certifications','platform_evidence_events',
                                         'platform_capability_readback_contracts'),
              'fixed_capability_key','tenant_tool.tenant_connection_effective_credential_plan_view',
              'fixed_contract_key','tenant_connection_effective_credential_plan_view_readback_v1',
              'certification_status','shadow_certified','contract_status_after','shadow',
              'tenant_tool_enablement_forbidden',true,'runtime_dispatch_change_forbidden',true,
              'active_tenant_export_creation_forbidden',true,'no_provider_call',true,
              'no_external_write',true,'no_tenant_authority_change',true,'secrets_included',false),
  'TRUE','gpt_tools_call|tool_dispatch|platform_capability_shadow_certification_issue|internal_registry_write',
  'gptToolsRoutes|platformCapabilityShadowCertificationIssuer|platform_capability_certifications|platform_evidence_events|platform_capability_readback_contracts',
  'TRUE','Blocking fixed shadow certification policy. Runtime must preserve Tenant catalog disabled state, shadow contract status, no target runtime dispatch certification, transaction, and same-cycle readback.'
WHERE NOT EXISTS (
  SELECT 1 FROM `execution_policies`
   WHERE `policy_group`='Tenant Connection Self Repair'
     AND `policy_key`='platform_capability_shadow_certification_issue_policy_v1'
);

INSERT INTO `governed_migration_authorization_registry`
  (`migration_file`,`authorization_status`,`authorization_source`,`policy_key`,`risk_tier`,`requires_preflight`,`requires_confirmation`,`allow_record_only`,`allow_apply`,`notes`,`metadata_json`)
VALUES
  ('20260715_platform_capability_shadow_certification_issue.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize additive Admin writer registration only. Shadow certification issue remains separately envelope-gated.',
   JSON_OBJECT('scope','platform_capability_shadow_certification_issue_tool_registration',
               'certification_issue_included',false,'tenant_tools_enabled',false,'runtime_dispatch_changed',false,
               'active_tenant_exports_created',false,'provider_calls',false,'external_writes',false,
               'tenant_authority_changes',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),authorization_source=VALUES(authorization_source),policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),requires_preflight=VALUES(requires_preflight),requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),allow_apply=VALUES(allow_apply),notes=VALUES(notes),metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
