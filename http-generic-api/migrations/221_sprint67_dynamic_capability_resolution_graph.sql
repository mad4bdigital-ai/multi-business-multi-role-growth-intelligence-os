-- Sprint 67: Dynamic Capability Resolution Graph.
-- Scope: runtime policy/config + governed dry-run tool registration.
-- This migration does not execute any app/tool/runtime, does not read secrets,
-- and does not expand workspace_registry.workspace_type enum. Extended workspace
-- archetypes are policy-context labels until a dedicated schema migration is approved.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('dynamic_capability_source_tiers_v1',
   JSON_OBJECT(
     'policy_key','dynamic_capability_source_tiers_v1',
     'status','active',
     'source_tiers',JSON_ARRAY(
       JSON_OBJECT('source_tier','user_owned_personal','credential_owner','user','runtime_owner','user_or_local_device','can_read',true,'can_write',false,'can_publish',false,'can_deploy',false,'requires_user_consent',true,'requires_quota',false,'requires_disclosure',false,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','workspace_owner_managed','credential_owner','workspace_owner','runtime_owner','workspace','can_read',true,'can_write',true,'can_publish',true,'can_deploy',false,'requires_user_consent',true,'requires_quota',false,'requires_disclosure',true,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','freelancer_managed_service','credential_owner','freelancer_workspace_owner','runtime_owner','workspace','can_read',true,'can_write',true,'can_publish',true,'can_deploy',false,'requires_user_consent',true,'requires_quota',false,'requires_disclosure',true,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','agency_managed_service','credential_owner','agency_workspace_owner','runtime_owner','workspace','can_read',true,'can_write',true,'can_publish',true,'can_deploy',false,'requires_user_consent',true,'requires_quota',false,'requires_disclosure',true,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','tenant_managed','credential_owner','tenant','runtime_owner','tenant','can_read',true,'can_write',true,'can_publish',true,'can_deploy',false,'requires_user_consent',false,'requires_quota',false,'requires_disclosure',true,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','brand_managed','credential_owner','brand','runtime_owner','brand_or_tenant','can_read',true,'can_write',true,'can_publish',true,'can_deploy',false,'requires_brand_core',true,'requires_quota',false,'requires_disclosure',true,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','client_dedicated','credential_owner','client_or_resource_owner','runtime_owner','client_or_resource_owner','can_read',true,'can_write',true,'can_publish',true,'can_deploy',true,'requires_resource_authority',true,'requires_quota',false,'requires_disclosure',false,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','local_device_runtime','credential_owner','user_or_workspace','runtime_owner','local_device','can_read',true,'can_write',false,'can_publish',false,'can_deploy',false,'requires_local_manager_device',true,'requires_dispatch_certification',true,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','remote_dedicated_runtime','credential_owner','resource_owner','runtime_owner','remote_target','can_read',true,'can_write',true,'can_publish',false,'can_deploy',true,'requires_resource_authority',true,'requires_dispatch_certification',true,'requires_readback',true,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','platform_managed_fallback','credential_owner','platform','runtime_owner','platform','can_read',true,'can_write',false,'can_publish',false,'can_deploy',false,'requires_quota',true,'requires_audit_log',true,'requires_user_disclosure',true,'requires_policy_allowance',true,'temporary_until_dedicated_or_enterprise',true,'secrets_returned_to_agent',false),
       JSON_OBJECT('source_tier','blocked_requires_setup','credential_owner','none','runtime_owner','none','can_read',false,'can_write',false,'can_publish',false,'can_deploy',false,'requires_setup',true,'secrets_returned_to_agent',false)
     ),
     'secrets_included',false
   ),
   'active',
   'Dynamic source tier registry for capability resolution. Policy-only; no secrets.'
  ),
  ('dynamic_capability_resolution_policy_v1',
   JSON_OBJECT(
     'policy_key','dynamic_capability_resolution_policy_v1',
     'status','active',
     'resolver_tool_key','capability_resolution_dry_run',
     'source_tier_policy_key','dynamic_capability_source_tiers_v1',
     'current_workspace_type_enum',JSON_ARRAY('brand','project','campaign','sandbox'),
     'extended_workspace_archetypes_policy_only',JSON_ARRAY('personal_workspace','freelancer_workspace','agency_workspace','client_workspace','brand_workspace','project_workspace','campaign_workspace','sandbox_workspace'),
     'source_tier_priority_default',JSON_ARRAY('client_dedicated','brand_managed','user_owned_personal','workspace_owner_managed','freelancer_managed_service','agency_managed_service','tenant_managed','remote_dedicated_runtime','local_device_runtime','platform_managed_fallback','blocked_requires_setup'),
     'source_tier_priority_high_risk',JSON_ARRAY('client_dedicated','remote_dedicated_runtime','brand_managed','tenant_managed','workspace_owner_managed','freelancer_managed_service','agency_managed_service','local_device_runtime','user_owned_personal','platform_managed_fallback','blocked_requires_setup'),
     'context_dimensions',JSON_ARRAY('tenant_id','workspace_id','workspace_type','user_id','user_role','brand_key','business_activity_type','app_key','capability_key','operation_intent','runtime_surface'),
     'authority_surfaces',JSON_ARRAY('workspace_resource_grants','brand_core','business_activity_types','credential_bindings','user_app_connections','runtime_dispatch_certification_registry','v_app_integration_capability_map'),
     'risk_intents',JSON_OBJECT(
       'low',JSON_ARRAY('read','list','search','inspect_metadata'),
       'medium',JSON_ARRAY('diagnose','validate','draft','plan','probe','inspect'),
       'high',JSON_ARRAY('write','publish','apply','mutate','update','create'),
       'critical',JSON_ARRAY('delete','credential_promote','spend','deploy','restart','ssh','shell')
     ),
     'mandatory_gates',JSON_OBJECT(
       'no_secrets_returned',true,
       'dry_run_before_dispatch',true,
       'audit_required',true,
       'brand_core_required_when_activity_requires_brand_core',true,
       'resource_grant_required_for_high_risk',true,
       'dispatch_certification_required_for_high_risk',true,
       'platform_fallback_requires_quota_audit_disclosure',true,
       'admin_personal_oauth_must_not_be_shared',true,
       'write_publish_deploy_require_approval_or_policy_grant',true
     ),
     'resolver_output_contract',JSON_OBJECT(
       'must_include',JSON_ARRAY('request_context','capability','selected_source','authority','gates','fallback_chain','blocking_gaps','decision','secrets_included'),
       'must_not_include',JSON_ARRAY('raw_secret','oauth_token','api_key_value','private_key','decrypted_credential')
     ),
     'initial_target_families',JSON_ARRAY('codex','openrouter_openclaude','wordpress','remote_ssh_hostinger','browser_runtime','github','google_workspace','automation_mcp'),
     'secrets_included',false
   ),
   'active',
   'Dynamic Capability Resolution Graph policy. Resolves capability source/risk/authority before execution; no secrets.'
  )
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'capability_resolution_dry_run',
  'Dynamic Capability Resolution Dry Run',
  'Resolve the selected source tier, authority gates, credential/runtimes metadata, and execution envelope for any supported app/tool without executing the app or returning secrets.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','capability_resolution_dry_run'),
      'extra_args',JSON_OBJECT(
        'type','array',
        'items',JSON_OBJECT('type','string'),
        'maxItems',28,
        'description','Flags: --tenant-id, --user-id, --workspace-id/--workspace-key, --brand-key, --business-activity-type, --app-key, --capability-key, --operation-intent, --runtime-surface, --requested-source-tier, --explain'
      )
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,capability_resolution,dry_run,no_secrets,no_execution,authority_graph,managed_dedicated_dynamic,workspace,brand,activity,credential,runtime',
  1,
  229
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order),
  updated_at = CURRENT_TIMESTAMP;
