-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Registers an internal-only bounded probe sampler that records current-cycle read-only canary observations.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'dynamic_container_canary_probe_sampler',
  'Dynamic Container Canary Probe Sampler',
  'Generate 1 to 100 internal read-only probes through the active rollout-readiness canary runtime wrapper and require same-cycle observation count, success, failure, audit, latency, and readiness-code readback. Does not change rollout mode or enforcement.',
  'POST',
  '/admin/container-authority/canary-probes',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'sampleCount',JSON_OBJECT('type','integer','minimum',1,'maximum',100,'default',100),
      'targetCanaryKey',JSON_OBJECT('type','string','enum',JSON_ARRAY('container_authority_rollout_readiness_v1'),'default','container_authority_rollout_readiness_v1')
    ),
    'additionalProperties',FALSE
  ),
  NULL,
  'admin,dynamic_container,canary,probe,sampler,internal_evidence_write,bounded_100,same_cycle_readback,read_only,no_rollout_change,no_global_enforcement,no_provider_call,no_credentials,no_external_write,no_secrets',
  1,
  420
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name),
  description=VALUES(description),
  http_method=VALUES(http_method),
  http_path=VALUES(http_path),
  path_param_keys=VALUES(path_param_keys),
  input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body),
  tags=VALUES(tags),
  is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings (
  binding_id, app_key, tool_key, tool_surface, binding_role,
  credential_source, exposure_scope, status, notes
) VALUES (
  'bind_tool_dynamic_container_canary_probe_sampler',
  'platform_orchestration',
  'dynamic_container_canary_probe_sampler',
  'admin_platform_tool',
  'state_changing',
  'none',
  'admin',
  'active',
  'Internal evidence writes only. Executes bounded read-only probes through the active canary runtime and requires same-cycle observation readback. No rollout change or enforcement.'
)
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key),
  tool_key=VALUES(tool_key),
  tool_surface=VALUES(tool_surface),
  binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),
  exposure_scope=VALUES(exposure_scope),
  status=VALUES(status),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry (
  migration_file, authorization_status, authorization_source, policy_key,
  risk_tier, requires_preflight, requires_confirmation,
  allow_record_only, allow_apply, notes, metadata_json
) VALUES (
  '20260715_dynamic_container_canary_probe_sampler_tool.sql',
  'authorized',
  'migration_seed',
  'governed_migration_runner_authorization_v1',
  'medium',
  1,
  1,
  0,
  1,
  'Authorize additive registration of the bounded Dynamic Container canary probe sampler and app binding.',
  JSON_OBJECT(
    'scope','dynamic_container_canary_probe_sampler',
    'maximum_probe_count',100,
    'same_cycle_observation_readback_required',true,
    'rollout_mode_change',false,
    'mutation_enforcement',false,
    'provider_calls',false,
    'external_writes',false,
    'credential_payload_reads',false,
    'secrets_included',false
  )
)
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status),
  authorization_source=VALUES(authorization_source),
  policy_key=VALUES(policy_key),
  risk_tier=VALUES(risk_tier),
  requires_preflight=VALUES(requires_preflight),
  requires_confirmation=VALUES(requires_confirmation),
  allow_record_only=VALUES(allow_record_only),
  allow_apply=VALUES(allow_apply),
  notes=VALUES(notes),
  metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
