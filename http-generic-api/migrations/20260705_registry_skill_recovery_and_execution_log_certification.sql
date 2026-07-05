-- 20260705_registry_skill_recovery_and_execution_log_certification.sql
-- Canonical idempotent seed for registry recovery skills, GitHub workflow-run approval endpoint,
-- global admin/governed-ops skill grants, and execution_log skill-grant attribution certification.
-- No secrets, no destructive statements, no provider calls.

INSERT INTO skill_manifests (
  skill_key, engine_key, display_name, skill_version, prompt_contract_version,
  policy_key, eval_suite_key, tool_policy_json, task_classes_json, required_tools_json,
  forbidden_tools_json, validator_commands_json, success_criteria_json, fallback_behavior_json,
  prompt_template, status, notes
) VALUES
(
  'platform_registry_database_recovery',
  'platform_registry_database_recovery_engine',
  'Platform Registry & Database Recovery Skill',
  'v1','v1',
  'platform_registry_database_recovery_policy_v1',
  'platform_registry_database_recovery_eval_v1',
  JSON_OBJECT(
    'purpose','recover_missing_registry_rows_and_database_authority_without_provider_specific_bypass',
    'registry_authority','mysql_primary_registry',
    'provider_specific',FALSE,
    'required_for_writes',JSON_ARRAY('authority_context','idempotent_sql','bounded_scope','same_cycle_readback','secrets_included_false'),
    'forbidden',JSON_ARRAY('raw_destructive_sql','secret_read','raw_provider_url','raw_provider_method','force_push','direct_main_write','unbounded_override'),
    'no_secrets',TRUE
  ),
  JSON_ARRAY('registry_bootstrap','database_recovery','missing_endpoint','missing_tool_export','missing_dispatch_binding','response_schema_missing','authority_context_required','activation_surface_coverage_failure','capability_recipe_missing','readback_contract_missing'),
  JSON_ARRAY('admin_control.db','repo_inspect','capability_resolution_dry_run','capability_resolution_envelope_create','capability_resolution_envelope_approve','runtime_endpoint_call','github_rest_endpoint_dispatch'),
  JSON_ARRAY('raw_destructive_sql','drop_table','truncate_table','delete_without_scope','secret_read','raw_provider_url','raw_provider_method','force_push','direct_main_write','unbounded_override'),
  JSON_ARRAY('DESCRIBE target tables before writes','SELECT readback for every inserted or updated registry row','dry_run/preflight before live provider execution when applicable','verify secrets_included=false'),
  JSON_OBJECT('must_create_idempotent_sql',TRUE,'must_include_readback_queries',TRUE,'must_use_authority_context_for_writes',TRUE,'must_keep_provider_specific_logic_in_adapter_skills',TRUE,'must_not_grant_general_bypass',TRUE),
  JSON_OBJECT('if_authority_context_required','read active authority bindings and retry with matching authority_context','if_schema_unknown','DESCRIBE the table and rebuild SQL from actual columns','if_provider_specific','delegate to provider adapter skill after generic registry rows validate','if_destructive_change_needed','stop and require explicit migration approval'),
  'Diagnose and repair DB-backed registry gaps using MySQL as runtime authority. Use narrow idempotent SQL, authority_context, readback, and preflight. Never create broad bypasses or log secrets.',
  'active',
  'Canonicalized from platform-owner runtime repair on 2026-07-05.'
),
(
  'github_repository_recovery_adapter',
  'github_repository_recovery_adapter_engine',
  'GitHub Repository Recovery Adapter Skill',
  'v1','v1',
  'github_repository_recovery_adapter_policy_v1',
  'github_repository_recovery_adapter_eval_v1',
  JSON_OBJECT(
    'purpose','provider_specific_adapter_for_github_repository_ci_pr_and_actions_recovery',
    'depends_on','platform_registry_database_recovery',
    'provider','github',
    'provider_specific',TRUE,
    'required_for_mutations',JSON_ARRAY('registry_endpoint_authority','dry_run_preflight','typed_confirmation','same_cycle_readback','no_force','no_direct_main_write'),
    'forbidden',JSON_ARRAY('raw_github_url','raw_http_method','caller_supplied_authorization_header','force_push','direct_main_write','merge_without_ci_success','merge_without_explicit_approval','secret_read'),
    'no_secrets',TRUE
  ),
  JSON_ARRAY('github_ci_failure','github_workflow_action_required','github_rest_endpoint_missing','github_response_schema_missing','pull_request_head_not_fresh','diverged_no_overlap','diverged_same_files','activation_surface_coverage_failure_in_ci'),
  JSON_ARRAY('github_pr_ci_gate','admin_control.github','github_rest_endpoint_dispatch','admin_branch_reconcile','repo_inspect','repo_patch_apply','platform_registry_database_recovery'),
  JSON_ARRAY('raw_provider_url','raw_method','caller_supplied_authorization','force_push','direct_main_write','merge_without_gate','secret_read'),
  JSON_ARRAY('github_pr_ci_gate must show checks or explain missing checks','workflow approval endpoint must be registered through generic registry skill','live workflow approval must use registry endpoint preflight and typed confirmation','readback GitHub run status after approval attempt'),
  JSON_OBJECT('ci_required_checks',JSON_ARRAY('Syntax Check','Architecture Drift Detection','Execution Resolver Gate','Unit & Integration Tests'),'workflow_approval_endpoint_key','github_approve_workflow_run','workflow_approval_expected_status',204,'must_delegate_registry_bootstrap_to_general_skill',TRUE),
  JSON_OBJECT('if_github_endpoint_missing','call platform_registry_database_recovery to add endpoint/export/binding/schema enum then retry preflight','if_response_schema_missing','update endpoint response schema for observed non-2xx body then retry','if_run_not_waiting_for_approval','read run status; do not retry approval blindly','if_branch_not_fresh','do not force push; use branch reconcile or narrow policy path'),
  'GitHub-specific adapter for PR, CI, workflow, and branch recovery. Provider writes require registry endpoint, dry-run/preflight, typed confirmation, and readback.',
  'active',
  'Canonicalized from platform-owner runtime repair on 2026-07-05.'
)
ON DUPLICATE KEY UPDATE
  engine_key=VALUES(engine_key), display_name=VALUES(display_name), skill_version=VALUES(skill_version),
  prompt_contract_version=VALUES(prompt_contract_version), policy_key=VALUES(policy_key), eval_suite_key=VALUES(eval_suite_key),
  tool_policy_json=VALUES(tool_policy_json), task_classes_json=VALUES(task_classes_json), required_tools_json=VALUES(required_tools_json),
  forbidden_tools_json=VALUES(forbidden_tools_json), validator_commands_json=VALUES(validator_commands_json), success_criteria_json=VALUES(success_criteria_json),
  fallback_behavior_json=VALUES(fallback_behavior_json), prompt_template=VALUES(prompt_template), status=VALUES(status), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO skill_packages (package_id, package_key, display_name, source_url, source_type, version, manifest_json, logic_key, install_status, enabled)
VALUES
(UUID(),'platform_registry_database_recovery','Platform Registry & Database Recovery Skill Pack','db://skill_packages/platform_registry_database_recovery','database_registry','v1',JSON_OBJECT('name','platform-registry-database-recovery','version','v1','skill_key','platform_registry_database_recovery','category','platform_governance','runtime_enabled',TRUE,'provider_specific',FALSE,'safety',JSON_OBJECT('no_secrets',TRUE,'authority_context_required',TRUE,'no_destructive_sql',TRUE,'readback_required',TRUE)),'platform_registry_database_recovery_engine','installed',1),
(UUID(),'github_repository_recovery_adapter','GitHub Repository Recovery Adapter Skill Pack','db://skill_packages/github_repository_recovery_adapter','database_registry','v1',JSON_OBJECT('name','github-repository-recovery-adapter','version','v1','skill_key','github_repository_recovery_adapter','category','provider_adapter','depends_on',JSON_ARRAY('platform_registry_database_recovery'),'provider','github','runtime_enabled',TRUE,'provider_specific',TRUE,'safety',JSON_OBJECT('no_force_push',TRUE,'no_direct_main_write',TRUE,'no_merge_without_gate',TRUE,'typed_confirmation_required_for_mutations',TRUE)),'github_repository_recovery_adapter_engine','installed',1)
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), source_url=VALUES(source_url), source_type=VALUES(source_type), version=VALUES(version), manifest_json=VALUES(manifest_json), logic_key=VALUES(logic_key), install_status=VALUES(install_status), enabled=VALUES(enabled), updated_at=CURRENT_TIMESTAMP;

INSERT INTO agent_skills (skill_id, skill_key, display_name, description, skill_type, scope, capability_json, requires_approval, status)
VALUES
(UUID(),'platform_registry_database_recovery','Platform Registry & Database Recovery','General skill for diagnosing and repairing DB-backed registry gaps for any provider, table, endpoint, capability, authority, policy, or readback contract.','data_write','global',JSON_OBJECT('registry_authority','mysql_primary','requires_authority_context',TRUE,'writes_are_idempotent',TRUE,'readback_required',TRUE,'provider_specific_adapters_required_for_live_provider_calls',TRUE,'secrets_included',FALSE),1,'active'),
(UUID(),'github_repository_recovery_adapter','GitHub Repository Recovery Adapter','GitHub-specific adapter for PR, CI, workflow approval, branch reconciliation, and repository recovery using registry-driven endpoints and governed readback.','api_access','global',JSON_OBJECT('depends_on','platform_registry_database_recovery','provider','github','requires_registry_endpoint_authority',TRUE,'requires_preflight',TRUE,'requires_typed_confirmation_for_mutations',TRUE,'no_force_push',TRUE,'no_direct_main_write',TRUE,'secrets_included',FALSE),1,'active')
ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), description=VALUES(description), skill_type=VALUES(skill_type), scope=VALUES(scope), capability_json=VALUES(capability_json), requires_approval=VALUES(requires_approval), status=VALUES(status);

INSERT INTO agent_skill_grants (grant_id, agent_id, skill_id, tenant_id, brand_key, granted_by, expires_at, status)
SELECT UUID(), a.agent_id, s.skill_id, NULL, NULL, 'f242960c-2857-4b4d-a504-ee50f8a278b4', NULL, 'active'
FROM agents a
JOIN agent_skills s ON s.status='active'
WHERE a.name IN ('admin_gpt_assistant','governed_ops_agent')
  AND a.status='active'
  AND NOT EXISTS (
    SELECT 1 FROM agent_skill_grants g
    WHERE g.agent_id=a.agent_id AND g.skill_id=s.skill_id AND g.tenant_id IS NULL AND g.brand_key IS NULL AND g.status='active'
  );

INSERT INTO endpoints (
  endpoint_id,parent_action_key,endpoint_key,endpoint_operation,endpoint_title,provider_domain,provider_family,method,endpoint_path_or_function,
  route_target,openai_action_name,module_binding,connector_family,execution_layer,dependencies,logging_target,status,category_group,category_detail,
  inventory_role,inventory_source,spec_validation_status,auth_validation_status,privacy_validation_status,execution_readiness,endpoint_role,execution_mode,
  transport_required,transport_action_key,fallback_allowed,runtime_binding_profile,admin_only,client_allowed,team_allowed,writeback_scope,schema_json
) VALUES (
  'ACT-GH-REST-042','github_api_mcp','github_approve_workflow_run','approveWorkflowRun','GitHub Approve Workflow Run','https://api.github.com','github_rest','POST','/repos/{owner}/{repo}/actions/runs/{run_id}/approve',
  'github_api_mcp','approveWorkflowRun','github_com_connector','github_com_connector','system_bootstrap>prompt_router>tool_runtime','prompt_router|system_bootstrap|github_com_connector|http_generic_api_connector','operations_log','active','Source Control / Repository Operations','Workflow Run Approval',
  'endpoint_inventory','official_rest_candidate','validated','validated','validated','ready','primary','http_delegated',
  'TRUE','http_generic_api','FALSE','delegated_http_runtime_binding','TRUE','FALSE','TRUE','operations_log|approved_repository_workflow_run',
  JSON_OBJECT('openapi','3.1.0','info',JSON_OBJECT('title','GitHub workflow run approval endpoint','version','v1'),'paths',JSON_OBJECT('/repos/{owner}/{repo}/actions/runs/{run_id}/approve',JSON_OBJECT('post',JSON_OBJECT('operationId','approveWorkflowRun','parameters',JSON_ARRAY(JSON_OBJECT('name','owner','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),JSON_OBJECT('name','repo','in','path','required',TRUE,'schema',JSON_OBJECT('type','string')),JSON_OBJECT('name','run_id','in','path','required',TRUE,'schema',JSON_OBJECT('type','integer'))),'responses',JSON_OBJECT('204',JSON_OBJECT('description','Workflow run approved'), '401',JSON_OBJECT('description','Unauthorized','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','additionalProperties',TRUE)))), '403',JSON_OBJECT('description','Forbidden or run is not approvable','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','additionalProperties',TRUE)))), '404',JSON_OBJECT('description','Not found','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','additionalProperties',TRUE)))), '422',JSON_OBJECT('description','Validation failed','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','additionalProperties',TRUE)))), '429',JSON_OBJECT('description','Rate limited','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','additionalProperties',TRUE))))))))))
)
ON DUPLICATE KEY UPDATE endpoint_operation=VALUES(endpoint_operation), endpoint_title=VALUES(endpoint_title), provider_domain=VALUES(provider_domain), provider_family=VALUES(provider_family), method=VALUES(method), endpoint_path_or_function=VALUES(endpoint_path_or_function), route_target=VALUES(route_target), openai_action_name=VALUES(openai_action_name), module_binding=VALUES(module_binding), connector_family=VALUES(connector_family), execution_layer=VALUES(execution_layer), dependencies=VALUES(dependencies), logging_target=VALUES(logging_target), status=VALUES(status), category_group=VALUES(category_group), category_detail=VALUES(category_detail), inventory_role=VALUES(inventory_role), inventory_source=VALUES(inventory_source), spec_validation_status=VALUES(spec_validation_status), auth_validation_status=VALUES(auth_validation_status), privacy_validation_status=VALUES(privacy_validation_status), execution_readiness=VALUES(execution_readiness), endpoint_role=VALUES(endpoint_role), execution_mode=VALUES(execution_mode), transport_required=VALUES(transport_required), transport_action_key=VALUES(transport_action_key), fallback_allowed=VALUES(fallback_allowed), runtime_binding_profile=VALUES(runtime_binding_profile), admin_only=VALUES(admin_only), client_allowed=VALUES(client_allowed), team_allowed=VALUES(team_allowed), writeback_scope=VALUES(writeback_scope), schema_json=VALUES(schema_json), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_endpoint_tool_exports (export_key,parent_action_key,endpoint_key,tool_name,scope_class,status,source_endpoint_id,notes)
SELECT 'github_api_mcp__github_approve_workflow_run','github_api_mcp','github_approve_workflow_run','github_rest_endpoint_dispatch','admin','active',e.id,'Canonical workflow-run approval export for GitHub REST dispatcher.'
FROM endpoints e WHERE e.parent_action_key='github_api_mcp' AND e.endpoint_key='github_approve_workflow_run'
ON DUPLICATE KEY UPDATE tool_name=VALUES(tool_name), scope_class=VALUES(scope_class), status=VALUES(status), source_endpoint_id=VALUES(source_endpoint_id), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_tool_dispatch_bindings (binding_id,parent_action_key,endpoint_key,source_endpoint_id,export_key,tool_key,surface_class,scope_class,capability_key,operation_intent,runtime_surface,readback_policy_key,status,metadata_json)
SELECT 'ptdb_github_rest_dispatch_workflow_run_approve','github_api_mcp','github_approve_workflow_run',e.id,'github_api_mcp__github_approve_workflow_run','github_rest_endpoint_dispatch','virtual_admin_tool','admin','github_workflow_run_approve','github_workflow_run_approve','runtime_endpoint_call','github_workflow_run_approval_readback_v1','active',JSON_OBJECT('expected_success_status',204,'secrets_included',FALSE)
FROM endpoints e WHERE e.parent_action_key='github_api_mcp' AND e.endpoint_key='github_approve_workflow_run'
ON DUPLICATE KEY UPDATE source_endpoint_id=VALUES(source_endpoint_id), export_key=VALUES(export_key), tool_key=VALUES(tool_key), surface_class=VALUES(surface_class), scope_class=VALUES(scope_class), capability_key=VALUES(capability_key), operation_intent=VALUES(operation_intent), runtime_surface=VALUES(runtime_surface), readback_policy_key=VALUES(readback_policy_key), status=VALUES(status), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
   SET input_schema = CASE
     WHEN JSON_SEARCH(input_schema, 'one', 'github_approve_workflow_run') IS NULL
     THEN JSON_ARRAY_APPEND(input_schema, '$.properties.tool_args.properties.endpoint_key.enum', 'github_approve_workflow_run')
     ELSE input_schema
   END,
   updated_at=CURRENT_TIMESTAMP
 WHERE tool_key='github_rest_endpoint_dispatch';

INSERT INTO runtime_dispatch_certification_registry (
  certification_key,surface_key,surface_family,tool_or_action_key,risk_class,certification_status,smoke_strategy,
  dispatch_allowed,apply_allowed,requires_resource_authority,requires_dry_run,requires_audit_evidence,requires_readback,
  last_evidence_ref,last_certified_at,expires_at,notes
) VALUES (
  'execution_log_skill_grant_resolution_certified_v1','execution_log_skill_grant_resolution','execution_log','writeExecutionEvidence','B','ci_and_runtime_smoke_certified','execution_log_runtime_evidence_smoke_and_remote_runtime_probe_readback',
  1,0,1,1,1,1,
  'execution_log:20006|execution_log:20011|pr:2144|merge:53970b0e6c786476aa553bebf4d67d977a020688',CURRENT_TIMESTAMP,DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 90 DAY),
  'Certifies automatic agent/skill grant attribution in execution_log with tenant grant priority and global fallback. Evidence rows 20006 and 20011 verified complete and no secrets.'
)
ON DUPLICATE KEY UPDATE certification_status=VALUES(certification_status), smoke_strategy=VALUES(smoke_strategy), dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed), requires_resource_authority=VALUES(requires_resource_authority), requires_dry_run=VALUES(requires_dry_run), requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback), last_evidence_ref=VALUES(last_evidence_ref), last_certified_at=VALUES(last_certified_at), expires_at=VALUES(expires_at), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
