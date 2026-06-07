-- Sprint 67: Dynamic capability realistic use-case simulation suite.
-- Scope: runtime config + dry-run simulation tool registration only.
-- No tool/app/runtime execution. No secrets. No workspace enum expansion.

INSERT INTO platform_runtime_config
  (config_key, config_json, status, note)
VALUES
  ('dynamic_capability_use_case_simulation_suite_v1',
   JSON_OBJECT(
     'policy_key','dynamic_capability_use_case_simulation_suite_v1',
     'status','active',
     'purpose','Exercise realistic tenant/workspace/brand/user-role use cases so dynamic capability resolution can expand without assumptions.',
     'no_execution',true,
     'secrets_included',false,
     'scenarios',JSON_ARRAY(
       JSON_OBJECT(
         'scenario_key','freelancer_wordpress_publish_managed_service',
         'family','wordpress',
         'workspace_archetype','freelancer_workspace',
         'actor_role','workspace_owner_or_freelancer_operator',
         'business_activity_type','content_publishing',
         'brand_context','client_brand',
         'app_key','wordpress_rest',
         'operation_intent','publish',
         'expected',JSON_OBJECT('decision','ready_requires_approval_or_blocked_until_authority','source_priority',JSON_ARRAY('client_dedicated','brand_managed','freelancer_managed_service','workspace_owner_managed','tenant_managed','blocked_requires_setup'),'platform_fallback_allowed',false,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'brand_core_required',true,'workspace_grant_required',true,'human_approval_required',true,'audit_required',true,'readback_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','client_owned_wordpress_publish_dedicated',
         'family','wordpress',
         'workspace_archetype','client_workspace',
         'actor_role','client_owner_or_approved_operator',
         'business_activity_type','content_publishing',
         'brand_context','client_brand',
         'app_key','wordpress_rest',
         'operation_intent','publish',
         'expected',JSON_OBJECT('decision','ready_requires_approval_or_blocked_until_authority','source_priority',JSON_ARRAY('client_dedicated','brand_managed','tenant_managed','blocked_requires_setup'),'platform_fallback_allowed',false,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'brand_core_required',true,'workspace_grant_required',true,'human_approval_required',true,'audit_required',true,'readback_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','codex_user_owned_local_review',
         'family','codex',
         'workspace_archetype','personal_or_project_workspace',
         'actor_role','developer_or_operator',
         'business_activity_type','development',
         'app_key','codex_chatgpt_oauth',
         'operation_intent','review_plan',
         'expected',JSON_OBJECT('decision','ready_for_dispatch_when_local_device_and_oauth_verified','source_priority',JSON_ARRAY('user_owned_personal','local_device_runtime','workspace_owner_managed','platform_managed_fallback','blocked_requires_setup'),'platform_fallback_allowed',true,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'local_manager_device_required',true,'user_oauth_token_not_stored',true,'audit_required',true,'human_approval_required',false)
       ),
       JSON_OBJECT(
         'scenario_key','codex_platform_managed_fallback_review',
         'family','codex',
         'workspace_archetype','client_or_project_workspace',
         'actor_role','operator_without_personal_codex',
         'business_activity_type','development',
         'app_key','codex_openrouter_custom_provider',
         'operation_intent','review_plan',
         'expected',JSON_OBJECT('decision','ready_requires_quota_or_blocked_until_policy_allowance','source_priority',JSON_ARRAY('user_owned_personal','workspace_owner_managed','platform_managed_fallback','blocked_requires_setup'),'platform_fallback_allowed',true,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'quota_required',true,'audit_required',true,'user_disclosure_required',true,'human_approval_required',false)
       ),
       JSON_OBJECT(
         'scenario_key','remote_ssh_production_deploy',
         'family','remote_ssh_hostinger',
         'workspace_archetype','client_or_brand_workspace',
         'actor_role','approved_infrastructure_operator',
         'business_activity_type','deployment',
         'app_key','remote_ssh_runtime',
         'operation_intent','deploy',
         'expected',JSON_OBJECT('decision','blocked_until_resource_authority_dispatch_certification_and_approval','source_priority',JSON_ARRAY('client_dedicated','remote_dedicated_runtime','tenant_managed','blocked_requires_setup'),'platform_fallback_allowed',false,'deploy_allowed',true),
         'required_gates',JSON_OBJECT('no_secrets',true,'workspace_grant_required',true,'dispatch_certification_required',true,'human_approval_required',true,'audit_required',true,'readback_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','hostinger_dns_update',
         'family','remote_ssh_hostinger',
         'workspace_archetype','brand_or_client_workspace',
         'actor_role','approved_dns_operator',
         'business_activity_type','infrastructure_dns',
         'app_key','hostinger',
         'operation_intent','update_dns',
         'expected',JSON_OBJECT('decision','ready_requires_approval_or_blocked_until_authority','source_priority',JSON_ARRAY('client_dedicated','brand_managed','tenant_managed','platform_managed_fallback','blocked_requires_setup'),'platform_fallback_allowed',true,'deploy_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'workspace_grant_required',true,'human_approval_required',true,'audit_required',true,'readback_required',true,'quota_required',true,'user_disclosure_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','github_docs_pr_platform_managed',
         'family','github',
         'workspace_archetype','project_workspace',
         'actor_role','docs_agent_or_platform_operator',
         'business_activity_type','documentation',
         'app_key','github',
         'operation_intent','create_pr',
         'expected',JSON_OBJECT('decision','ready_requires_policy_and_ci','source_priority',JSON_ARRAY('client_dedicated','tenant_managed','platform_managed_fallback','blocked_requires_setup'),'platform_fallback_allowed',true,'repo_mutation_allowed',true),
         'required_gates',JSON_OBJECT('no_secrets',true,'human_approval_required',true,'branch_policy_required',true,'audit_required',true,'readback_required',true,'quota_required',true,'user_disclosure_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','google_analytics_read_brand_dashboard',
         'family','google_workspace',
         'workspace_archetype','brand_workspace',
         'actor_role','analyst_or_brand_operator',
         'business_activity_type','analytics_reporting',
         'app_key','google_analytics',
         'operation_intent','read_report',
         'expected',JSON_OBJECT('decision','ready_for_dispatch_when_brand_or_tenant_grant_exists','source_priority',JSON_ARRAY('client_dedicated','brand_managed','tenant_managed','user_owned_personal','blocked_requires_setup'),'platform_fallback_allowed',false,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'workspace_grant_required',false,'audit_required',true,'human_approval_required',false)
       ),
       JSON_OBJECT(
         'scenario_key','google_ads_budget_change',
         'family','google_ads',
         'workspace_archetype','brand_or_client_workspace',
         'actor_role','approved_ads_operator',
         'business_activity_type','paid_media',
         'app_key','google_ads',
         'operation_intent','spend_budget_update',
         'expected',JSON_OBJECT('decision','blocked_until_budget_authority_and_approval','source_priority',JSON_ARRAY('client_dedicated','brand_managed','tenant_managed','blocked_requires_setup'),'platform_fallback_allowed',false,'spend_allowed',true),
         'required_gates',JSON_OBJECT('no_secrets',true,'workspace_grant_required',true,'budget_required',true,'human_approval_required',true,'audit_required',true,'readback_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','google_tag_manager_publish',
         'family','google_workspace',
         'workspace_archetype','brand_or_client_workspace',
         'actor_role','approved_tag_manager_operator',
         'business_activity_type','tracking_implementation',
         'app_key','google_tag_manager',
         'operation_intent','publish_container',
         'expected',JSON_OBJECT('decision','blocked_until_brand_authority_and_approval','source_priority',JSON_ARRAY('client_dedicated','brand_managed','tenant_managed','blocked_requires_setup'),'platform_fallback_allowed',false,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'brand_core_required',true,'workspace_grant_required',true,'human_approval_required',true,'audit_required',true,'readback_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','n8n_activate_workflow',
         'family','automation',
         'workspace_archetype','tenant_or_project_workspace',
         'actor_role','automation_operator',
         'business_activity_type','automation_workflows',
         'app_key','n8n',
         'operation_intent','activate_workflow',
         'expected',JSON_OBJECT('decision','ready_requires_approval_or_blocked_until_authority','source_priority',JSON_ARRAY('client_dedicated','tenant_managed','workspace_owner_managed','platform_managed_fallback','blocked_requires_setup'),'platform_fallback_allowed',true,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'workspace_grant_required',true,'human_approval_required',true,'audit_required',true,'readback_required',true,'quota_required',true,'user_disclosure_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','make_mcp_trigger_read_only',
         'family','automation',
         'workspace_archetype','project_workspace',
         'actor_role','operator_or_automation_agent',
         'business_activity_type','automation_workflows',
         'app_key','makecom_mcp',
         'operation_intent','read_status',
         'expected',JSON_OBJECT('decision','ready_for_dispatch_when_connection_exists','source_priority',JSON_ARRAY('client_dedicated','tenant_managed','workspace_owner_managed','platform_managed_fallback','blocked_requires_setup'),'platform_fallback_allowed',true,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'audit_required',true,'human_approval_required',false,'quota_required',true,'user_disclosure_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','browser_visual_inspection',
         'family','browser_runtime',
         'workspace_archetype','project_or_brand_workspace',
         'actor_role','operator_or_agent',
         'business_activity_type','quality_assurance',
         'app_key','webhook',
         'operation_intent','visual_inspect',
         'expected',JSON_OBJECT('decision','ready_for_dispatch_or_blocked_until_browser_authority','source_priority',JSON_ARRAY('user_owned_personal','local_device_runtime','platform_managed_fallback','blocked_requires_setup'),'platform_fallback_allowed',true,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'audit_required',true,'human_approval_required',false,'quota_required',true,'user_disclosure_required',true)
       ),
       JSON_OBJECT(
         'scenario_key','custom_api_webhook_write',
         'family','custom_api',
         'workspace_archetype','project_workspace',
         'actor_role','operator_or_integration_owner',
         'business_activity_type','custom_integration',
         'app_key','webhook',
         'operation_intent','write_event',
         'expected',JSON_OBJECT('decision','ready_requires_approval_or_blocked_until_authority','source_priority',JSON_ARRAY('client_dedicated','tenant_managed','workspace_owner_managed','platform_managed_fallback','blocked_requires_setup'),'platform_fallback_allowed',true,'repo_mutation_allowed',false),
         'required_gates',JSON_OBJECT('no_secrets',true,'workspace_grant_required',true,'human_approval_required',true,'audit_required',true,'readback_required',true,'quota_required',true,'user_disclosure_required',true)
       )
     ),
     'recommended_expansions',JSON_ARRAY(
       JSON_OBJECT('expansion_key','workspace_archetype_policy_context','status','included_policy_only','reason','Current workspace_type enum remains brand/project/campaign/sandbox; realistic archetypes are captured as policy context until explicit schema expansion.'),
       JSON_OBJECT('expansion_key','workspace_member_delegated_source_tier','status','candidate_future_source_tier','reason','Covers tenant/workspace users operating with owner-managed credentials under grants without owning the credential.'),
       JSON_OBJECT('expansion_key','enterprise_workspace_managed_source_tier','status','candidate_future_source_tier','reason','Supports future enterprise workspace/API organization governance for Codex and model providers.'),
       JSON_OBJECT('expansion_key','browser_session_source_tiers','status','candidate_runtime_subtree','reason','Browser use cases need user-owned, local, and platform-managed session distinctions.'),
       JSON_OBJECT('expansion_key','budget_and_quota_authority_registry','status','candidate_schema','reason','Spend/platform fallback scenarios require budget/quota evidence rather than static policy only.'),
       JSON_OBJECT('expansion_key','brand_activity_authority_matrix','status','candidate_schema_or_view','reason','Brand/action authority should vary by activity: read, publish, spend, tag publish, deploy.'),
       JSON_OBJECT('expansion_key','capability_resolution_envelope_ledger','status','candidate_schema','reason','Persist dry-run envelopes before execution so tools can reference an immutable authority decision.'),
       JSON_OBJECT('expansion_key','workspace_enum_expansion','status','defer_until_impact_review','reason','Freelancer/agency/client/personal workspace types are useful but must be introduced via dedicated compatibility migration.'),
       JSON_OBJECT('expansion_key','capability_family_policy_overrides','status','candidate_policy','reason','WordPress, Codex, SSH, Ads, and Browser require family-specific overrides on top of default tiers.')
     )
   ),
   'active',
   'Realistic use-case simulation suite for dynamic capability resolution. Policy-only, no execution, no secrets.'
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
  'capability_resolution_simulation_suite',
  'Dynamic Capability Resolution Simulation Suite',
  'Run a policy-only realistic use-case simulation suite for capability resolution. Compares scenarios to registry coverage and reports policy/registry gaps without executing tools or returning secrets.',
  'POST',
  '/admin/control',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'tool',JSON_OBJECT('type','string','const','shell'),
      'action',JSON_OBJECT('type','string','const','run'),
      'alias',JSON_OBJECT('type','string','const','capability_resolution_simulation_suite'),
      'extra_args',JSON_OBJECT('type','array','items',JSON_OBJECT('type','string'),'maxItems',8,'description','Optional flags: --family wordpress, --scenario freelancer_wordpress_publish_managed_service, --no-live-registry, --explain')
    ),
    'required',JSON_ARRAY('tool','action','alias'),
    'additionalProperties',false
  ),
  NULL,
  'admin,capability_resolution,simulation,no_execution,no_secrets,realistic_use_cases,policy_gap,registry_gap,managed_dedicated_dynamic',
  1,
  230
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
