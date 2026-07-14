-- Sprint 69: Governed Dynamic Container shadow sampler tool
-- Safety:
--   - Runs the internal resolver only in mode=shadow.
--   - Writes internal comparison, resolution, performance, and audit evidence only.
--   - Provider calls, credential payload reads, external writes, and enforcement are forbidden.
--   - Requires same-cycle comparison and performance readback before success.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'dynamic_container_shadow_sampler',
  'Dynamic Container Shadow Sampler',
  'Generate bounded Dynamic Container shadow comparison and performance evidence from active direct authority cases. The resolver is forced to shadow mode and success requires same-cycle readback. No provider call, credential read, external write, or enforcement.',
  'POST',
  '/admin/container-authority/shadow-samples',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'sampleCount',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',100),
      'tenantId',JSON_OBJECT('type','string','minLength',1,'maxLength',36)
    ),
    'additionalProperties',false
  ),
  NULL,
  'admin,dynamic_container,shadow,state_changing,internal_evidence_write,bounded,same_cycle_readback,no_enforcement,no_provider_call,no_credentials,no_external_write,no_secrets',
  1,
  416
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
  'bind_tool_dynamic_container_shadow_sampler',
  'platform_orchestration',
  'dynamic_container_shadow_sampler',
  'admin_platform_tool',
  'state_changing',
  'none',
  'admin',
  'active',
  'Internal shadow evidence generation only. Resolver mode is fixed to shadow; provider and external writes are forbidden.'
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
  '1046_sprint69_dynamic_container_shadow_sampler_tool.sql',
  'authorized',
  'migration_seed',
  'governed_migration_runner_authorization_v1',
  'medium',
  1,
  1,
  0,
  1,
  'Authorize additive registration of the admin-only Dynamic Container shadow sampler tool and binding.',
  JSON_OBJECT(
    'scope','dynamic_container_shadow_sampler',
    'internal_evidence_write_only',true,
    'mode','shadow',
    'same_cycle_readback_required',true,
    'provider_calls',false,
    'external_writes',false,
    'credential_payload_reads',false,
    'enforcement',false,
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
