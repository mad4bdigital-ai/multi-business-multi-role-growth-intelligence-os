-- Repair the missing Repository Policy Controller bootstrap rows discovered after Migration 1049.
-- Migration 1049 has already executed and MUST NOT be retried.
-- This migration is additive/idempotent registration only; it does not apply a live GitHub Ruleset.
-- Canonical bootstrap source: 20260805_github_repository_policy_controller.sql.
-- Single-owner overlay source: 1049_github_repository_policy_single_owner_mode.sql.
-- no_provider_call=true; no_external_write=true; no_credential_payload_read=true;
-- no_protected_ref_mutation=true; no_force_push=true; secrets_included=false.

INSERT INTO execution_policies
  (policy_group,policy_key,policy_value,active,execution_scope,affects_layer,blocking,notes)
VALUES (
  'Repository Automation Governance',
  'github_repository_policy_controller_v1',
  JSON_OBJECT(
    'target_branch','main',
    'readback_before_plan',TRUE,
    'readback_before_apply',TRUE,
    'expected_main_sha_required',TRUE,
    'deterministic_policy_fingerprint_required',TRUE,
    'typed_confirmation','APPLY_GITHUB_MAIN_REVIEW_POLICY',
    'capability_envelope_required',TRUE,
    'admin_caller_required',TRUE,
    'required_approving_review_count',1,
    'dismiss_stale_reviews_on_push',TRUE,
    'required_review_thread_resolution',TRUE,
    'require_last_push_approval',TRUE,
    'required_status_checks',JSON_ARRAY(
      'Syntax Check',
      'Unit & Integration Tests',
      'Architecture Drift Detection',
      'Execution Resolver Gate',
      'Evaluate changed feature phases',
      'Execute current phase journeys',
      'Single Owner Review Gate'
    ),
    'bypass_actors_allowed',FALSE,
    'auto_merge_allowed',FALSE,
    'merge_queue_allowed',FALSE,
    'force_push_allowed',FALSE,
    'repository_content_mutation_allowed',FALSE,
    'same_cycle_post_readback_required',TRUE,
    'rollback_on_postcondition_failure',TRUE,
    'live_apply_during_implementation_allowed',FALSE,
    'secrets_included',FALSE,
    'review_policy_mode','auto_single_owner_or_independent',
    'required_approving_review_count_independent',1,
    'required_approving_review_count_single_owner',0,
    'single_owner_exact_head_attestation_required',TRUE,
    'single_owner_gate_check','Single Owner Review Gate'
  ),
  'TRUE',
  'repository_automation_plan|repository_automation_run|github_repository_policy_controller|repository_policy',
  'githubRepositoryPolicyController|repositoryAutomationPolicyFacade|repositoryAutomationRoutes|admin_platform_endpoint_tools',
  'TRUE',
  'Fail-closed main review policy with automatic single-owner exact-head attestation fallback; independent approval resumes when another eligible human exists.'
)
ON DUPLICATE KEY UPDATE
  policy_value=VALUES(policy_value),active=VALUES(active),execution_scope=VALUES(execution_scope),
  affects_layer=VALUES(affects_layer),blocking=VALUES(blocking),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools
  (tool_key,display_name,description,http_method,http_path,path_param_keys,input_schema,fixed_body,tags,is_enabled,sort_order,created_at,updated_at)
VALUES
  (
    'github_repository_policy_controller',
    'GitHub Repository Policy Controller',
    'Admin-only governed readback, deterministic plan, or explicitly authorized apply for the main review/protection policy. Apply requires current-main CAS, exact policy fingerprint, typed confirmation, capability envelope, resolved non-bypass finalizer App identity, and same-cycle post-readback. The implementation PR does not execute live apply. Single-owner mode uses an exact-head governed review check instead of GitHub-native self-approval and automatically ceases to apply when another eligible human collaborator exists.',
    'VIRTUAL',
    'internal://github-repository-policy-controller',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('mode'),
      'properties',JSON_OBJECT(
        'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('readback','plan','apply'),'default','readback'),
        'owner',JSON_OBJECT('type','string','maxLength',191),
        'repo',JSON_OBJECT('type','string','maxLength',191),
        'default_branch',JSON_OBJECT('type','string','const','main','default','main'),
        'required_checks',JSON_OBJECT('type','array','minItems',7,'maxItems',7,'items',JSON_OBJECT('type','string')),
        'expected_main_sha',JSON_OBJECT('type','string','pattern','^[a-f0-9]{40}$'),
        'expected_policy_fingerprint',JSON_OBJECT('type','string','pattern','^[a-f0-9]{64}$'),
        'confirm',JSON_OBJECT('type','string','const','APPLY_GITHUB_MAIN_REVIEW_POLICY'),
        'capability_envelope_id',JSON_OBJECT('type','string','minLength',1,'maxLength',64),
        'single_owner_mode',JSON_OBJECT(
          'type','boolean',
          'description','Optional explicit request; succeeds only when live collaborator readback proves complete permissions and exactly one eligible human collaborator.'
        )
      ),
      'additionalProperties',FALSE
    ),
    NULL,
    'admin,github,repository,policy,ruleset,branch_protection,virtual,state_changing,dry_run_default,typed_confirmation,capability_envelope,expected_main_sha,policy_fingerprint,same_cycle_readback,rollback,no_force_push,no_repository_content_mutation,no_secrets',
    1,1454,NOW(),CURRENT_TIMESTAMP
  ),
  (
    'repository_automation_policy_controller',
    'Repository Automation Policy Controller API',
    'Backend-key and Admin-principal HTTP surface for the same governed GitHub main policy controller. Readback and plan are non-mutating; apply remains separately envelope-gated and is never implied by this endpoint registration. Single-owner mode uses an exact-head governed review check instead of GitHub-native self-approval and automatically ceases to apply when another eligible human collaborator exists.',
    'POST',
    '/admin/repository-automation/policy-controller',
    NULL,
    JSON_OBJECT(
      'type','object',
      'required',JSON_ARRAY('mode'),
      'properties',JSON_OBJECT(
        'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('readback','plan','apply'),'default','readback'),
        'owner',JSON_OBJECT('type','string','maxLength',191),
        'repo',JSON_OBJECT('type','string','maxLength',191),
        'default_branch',JSON_OBJECT('type','string','const','main','default','main'),
        'expected_main_sha',JSON_OBJECT('type','string','pattern','^[a-f0-9]{40}$'),
        'expected_policy_fingerprint',JSON_OBJECT('type','string','pattern','^[a-f0-9]{64}$'),
        'confirm',JSON_OBJECT('type','string','const','APPLY_GITHUB_MAIN_REVIEW_POLICY'),
        'capability_envelope_id',JSON_OBJECT('type','string','minLength',1,'maxLength',64),
        'single_owner_mode',JSON_OBJECT(
          'type','boolean',
          'description','Optional explicit request; succeeds only when live collaborator readback proves complete permissions and exactly one eligible human collaborator exists.'
        )
      ),
      'additionalProperties',FALSE
    ),
    NULL,
    'admin,backend_api_key,github,repository,policy,ruleset,branch_protection,state_changing,dry_run_default,typed_confirmation,capability_envelope,same_cycle_readback,no_force_push,no_repository_content_mutation,no_secrets',
    1,1455,NOW(),CURRENT_TIMESTAMP
  )
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),description=VALUES(description),http_method=VALUES(http_method),
  http_path=VALUES(http_path),path_param_keys=VALUES(path_param_keys),input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body),tags=VALUES(tags),is_enabled=1,sort_order=VALUES(sort_order),updated_at=CURRENT_TIMESTAMP;

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      CASE WHEN JSON_VALID(input_schema) THEN input_schema ELSE JSON_OBJECT() END,
      '$.properties.automation_key.enum',
      JSON_ARRAY('pr_delivery','migration_release','post_merge_closeout','branch_cleanup','spec_lifecycle','hygiene_scan','repository_policy','full_workstream')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key IN ('repository_automation_plan','repository_automation_run');

INSERT INTO platform_plugin_capabilities
  (capability_key,plugin_key,display_name,capability_family,source_table,source_key,operation_class,risk_class,
   runtime_status,exposure_scope,authority_requirement_type,resource_authority_required,dispatch_allowed,apply_allowed,
   requires_audit_evidence,requires_readback,legacy_evidence_ref,metadata_json,status)
VALUES
  ('repository_policy_controller','platform_orchestration','GitHub Repository Policy Controller',
   'repository_automation','virtual_admin_tools','github_repository_policy_controller','external_write','C',
   'registered','admin','approval',0,1,0,1,1,
   'migration:20260805_github_repository_policy_controller.sql',
   JSON_OBJECT(
     'target_branch','main',
     'modes',JSON_ARRAY('readback','plan','apply'),
     'typed_confirmation','APPLY_GITHUB_MAIN_REVIEW_POLICY',
     'live_apply_authorized',false,
     'bypass_actors_allowed',false,
     'force_push_allowed',false,
     'repository_content_mutation_allowed',false,
     'same_cycle_readback',true,
     'rollback_on_postcondition_failure',true,
     'secrets_included',false,
     'review_policy_mode','auto_single_owner_or_independent',
     'single_owner_gate_check','Single Owner Review Gate',
     'single_owner_exact_head_attestation_required',TRUE
   ),'active')
ON DUPLICATE KEY UPDATE
  plugin_key=VALUES(plugin_key),display_name=VALUES(display_name),capability_family=VALUES(capability_family),
  source_table=VALUES(source_table),source_key=VALUES(source_key),operation_class=VALUES(operation_class),risk_class=VALUES(risk_class),
  runtime_status=VALUES(runtime_status),exposure_scope=VALUES(exposure_scope),authority_requirement_type=VALUES(authority_requirement_type),
  resource_authority_required=VALUES(resource_authority_required),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  requires_audit_evidence=VALUES(requires_audit_evidence),requires_readback=VALUES(requires_readback),
  legacy_evidence_ref=VALUES(legacy_evidence_ref),metadata_json=VALUES(metadata_json),status=VALUES(status),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_plugin_bindings
  (binding_key,capability_key,binding_family,source_table,source_key,binding_status,exposure_scope,
   credential_source,dispatch_allowed,apply_allowed,metadata_json)
VALUES
  ('binding:admin:github_repository_policy_controller','repository_policy_controller','admin_virtual_tool',
   'virtual_admin_tools','github_repository_policy_controller','active','admin','github_app',1,0,
   JSON_OBJECT('capability_envelope_required',true,'typed_confirmation_required',true,
               'expected_main_sha_required',true,'policy_fingerprint_required',true,
               'same_cycle_readback',true,'live_apply_authorized',false,'secrets_included',false))
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),binding_family=VALUES(binding_family),source_table=VALUES(source_table),
  source_key=VALUES(source_key),binding_status=VALUES(binding_status),exposure_scope=VALUES(exposure_scope),
  credential_source=VALUES(credential_source),dispatch_allowed=VALUES(dispatch_allowed),apply_allowed=VALUES(apply_allowed),
  metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_plugin_capability_exports
  (export_key,capability_key,export_surface,source_table,source_key,export_status,exposure_scope,http_method,http_path,notes)
VALUES
  ('export:admin:github_repository_policy_controller','repository_policy_controller','admin_virtual_tool',
   'virtual_admin_tools','github_repository_policy_controller','active','admin','VIRTUAL',
   'internal://github-repository-policy-controller',
   'Admin-only governed policy readback/plan surface. Apply remains separately envelope- and confirmation-gated.')
ON DUPLICATE KEY UPDATE
  capability_key=VALUES(capability_key),export_surface=VALUES(export_surface),source_table=VALUES(source_table),
  source_key=VALUES(source_key),export_status=VALUES(export_status),exposure_scope=VALUES(exposure_scope),
  http_method=VALUES(http_method),http_path=VALUES(http_path),notes=VALUES(notes),updated_at=CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry
  (migration_file,authorization_status,authorization_source,policy_key,risk_tier,
   requires_preflight,requires_confirmation,allow_record_only,allow_apply,notes,metadata_json)
VALUES
  ('1050_github_repository_policy_controller_bootstrap_repair.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Repair the missing canonical Repository Policy Controller bootstrap rows after the ledgered partial application of Migration 1049. This migration does not execute a GitHub policy apply.',
   JSON_OBJECT(
     'scope','github_repository_policy_controller_bootstrap_repair',
     'incident_issue',6627,
     'repairs_migration','1049_github_repository_policy_single_owner_mode.sql',
     'canonical_bootstrap_source','20260805_github_repository_policy_controller.sql',
     'live_github_policy_apply',false,
     'provider_calls',false,
     'external_writes',false,
     'protected_ref_mutation',false,
     'force_push',false,
     'secrets_included',false
   ))
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),authorization_source=VALUES(authorization_source),
  policy_key=VALUES(policy_key),risk_tier=VALUES(risk_tier),requires_preflight=VALUES(requires_preflight),
  requires_confirmation=VALUES(requires_confirmation),allow_record_only=VALUES(allow_record_only),
  allow_apply=VALUES(allow_apply),notes=VALUES(notes),
  metadata_json=JSON_MERGE_PATCH(CASE WHEN JSON_VALID(metadata_json) THEN metadata_json ELSE JSON_OBJECT() END, VALUES(metadata_json)),
  updated_at=CURRENT_TIMESTAMP;