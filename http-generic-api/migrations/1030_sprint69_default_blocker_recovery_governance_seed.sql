-- Default blocker recovery governance seed
-- Purpose: keep mutation-policy and blocker-recovery handoffs durable across deploys.
-- Safety: no provider calls, no external writes, no secret values.

UPDATE admin_platform_endpoint_tools
   SET tags = CONCAT_WS(',', NULLIF(TRIM(BOTH ',' FROM tags), ''),
     CASE WHEN FIND_IN_SET('approval_required', tags)=0 THEN 'approval_required' END,
     CASE WHEN FIND_IN_SET('readback', tags)=0 THEN 'readback' END,
     CASE WHEN FIND_IN_SET('same_cycle_readback', tags)=0 THEN 'same_cycle_readback' END,
     CASE WHEN FIND_IN_SET('audited', tags)=0 THEN 'audited' END),
       updated_at = CURRENT_TIMESTAMP
 WHERE is_enabled=1
   AND (http_method IN ('POST','PUT','PATCH','DELETE','VIRTUAL')
        OR tags REGEXP '(^|,)(state_changing|mutation|read_write|writeback|provider_write|external_write)(,|$)')
   AND NOT (tags REGEXP '(^|,)(capability_envelope|typed_confirmation|approval_required|readback|same_cycle_readback|dry_run_default|preview_required|rollback_required)(,|$)');

UPDATE tenant_platform_endpoint_tools
   SET tags = CONCAT_WS(',', NULLIF(TRIM(BOTH ',' FROM tags), ''),
     CASE WHEN FIND_IN_SET('approval_required', tags)=0 THEN 'approval_required' END,
     CASE WHEN FIND_IN_SET('readback', tags)=0 THEN 'readback' END,
     CASE WHEN FIND_IN_SET('same_cycle_readback', tags)=0 THEN 'same_cycle_readback' END,
     CASE WHEN FIND_IN_SET('audited', tags)=0 THEN 'audited' END),
       updated_at = CURRENT_TIMESTAMP
 WHERE is_enabled=1
   AND (http_method IN ('POST','PUT','PATCH','DELETE','VIRTUAL')
        OR tags REGEXP '(^|,)(state_changing|mutation|read_write|writeback|provider_write|external_write)(,|$)')
   AND NOT (tags REGEXP '(^|,)(capability_envelope|typed_confirmation|approval_required|readback|same_cycle_readback|dry_run_default|preview_required|rollback_required)(,|$)');

UPDATE local_gateway_tools
   SET tags = CONCAT_WS(',', NULLIF(TRIM(BOTH ',' FROM tags), ''),
     CASE WHEN FIND_IN_SET('approval_required', tags)=0 THEN 'approval_required' END,
     CASE WHEN FIND_IN_SET('readback', tags)=0 THEN 'readback' END,
     CASE WHEN FIND_IN_SET('same_cycle_readback', tags)=0 THEN 'same_cycle_readback' END,
     CASE WHEN FIND_IN_SET('audited', tags)=0 THEN 'audited' END),
       updated_at = CURRENT_TIMESTAMP
 WHERE status='active'
   AND (is_consequential=1 OR requires_approval=1 OR risk_class IN ('high','admin_recovery')
        OR tags REGEXP '(^|,)(state_changing|mutation|read_write|writeback|provider_write|external_write)(,|$)')
   AND NOT (tags REGEXP '(^|,)(capability_envelope|typed_confirmation|approval_required|readback|same_cycle_readback|dry_run_default|preview_required|rollback_required)(,|$)');

UPDATE tenant_platform_endpoint_tools
   SET tags='tenant,agent_runtime,state_changing,approval_required,readback,same_cycle_readback,audited,no_secrets,tenant_owned_device'
 WHERE tool_key='connector_agent_runtime'
   AND is_enabled=1
   AND tags LIKE '%approval_re%';

INSERT INTO execution_policies (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
SELECT 'Default Mutation Governance', 'gpt_tool_default_declared_mutation_policy_v1',
       JSON_OBJECT('purpose','Default mutation governance evidence for governed admin tenant and local gateway dispatch surfaces','default_required_tags',JSON_ARRAY('approval_required','readback','same_cycle_readback'),'applies_to_catalogs',JSON_ARRAY('admin_platform_endpoint_tools','tenant_platform_endpoint_tools','local_gateway_tools'),'provider_write_allowed_by_default',false,'external_write_allowed_by_default',false,'secrets_may_be_returned',false,'does_not_grant_authority',true,'route_specific_enforcement_still_required',true,'secrets_included',false),
       'TRUE','global|gpt_tools_call|tool_dispatch|tenant_tools|admin_tools|local_gateway','governedExecutionPreflight|gptToolsRoutes|tenantPlatformTools|adminPlatformEndpointTools|localGatewayTools|execution_policies','FALSE','Default declared mutation policy evidence. Does not grant provider write secret access or resource authority.'
WHERE NOT EXISTS (SELECT 1 FROM execution_policies WHERE policy_group='Default Mutation Governance' AND policy_key='gpt_tool_default_declared_mutation_policy_v1');

UPDATE execution_policies
   SET policy_value=JSON_OBJECT('purpose','Default mutation governance evidence for governed admin tenant and local gateway dispatch surfaces','default_required_tags',JSON_ARRAY('approval_required','readback','same_cycle_readback'),'applies_to_catalogs',JSON_ARRAY('admin_platform_endpoint_tools','tenant_platform_endpoint_tools','local_gateway_tools'),'provider_write_allowed_by_default',false,'external_write_allowed_by_default',false,'secrets_may_be_returned',false,'does_not_grant_authority',true,'route_specific_enforcement_still_required',true,'secrets_included',false),
       active='TRUE',
       execution_scope='global|gpt_tools_call|tool_dispatch|tenant_tools|admin_tools|local_gateway',
       affects_layer='governedExecutionPreflight|gptToolsRoutes|tenantPlatformTools|adminPlatformEndpointTools|localGatewayTools|execution_policies',
       blocking='FALSE',
       notes='Default declared mutation policy evidence. Does not grant provider write secret access or resource authority.'
 WHERE policy_group='Default Mutation Governance'
   AND policy_key='gpt_tool_default_declared_mutation_policy_v1';

UPDATE platform_semantic_capabilities
   SET default_policy_key='gpt_tool_default_declared_mutation_policy_v1', updated_at=CURRENT_TIMESTAMP
 WHERE status='active'
   AND (default_policy_key IS NULL OR default_policy_key='');

INSERT INTO platform_recovery_failure_taxonomy (failure_key, family, display_name, description, severity, default_recovery_action, evidence_required_json, recommended_capabilities_json, safe_retry_allowed, apply_allowed, secrets_may_be_returned, status, notes, created_at, updated_at)
VALUES
('MISSING_GRANT','tenant_authority_recovery','Missing grant','Caller lacks a required workspace or resource grant.','warning','workspace_access_request_create_or_workspace_resource_grant_create',JSON_ARRAY('tenant_id','user_id','resource_type','resource_ref','required_permission','same_cycle_readback'),JSON_ARRAY('workspace_access_request_create','workspace_access_request_approve','workspace_resource_grant_create','support_ticket_create'),1,0,0,'active','No provider write no secrets.',NOW(),NOW()),
('MISSING_APPROVAL','tenant_authority_recovery','Missing approval','Operation requires explicit approval.','warning','approval_hold_or_tenant_approval_request',JSON_ARRAY('tenant_id','approval_subject','actor','decision_note','same_cycle_readback'),JSON_ARRAY('support_ticket_create_approval_hold','support_ticket_decide_approval_hold','tenant_ssh_cli_approval_request_create'),1,0,0,'active','No implicit approval.',NOW(),NOW()),
('MISSING_RESOURCE_AUTHORITY','tenant_authority_recovery','Missing resource authority','Dynamic resource authority binding is absent.','error','resource_authority_binding_request_or_admin_apply',JSON_ARRAY('resource_type','resource_uri_or_ref','operation_mode','tenant_or_workspace_scope','same_cycle_readback'),JSON_ARRAY('platform_resource_authority_binding_create','platform_resource_authority_binding_list','platform_resource_authority_grant_apply','governed_resource_plan'),0,0,0,'active','No inferred authority.',NOW(),NOW()),
('MISSING_CAPABILITY_ENVELOPE','capability_recovery','Missing capability envelope','A capability envelope is required before guarded execution.','error','capability_resolution_dry_run_then_envelope_authorize',JSON_ARRAY('capability_key','resource_context','dry_run_evidence','decision_note','ttl','same_cycle_readback'),JSON_ARRAY('capability_resolution_dry_run','capability_resolution_envelope_approve','capability_resolution_envelope_apply_authorize'),0,0,0,'active','No live execution by default.',NOW(),NOW()),
('CAPABILITY_BINDING_MISSING','capability_recovery','Capability provider binding missing','Semantic capability exists but has no active provider binding.','error','capability_provider_binding_gap_report_then_certification_or_plugin_binding_request',JSON_ARRAY('capability_key','resource_type','operation_key','provider_family_or_app_key_when_known','gap_readback'),JSON_ARRAY('tenant_effective_capability_preview','tenant_capability_shadow_compare','capability_resolution_dry_run','runtime_dispatch_certification_issue','platform_plugin_action_grant_upsert','support_ticket_create'),0,0,0,'active','No invented endpoint and no provider write.',NOW(),NOW()),
('CONNECTION_NOT_VALIDATED','credential_connection_recovery','Connection not validated','Connection exists but is metadata-only or not validated.','warning','credential_effective_plan_then_secure_intake_or_validation',JSON_ARRAY('tenant_id','user_id','connection_id','app_key','auth_type','target_key','no_secret_response','same_cycle_readback'),JSON_ARRAY('credential_effective_plan','credential_intake_session_create','connect_credential_intake_create','platform_resource_context_diagnostic_handoff','wordpress_auth_context_diagnostic'),1,0,0,'active','No secret return.',NOW(),NOW()),
('BLOCKED_MISSING_SECRET','credential_connection_recovery','Missing credential secret','Credential pointer exists but required secret material is absent.','warning','secure_credential_intake_required',JSON_ARRAY('tenant_id','user_id','connection_id_or_target_key','credential_role','missing_secret_key','intake_session','no_secret_response'),JSON_ARRAY('credential_effective_plan','credential_intake_session_create','connect_credential_intake_create'),1,0,0,'active','No raw secret in chat.',NOW(),NOW()),
('CONNECTION_INACTIVE','credential_connection_recovery','Connection inactive','Connection is expired revoked or errored.','error','connection_readiness_diagnostic_then_reactivation_or_intake',JSON_ARRAY('tenant_id','user_id','connection_id','current_status','diagnostic_readback'),JSON_ARRAY('platform_resource_context_diagnostic_handoff','credential_effective_plan','connect_credential_intake_create','support_ticket_create'),0,0,0,'active','No provider write by default.',NOW(),NOW())
ON DUPLICATE KEY UPDATE family=VALUES(family), display_name=VALUES(display_name), description=VALUES(description), severity=VALUES(severity), default_recovery_action=VALUES(default_recovery_action), evidence_required_json=VALUES(evidence_required_json), recommended_capabilities_json=VALUES(recommended_capabilities_json), safe_retry_allowed=VALUES(safe_retry_allowed), apply_allowed=VALUES(apply_allowed), secrets_may_be_returned=VALUES(secrets_may_be_returned), status=VALUES(status), notes=VALUES(notes), updated_at=NOW();

INSERT INTO platform_engine_policy_rules (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern, condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required, approval_required, validator_commands_json, status, notes, created_at, updated_at)
SELECT x.rule_key, x.policy_key, 'platform_governance', x.priority, x.task_class, x.resource_kind, '*', JSON_OBJECT('execution_policy_group',x.policy_group,'execution_policy_key',x.policy_key,'blocker',x.blocker,'recovery_mode',x.recovery_mode), x.strategy_key, x.risk_level, 0, 1, 1, JSON_ARRAY(x.validator_command), 'active', x.notes, NOW(), NOW()
FROM (
  SELECT 'default_mutation_policy_catalog_coverage_rule_v1' rule_key, 'gpt_tool_default_declared_mutation_policy_v1' policy_key, 'Default Mutation Governance' policy_group, 900 priority, 'tool_dispatch' task_class, 'tool_catalog' resource_kind, 'missing_declared_mutation_policy' blocker, 'catalog_gap_readback' recovery_mode, 'default_mutation_policy_coverage_readback' strategy_key, 'medium' risk_level, 'default_mutation_policy_catalog_gap_query' validator_command, 'Enabled state changing or consequential tool catalog entries must declare mutation policy tags.' notes
  UNION ALL SELECT 'missing_grant_recovery_rule_v1','missing_grant_default_recovery_handoff_v1','Default Blocker Recovery Governance',880,'grant_resolution','grant','missing_grant','request_or_owner_scoped_grant_handoff','grant_recovery_handoff_readback','medium','workspace_grant_recovery_gap_query','Routes missing grant blockers to request or owner scoped grant handoff.'
  UNION ALL SELECT 'missing_approval_recovery_rule_v1','missing_approval_default_recovery_handoff_v1','Default Blocker Recovery Governance',879,'approval_resolution','approval','missing_approval','approval_hold_or_tenant_approval_request','approval_recovery_handoff_readback','medium','approval_recovery_gap_query','Routes missing approval blockers to approval hold or request.'
  UNION ALL SELECT 'missing_resource_authority_recovery_rule_v1','missing_resource_authority_default_recovery_handoff_v1','Default Blocker Recovery Governance',878,'resource_authority','resource_authority','missing_resource_authority','resource_authority_binding_request_or_admin_apply','resource_authority_recovery_handoff_readback','high','resource_authority_gap_query','Routes missing resource authority to binding or request flow.'
  UNION ALL SELECT 'missing_capability_envelope_recovery_rule_v1','missing_capability_envelope_default_recovery_handoff_v1','Default Blocker Recovery Governance',877,'capability_envelope','capability','missing_capability_envelope','capability_resolution_dry_run_then_envelope_authorize','capability_envelope_recovery_handoff_readback','high','capability_envelope_gap_query','Routes missing capability envelope to dry run and authorization.'
  UNION ALL SELECT 'missing_credential_recovery_rule_v1','missing_credential_default_recovery_handoff_v1','Default Blocker Recovery Governance',876,'credential_resolution','credential','missing_credential_or_credential_readiness','credential_effective_plan_then_secure_intake_or_pointer_promotion','credential_recovery_handoff_readback','high','credential_effective_plan','Routes missing credentials to secure intake or pointer promotion.'
  UNION ALL SELECT 'missing_connection_certification_recovery_rule_v1','missing_connection_or_certification_default_recovery_handoff_v1','Default Blocker Recovery Governance',875,'connection_readiness','connection','missing_connection_or_certification_readiness','connection_readiness_diagnostic_then_certification_or_intake_handoff','connection_certification_recovery_handoff_readback','high','connection_readiness_gap_query','Routes missing connection or certification readiness to diagnostics.'
  UNION ALL SELECT 'missing_capability_provider_binding_recovery_rule_v1','missing_capability_provider_binding_default_recovery_handoff_v1','Default Blocker Recovery Governance',874,'capability_provider_binding','capability_provider_binding','missing_capability_provider_binding','capability_provider_binding_gap_report_then_certification_or_plugin_binding_request','provider_binding_recovery_handoff_readback','high','capability_provider_binding_gap_query','Routes missing capability provider binding to gap report and certification or plugin binding request.'
) x
WHERE NOT EXISTS (SELECT 1 FROM platform_engine_policy_rules r WHERE r.rule_key=x.rule_key);
