-- Dynamic Container override governance smoke registration.
-- no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Uses transactional disposable rows, verifies cleanup, records closure evidence, and never executes an override target.

INSERT INTO `capability_apply_authorization_policy_registry`
  (`policy_key`,`app_key`,`capability_key`,`operation_intent`,`runtime_surface`,`status`,
   `allow_external_write`,`allow_credential_binding`,`allow_no_credential_binding`,
   `requires_ready_for_dispatch`,`requires_dispatch_allowed`,`requires_zero_blocking_gaps`,
   `requires_audit_evidence`,`requires_readback`,`requires_typed_confirmation`,`requires_same_cycle_dry_run`,
   `allowed_source_tiers_json`,`policy_json`,`notes`)
VALUES
  ('dynamic_container_override_governance_smoke_policy_v1','platform_orchestration',
   'dynamic_container_override_governance_smoke','dynamic_container_override_governance_smoke','auth_host','active',
   0,0,1,1,1,1,1,1,1,1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT(
     'internal_sql_only',TRUE,
     'transactional_disposable_rows',TRUE,
     'fixture_cleanup_required',TRUE,
     'self_approval_policy_verification_required',TRUE,
     'distinct_dual_approval_required',TRUE,
     'stale_epoch_rejection_required',TRUE,
     'one_time_consumption_required',TRUE,
     'closure_evidence_readback_required',TRUE,
     'override_target_execution_forbidden',TRUE,
     'rollout_change_forbidden',TRUE,
     'enforcement_enablement_forbidden',TRUE,
     'provider_call_forbidden',TRUE,
     'credential_payload_read_forbidden',TRUE,
     'external_write_forbidden',TRUE,
     'secrets_included',FALSE
   ),
   'Admin-only transactional smoke for Dynamic Container override governance controls and closure evidence.')
ON DUPLICATE KEY UPDATE
  `app_key`=VALUES(`app_key`),`capability_key`=VALUES(`capability_key`),`operation_intent`=VALUES(`operation_intent`),
  `runtime_surface`=VALUES(`runtime_surface`),`status`=VALUES(`status`),`allow_external_write`=VALUES(`allow_external_write`),
  `allow_credential_binding`=VALUES(`allow_credential_binding`),`allow_no_credential_binding`=VALUES(`allow_no_credential_binding`),
  `requires_ready_for_dispatch`=VALUES(`requires_ready_for_dispatch`),`requires_dispatch_allowed`=VALUES(`requires_dispatch_allowed`),
  `requires_zero_blocking_gaps`=VALUES(`requires_zero_blocking_gaps`),`requires_audit_evidence`=VALUES(`requires_audit_evidence`),
  `requires_readback`=VALUES(`requires_readback`),`requires_typed_confirmation`=VALUES(`requires_typed_confirmation`),
  `requires_same_cycle_dry_run`=VALUES(`requires_same_cycle_dry_run`),`allowed_source_tiers_json`=VALUES(`allowed_source_tiers_json`),
  `policy_json`=VALUES(`policy_json`),`notes`=VALUES(`notes`),`updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`,`display_name`,`description`,`http_method`,`http_path`,`path_param_keys`,
  `input_schema`,`fixed_body`,`tags`,`is_enabled`,`sort_order`
) VALUES (
  'dynamic_container_override_governance_smoke',
  'Dynamic Container Override Governance Smoke',
  'Dry-run or execute a transactional internal-SQL smoke that verifies destructive no-self-approval policy, distinct dual approvals, stale epoch rejection, one-time consumption, fixture cleanup, closure evidence readback, and capability-envelope consumption without executing an override target.',
  'POST','/admin/container-authority/override-governance-smokes',JSON_ARRAY(),
  JSON_OBJECT(
    'type','object','required',JSON_ARRAY('mode'),
    'properties',JSON_OBJECT(
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply'),'default','dry_run'),
      'confirm',JSON_OBJECT('type','string','maxLength',255),
      'capabilityEnvelopeId',JSON_OBJECT('type','string','format','uuid')
    ),
    'additionalProperties',FALSE
  ),
  NULL,
  'admin,dynamic_container,override,governance,smoke,state_changing,dry_run_default,typed_confirmation,capability_envelope,transactional_disposable_rows,cleanup_required,same_cycle_readback,no_target_execution,no_rollout_change,no_enforcement,no_provider_call,no_credentials,no_external_write,no_secrets',
  1,425
)
ON DUPLICATE KEY UPDATE
  `display_name`=VALUES(`display_name`),`description`=VALUES(`description`),`http_method`=VALUES(`http_method`),
  `http_path`=VALUES(`http_path`),`path_param_keys`=VALUES(`path_param_keys`),`input_schema`=VALUES(`input_schema`),
  `fixed_body`=VALUES(`fixed_body`),`tags`=VALUES(`tags`),`is_enabled`=VALUES(`is_enabled`),
  `sort_order`=VALUES(`sort_order`),`updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `app_integration_tool_bindings` (
  `binding_id`,`app_key`,`tool_key`,`tool_surface`,`binding_role`,
  `credential_source`,`exposure_scope`,`status`,`notes`
) VALUES (
  'bind_tool_dynamic_container_override_governance_smoke','platform_orchestration',
  'dynamic_container_override_governance_smoke','admin_platform_tool','state_changing',
  'none','admin','active',
  'Internal transactional governance smoke only; fixtures are disposable, cleanup is mandatory, and no override target or external provider action is executed.'
)
ON DUPLICATE KEY UPDATE
  `app_key`=VALUES(`app_key`),`tool_key`=VALUES(`tool_key`),`tool_surface`=VALUES(`tool_surface`),
  `binding_role`=VALUES(`binding_role`),`credential_source`=VALUES(`credential_source`),
  `exposure_scope`=VALUES(`exposure_scope`),`status`=VALUES(`status`),`notes`=VALUES(`notes`),
  `updated_at`=CURRENT_TIMESTAMP;

INSERT INTO `governed_migration_authorization_registry` (
  `migration_file`,`authorization_status`,`authorization_source`,`policy_key`,`risk_tier`,
  `requires_preflight`,`requires_confirmation`,`allow_record_only`,`allow_apply`,`notes`,`metadata_json`
) VALUES (
  '20260723_dynamic_container_override_governance_smoke.sql','authorized','migration_seed',
  'governed_migration_runner_authorization_v1','medium',1,1,0,1,
  'Authorize additive registration of the Dynamic Container override governance smoke without executing the smoke or enabling enforcement.',
  JSON_OBJECT(
    'scope','dynamic_container_override_governance_smoke',
    'transactional_disposable_rows',TRUE,
    'fixture_cleanup_required',TRUE,
    'override_target_execution',FALSE,
    'global_rollout_policy_change',FALSE,
    'mutation_enforcement',FALSE,
    'provider_calls',FALSE,
    'credential_payload_reads',FALSE,
    'external_writes',FALSE,
    'secrets_included',FALSE
  )
)
ON DUPLICATE KEY UPDATE
  `authorization_status`=VALUES(`authorization_status`),`authorization_source`=VALUES(`authorization_source`),
  `policy_key`=VALUES(`policy_key`),`risk_tier`=VALUES(`risk_tier`),
  `requires_preflight`=VALUES(`requires_preflight`),`requires_confirmation`=VALUES(`requires_confirmation`),
  `allow_record_only`=VALUES(`allow_record_only`),`allow_apply`=VALUES(`allow_apply`),
  `notes`=VALUES(`notes`),
  `metadata_json`=JSON_MERGE_PATCH(
    CASE WHEN JSON_VALID(`metadata_json`) THEN `metadata_json` ELSE JSON_OBJECT() END,
    VALUES(`metadata_json`)
  ),
  `updated_at`=CURRENT_TIMESTAMP;
