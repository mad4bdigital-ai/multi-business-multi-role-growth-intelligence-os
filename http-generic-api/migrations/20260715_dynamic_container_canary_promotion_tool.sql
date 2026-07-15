-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Dynamic Container first-stage promotion is limited to one read-only canary and does not change global enforcement.

INSERT INTO `capability_apply_authorization_policy_registry`
  (`policy_key`, `app_key`, `capability_key`, `operation_intent`, `runtime_surface`, `status`,
   `allow_external_write`, `allow_credential_binding`, `allow_no_credential_binding`,
   `requires_ready_for_dispatch`, `requires_dispatch_allowed`, `requires_zero_blocking_gaps`,
   `requires_audit_evidence`, `requires_readback`, `requires_typed_confirmation`,
   `requires_same_cycle_dry_run`, `allowed_source_tiers_json`, `policy_json`, `notes`)
VALUES
  ('dynamic_container_canary_promotion_policy_v1', 'platform_orchestration',
   'dynamic_container_canary_promotion', 'dynamic_container_canary_promotion', 'auth_host', 'active',
   0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
   JSON_ARRAY('platform_managed_fallback'),
   JSON_OBJECT(
     'internal_sql_mutation_only', TRUE,
     'read_only_canary_only', TRUE,
     'single_active_canary_required', TRUE,
     'ready_for_review_required', TRUE,
     'provider_call_forbidden', TRUE,
     'external_write_forbidden', TRUE,
     'credential_payload_read_forbidden', TRUE,
     'global_rollout_policy_change_forbidden', TRUE,
     'mutation_enforcement_forbidden', TRUE,
     'same_cycle_dry_run_required', TRUE,
     'same_cycle_readback_required', TRUE,
     'transactional_envelope_consumption_required', TRUE,
     'secrets_included', FALSE
   ),
   'Admin-only policy for promoting exactly one read-only Dynamic Container canary after current readiness passes.')
ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `capability_key` = VALUES(`capability_key`),
  `operation_intent` = VALUES(`operation_intent`),
  `runtime_surface` = VALUES(`runtime_surface`),
  `status` = VALUES(`status`),
  `allow_external_write` = VALUES(`allow_external_write`),
  `allow_credential_binding` = VALUES(`allow_credential_binding`),
  `allow_no_credential_binding` = VALUES(`allow_no_credential_binding`),
  `requires_ready_for_dispatch` = VALUES(`requires_ready_for_dispatch`),
  `requires_dispatch_allowed` = VALUES(`requires_dispatch_allowed`),
  `requires_zero_blocking_gaps` = VALUES(`requires_zero_blocking_gaps`),
  `requires_audit_evidence` = VALUES(`requires_audit_evidence`),
  `requires_readback` = VALUES(`requires_readback`),
  `requires_typed_confirmation` = VALUES(`requires_typed_confirmation`),
  `requires_same_cycle_dry_run` = VALUES(`requires_same_cycle_dry_run`),
  `allowed_source_tiers_json` = VALUES(`allowed_source_tiers_json`),
  `policy_json` = VALUES(`policy_json`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'dynamic_container_canary_promotion',
  'Dynamic Container Canary Promotion',
  'Dry-run or promote exactly one active read-only Dynamic Container canary after official readiness is ready_for_review. Apply requires typed confirmation and an apply-authorized capability envelope consumed transactionally with readback. Global rollout mode and mutation enforcement remain unchanged.',
  'POST',
  '/admin/container-authority/canary-promotions',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'required',JSON_ARRAY('mode','targetCanaryKey'),
    'properties',JSON_OBJECT(
      'mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('dry_run','apply'),'default','dry_run'),
      'targetCanaryKey',JSON_OBJECT('type','string','minLength',1,'maxLength',191),
      'confirm',JSON_OBJECT('type','string','maxLength',255),
      'capabilityEnvelopeId',JSON_OBJECT('type','string','format','uuid')
    ),
    'additionalProperties',FALSE
  ),
  NULL,
  'admin,dynamic_container,canary,promotion,state_changing,dry_run_default,typed_confirmation,capability_envelope,same_cycle_readback,internal_sql_only,read_only_canary,no_global_enforcement,no_provider_call,no_credentials,no_external_write,no_secrets',
  1,
  417
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

INSERT INTO app_integration_tool_bindings (
  binding_id, app_key, tool_key, tool_surface, binding_role,
  credential_source, exposure_scope, status, notes
) VALUES (
  'bind_tool_dynamic_container_canary_promotion',
  'platform_orchestration',
  'dynamic_container_canary_promotion',
  'admin_platform_tool',
  'state_changing',
  'none',
  'admin',
  'active',
  'Internal read-only canary promotion only. Apply is envelope-bound and does not change global rollout policy or enable mutation enforcement.'
)
ON DUPLICATE KEY UPDATE
  app_key = VALUES(app_key),
  tool_key = VALUES(tool_key),
  tool_surface = VALUES(tool_surface),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_scope = VALUES(exposure_scope),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry (
  migration_file, authorization_status, authorization_source, policy_key,
  risk_tier, requires_preflight, requires_confirmation,
  allow_record_only, allow_apply, notes, metadata_json
) VALUES (
  '20260715_dynamic_container_canary_promotion_tool.sql',
  'authorized',
  'migration_seed',
  'governed_migration_runner_authorization_v1',
  'medium',
  1,
  1,
  0,
  1,
  'Authorize additive registration of the read-only Dynamic Container canary promotion policy, tool, and binding.',
  JSON_OBJECT(
    'scope','dynamic_container_canary_promotion',
    'read_only_canary_only',true,
    'global_rollout_policy_change',false,
    'mutation_enforcement',false,
    'transactional_envelope_consumption_required',true,
    'same_cycle_readback_required',true,
    'provider_calls',false,
    'external_writes',false,
    'credential_payload_reads',false,
    'secrets_included',false
  )
)
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  risk_tier = VALUES(risk_tier),
  requires_preflight = VALUES(requires_preflight),
  requires_confirmation = VALUES(requires_confirmation),
  allow_record_only = VALUES(allow_record_only),
  allow_apply = VALUES(allow_apply),
  notes = VALUES(notes),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;
