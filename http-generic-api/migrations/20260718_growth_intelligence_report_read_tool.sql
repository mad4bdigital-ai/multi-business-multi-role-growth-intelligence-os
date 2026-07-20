-- Register a read-only Admin tool for the existing Growth Intelligence report endpoint.
-- No schema change, provider call, external send, execution dispatch, or secret read.

INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled,
  sort_order, created_at, updated_at
) VALUES (
  'growth_intelligence_report_read',
  'Read Growth Intelligence Report',
  'Read one tenant-scoped persisted Growth Intelligence report with its insights, actions, and readiness assessments. Read-only internal registry access; no provider write, external send, execution dispatch, approval decision, or secret return.',
  'GET',
  '/growth-intelligence/reports/{report_id}',
  JSON_ARRAY('report_id'),
  JSON_OBJECT(
    'type', 'object',
    'required', JSON_ARRAY('tenant_id', 'report_id'),
    'properties', JSON_OBJECT(
      'tenant_id', JSON_OBJECT(
        'type', 'string',
        'pattern', '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      ),
      'report_id', JSON_OBJECT(
        'type', 'string',
        'minLength', 1,
        'maxLength', 191,
        'pattern', '^[A-Za-z0-9._:-]+$'
      )
    ),
    'additionalProperties', FALSE
  ),
  NULL,
  JSON_ARRAY(
    'growth_intelligence', 'report', 'read_only', 'tenant_scoped',
    'internal_registry', 'no_provider_write', 'no_external_send',
    'no_execution', 'no_secrets'
  ),
  1,
  7425,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
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
