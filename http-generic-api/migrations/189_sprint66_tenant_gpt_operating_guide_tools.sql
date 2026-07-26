-- Sprint 66: Tenant GPT operating guide tenant tools
-- Tenant-safe read-only guide surfaces for GPTs before public UI is complete.

INSERT INTO tenant_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path,
  path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
(
  'tenant_docs_catalog',
  'Tenant Docs Catalog',
  'List tenant-safe operating documents available to a signed-in tenant user.',
  'GET',
  '/tenant/docs',
  JSON_ARRAY(),
  JSON_OBJECT('type','object','properties',JSON_OBJECT(),'additionalProperties',false),
  NULL,
  'tenant,docs,guide,read_only,no_secrets',
  1,
  260
),
(
  'tenant_gpt_operating_guide_read',
  'Tenant GPT Operating Guide',
  'Read the tenant-safe operating guide that teaches Tenant GPTs how to guide users before public UI is complete.',
  'GET',
  '/tenant/docs/read',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'path',JSON_OBJECT('type','string','enum',JSON_ARRAY('docs/tenant-gpt-operating-guide.md')),
      'max_chars',JSON_OBJECT('type','integer','minimum',500,'maximum',20000)
    ),
    'required',JSON_ARRAY('path'),
    'additionalProperties',false
  ),
  NULL,
  'tenant,docs,guide,read_only,no_secrets',
  1,
  261
),
(
  'tenant_capability_registry_read',
  'Tenant Capability Registry',
  'Read the tenant-safe capability registry so Tenant GPTs can distinguish active, foundation, and planned capabilities.',
  'GET',
  '/tenant/docs/read',
  JSON_ARRAY(),
  JSON_OBJECT(
    'type','object',
    'properties',JSON_OBJECT(
      'path',JSON_OBJECT('type','string','enum',JSON_ARRAY('schemas/http-generic-api/tenant-capability-registry.json')),
      'max_chars',JSON_OBJECT('type','integer','minimum',500,'maximum',20000)
    ),
    'required',JSON_ARRAY('path'),
    'additionalProperties',false
  ),
  NULL,
  'tenant,docs,capabilities,read_only,no_secrets',
  1,
  262
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
