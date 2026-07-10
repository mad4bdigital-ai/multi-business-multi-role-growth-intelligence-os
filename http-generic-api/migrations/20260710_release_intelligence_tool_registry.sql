-- Register Release Intelligence ADMIN/TENANT tool exports.
-- Safety contract: registry-only, no provider call, no runtime deploy, no credential payload read, no secret response.

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'release_intelligence_operations_list',
    'List Release Operations',
    'List ADMIN release intelligence operations with optional tenant and status filters. Read-only and no secrets.',
    'GET',
    '/admin/release-intelligence/operations',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'tenant_id', JSON_OBJECT('type', 'string'),
        'status', JSON_OBJECT('type', 'string'),
        'limit', JSON_OBJECT('type', 'integer', 'minimum', 1, 'maximum', 100),
        'cursor', JSON_OBJECT('type', 'integer', 'minimum', 0)
      ),
      'additionalProperties', false
    ),
    NULL,
    'release_intelligence,admin,read_only,no_secrets,summary_first',
    1,
    6620
  ),
  (
    'release_intelligence_operation_create',
    'Create Release Operation',
    'Create an ADMIN release operation ledger row. Does not deploy or call providers.',
    'POST',
    '/admin/release-intelligence/operations',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'tenant_id', JSON_OBJECT('type', 'string'),
        'workspace_id', JSON_OBJECT('type', 'string'),
        'target_id', JSON_OBJECT('type', 'string'),
        'runtime_family', JSON_OBJECT('type', 'string'),
        'operation_type', JSON_OBJECT('type', 'string'),
        'expected_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
        'deployed_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$')
      ),
      'additionalProperties', true
    ),
    NULL,
    'release_intelligence,admin,state_changing,ledger,no_provider_call,no_secrets,readback',
    1,
    6621
  ),
  (
    'release_intelligence_operation_get',
    'Get Release Operation',
    'Get one ADMIN release operation with steps gate events and sanitized evidence.',
    'GET',
    '/admin/release-intelligence/operations/{operationId}',
    JSON_ARRAY('operationId'),
    JSON_OBJECT(
      'type', 'object',
      'required', JSON_ARRAY('operationId'),
      'properties', JSON_OBJECT('operationId', JSON_OBJECT('type', 'string')),
      'additionalProperties', false
    ),
    NULL,
    'release_intelligence,admin,read_only,no_secrets,evidence_manifest',
    1,
    6622
  ),
  (
    'release_intelligence_gate_event_create',
    'Create Release Gate Event',
    'Record a release gate lifecycle event. Does not open SSH or execute providers.',
    'POST',
    '/admin/release-intelligence/gate-events',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type', 'object',
      'required', JSON_ARRAY('operation_id', 'action'),
      'properties', JSON_OBJECT(
        'operation_id', JSON_OBJECT('type', 'string'),
        'gate_key', JSON_OBJECT('type', 'string'),
        'action', JSON_OBJECT('type', 'string', 'enum', JSON_ARRAY('open', 'close', 'expire', 'hard_disable', 'request_open', 'request_close')),
        'ttl_minutes', JSON_OBJECT('type', 'integer', 'minimum', 1, 'maximum', 240),
        'reason', JSON_OBJECT('type', 'string'),
        'capability_envelope_id', JSON_OBJECT('type', 'string'),
        'verification_run_id', JSON_OBJECT('type', 'string')
      ),
      'additionalProperties', false
    ),
    NULL,
    'release_intelligence,admin,state_changing,gate_manager,no_provider_call,no_secrets,readback',
    1,
    6623
  ),
  (
    'release_intelligence_advisor',
    'Release Intelligence Advisor',
    'Build a self-healing release plan for ADMIN scope. Advisor mode only unless create_operation is true.',
    'POST',
    '/admin/release-intelligence/advisor',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'environment_key', JSON_OBJECT('type', 'string'),
        'target_id', JSON_OBJECT('type', 'string'),
        'runtime_family', JSON_OBJECT('type', 'string'),
        'operation_type', JSON_OBJECT('type', 'string'),
        'expected_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
        'deployed_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
        'create_operation', JSON_OBJECT('type', 'boolean')
      ),
      'additionalProperties', false
    ),
    NULL,
    'release_intelligence,admin,advisor,no_provider_call,no_secrets,approval_planning',
    1,
    6624
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'tenant_release_intelligence_operations_list',
    'List Tenant Release Operations',
    'List release operations scoped to the signed-in tenant only.',
    'GET',
    '/me/release-intelligence/operations',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'status', JSON_OBJECT('type', 'string'),
        'limit', JSON_OBJECT('type', 'integer', 'minimum', 1, 'maximum', 100),
        'cursor', JSON_OBJECT('type', 'integer', 'minimum', 0)
      ),
      'additionalProperties', false
    ),
    NULL,
    'release_intelligence,tenant,read_only,no_secrets,tenant_scope,summary_first',
    1,
    6620
  ),
  (
    'tenant_release_intelligence_operation_create',
    'Create Tenant Release Operation',
    'Create a tenant-scoped release operation request. Does not deploy or call providers.',
    'POST',
    '/me/release-intelligence/operations',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'workspace_id', JSON_OBJECT('type', 'string'),
        'target_id', JSON_OBJECT('type', 'string'),
        'runtime_family', JSON_OBJECT('type', 'string'),
        'operation_type', JSON_OBJECT('type', 'string'),
        'expected_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
        'deployed_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$')
      ),
      'additionalProperties', true
    ),
    NULL,
    'release_intelligence,tenant,state_changing,request_only,no_provider_call,no_secrets,tenant_scope',
    1,
    6621
  ),
  (
    'tenant_release_intelligence_operation_get',
    'Get Tenant Release Operation',
    'Get one tenant-scoped release operation with sanitized evidence.',
    'GET',
    '/me/release-intelligence/operations/{operationId}',
    JSON_ARRAY('operationId'),
    JSON_OBJECT(
      'type', 'object',
      'required', JSON_ARRAY('operationId'),
      'properties', JSON_OBJECT('operationId', JSON_OBJECT('type', 'string')),
      'additionalProperties', false
    ),
    NULL,
    'release_intelligence,tenant,read_only,no_secrets,tenant_scope,evidence_manifest',
    1,
    6622
  ),
  (
    'tenant_release_intelligence_advisor',
    'Tenant Release Intelligence Advisor',
    'Build a tenant-safe self-healing release advisory plan. No execution and no secrets.',
    'POST',
    '/me/release-intelligence/advisor',
    JSON_ARRAY(),
    JSON_OBJECT(
      'type', 'object',
      'properties', JSON_OBJECT(
        'target_id', JSON_OBJECT('type', 'string'),
        'runtime_family', JSON_OBJECT('type', 'string'),
        'operation_type', JSON_OBJECT('type', 'string'),
        'expected_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
        'deployed_commit_sha', JSON_OBJECT('type', 'string', 'pattern', '^[0-9a-fA-F]{40}$'),
        'create_operation', JSON_OBJECT('type', 'boolean')
      ),
      'additionalProperties', false
    ),
    NULL,
    'release_intelligence,tenant,advisor,no_provider_call,no_secrets,tenant_scope,request_only',
    1,
    6623
  )
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
