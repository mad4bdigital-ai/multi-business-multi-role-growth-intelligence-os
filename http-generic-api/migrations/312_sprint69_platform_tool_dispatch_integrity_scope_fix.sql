-- Sprint 69 follow-up: scope platform tool dispatch integrity to governed bindings.
-- Replaces the endpoint-wide projection with one row per registered dispatch binding.
-- Additive/idempotent view replacement only. No provider calls, credentials, or secrets.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- secrets_included=false

CREATE OR REPLACE VIEW v_platform_tool_dispatch_integrity AS
SELECT
  b.binding_id,
  b.parent_action_key,
  b.endpoint_key,
  b.source_endpoint_id,
  b.export_key,
  b.tool_key AS bound_tool_key,
  b.surface_class,
  b.scope_class,
  b.capability_key,
  b.operation_intent,
  b.runtime_surface,
  b.readback_policy_key,
  b.partial_success_policy_key,
  b.atomicity_mode,
  b.status AS binding_status,
  e.id AS endpoint_id,
  e.method,
  e.endpoint_path_or_function,
  e.status AS endpoint_status,
  e.execution_readiness,
  x.tool_name AS exported_tool_name,
  x.scope_class AS export_scope_class,
  x.status AS export_status,
  apt.tool_key AS db_admin_tool_key,
  apt.is_enabled AS db_admin_tool_enabled,
  CASE
    WHEN e.id IS NULL
      OR e.status <> 'active'
      OR COALESCE(e.execution_readiness, 'ready') <> 'ready'
    THEN 1 ELSE 0
  END AS endpoint_not_ready,
  CASE
    WHEN x.export_key IS NULL OR x.status <> 'active'
    THEN 1 ELSE 0
  END AS missing_active_export,
  CASE
    WHEN b.status <> 'active'
    THEN 1 ELSE 0
  END AS missing_active_dispatch_binding,
  CASE
    WHEN UPPER(COALESCE(e.method, 'GET')) IN ('POST','PUT','PATCH','DELETE')
      AND (b.capability_key IS NULL OR b.capability_key = '')
    THEN 1 ELSE 0
  END AS mutation_missing_capability_key,
  CASE
    WHEN b.readback_policy_key IS NULL OR b.readback_policy_key = ''
    THEN 1 ELSE 0
  END AS binding_missing_readback_policy,
  CASE
    WHEN b.surface_class = 'virtual_admin_tool' THEN 0
    WHEN apt.tool_key IS NULL OR apt.is_enabled <> 1 THEN 1
    ELSE 0
  END AS db_callable_surface_missing
FROM platform_tool_dispatch_bindings b
LEFT JOIN endpoints e
  ON e.id = b.source_endpoint_id
LEFT JOIN platform_endpoint_tool_exports x
  ON x.export_key = b.export_key
LEFT JOIN admin_platform_endpoint_tools apt
  ON apt.tool_key = b.tool_key;
