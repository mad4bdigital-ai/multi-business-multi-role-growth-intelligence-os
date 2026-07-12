-- Register the ADMIN-dispatched Tenant Repository Conflict Intelligence readiness smoke.
-- The diagnostic validates tenant-safe logic and registry state while preserving the real JWT boundary.

INSERT INTO admin_platform_endpoint_tools
  (tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
  (
    'repo_conflict_intelligence_tenant_readiness_smoke',
    'Tenant Repository Conflict Intelligence Readiness Smoke',
    'Validate tenant-safe projections and tenant tool registry metadata. Reports authorization_gated when a real Tenant JWT transport probe has not been performed.',
    'POST',
    '/admin/repo-conflict-intelligence/tenant-readiness-smoke',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type','object',
      'properties',JSON_OBJECT(
        'sample_input',JSON_OBJECT('type','object','additionalProperties',true)
      ),
      'additionalProperties',false
    ),
    NULL,
    'repo_conflict_intelligence,admin,readiness_smoke,diagnostic,read_only,preview_only,tenant_scope,no_provider_write,no_git_mutation,no_secrets,authorization_gated',
    1,
    6656
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
  sort_order = VALUES(sort_order);
