-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Registers an admin-only read-only verifier. It does not seed topology, grant authority, or infer workspace/brand links.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES (
  'dynamic_container_topology_verification',
  'Dynamic Container Platform Topology Verification',
  'Read the canonical platform authority scope, explicit Platform Admin Workspace marker, Growth Intelligence Platform brand, containers, relationships, and platform-owner assignments. Returns typed gaps only; does not repair, grant, promote, call providers, read credential payloads, or perform external writes.',
  'GET',
  '/admin/container-authority/topology-verification',
  JSON_ARRAY(),
  JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',FALSE),
  NULL,
  'admin,dynamic_container,authority_scope,topology,verification,read_only,audited,rate_limited_60_per_minute,no_inference,no_provider_call,no_credentials,no_external_write,no_secrets',
  1,
  425
)
ON DUPLICATE KEY UPDATE
  display_name=VALUES(display_name), description=VALUES(description), http_method=VALUES(http_method),
  http_path=VALUES(http_path), path_param_keys=VALUES(path_param_keys), input_schema=VALUES(input_schema),
  fixed_body=VALUES(fixed_body), tags=VALUES(tags), is_enabled=VALUES(is_enabled),
  sort_order=VALUES(sort_order), updated_at=CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings (
  binding_id, app_key, tool_key, tool_surface, binding_role,
  credential_source, exposure_scope, status, notes
) VALUES (
  'bind_tool_dynamic_container_topology_verification',
  'platform_orchestration',
  'dynamic_container_topology_verification',
  'admin_platform_tool',
  'read_only',
  'none',
  'admin',
  'active',
  'Admin-only audited topology verification. Typed gaps do not grant authority or mutate topology.'
)
ON DUPLICATE KEY UPDATE
  app_key=VALUES(app_key), tool_key=VALUES(tool_key), tool_surface=VALUES(tool_surface),
  binding_role=VALUES(binding_role), credential_source=VALUES(credential_source),
  exposure_scope=VALUES(exposure_scope), status=VALUES(status), notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry (
  migration_file, authorization_status, authorization_source, policy_key,
  risk_tier, requires_preflight, requires_confirmation,
  allow_record_only, allow_apply, notes, metadata_json
) VALUES (
  '20260724_dynamic_container_topology_verification_tool.sql',
  'authorized',
  'migration_seed',
  'governed_migration_runner_authorization_v1',
  'low',
  1,
  1,
  0,
  1,
  'Authorize additive registration of the admin-only read-only Dynamic Container platform topology verifier.',
  JSON_OBJECT('scope','dynamic_container_topology_verification','read_only',true,'audited',true,'rate_limit_per_minute',60,'topology_mutation',false,'authority_grant',false,'provider_calls',false,'external_writes',false,'credential_payload_reads',false,'secrets_included',false)
)
ON DUPLICATE KEY UPDATE
  authorization_status=VALUES(authorization_status), authorization_source=VALUES(authorization_source),
  policy_key=VALUES(policy_key), risk_tier=VALUES(risk_tier), requires_preflight=VALUES(requires_preflight),
  requires_confirmation=VALUES(requires_confirmation), allow_record_only=VALUES(allow_record_only),
  allow_apply=VALUES(allow_apply), notes=VALUES(notes), metadata_json=VALUES(metadata_json),
  updated_at=CURRENT_TIMESTAMP;
