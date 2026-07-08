-- Export the SQL cache runtime policy routes as explicit governed Admin tools.
-- OpenAPI inventory synchronization remains metadata-only and auto-promotion stays disabled.

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `sort_order`, `is_enabled`)
VALUES
  (
    'sql_cache_runtime_policy_get',
    'SQL Cache Runtime Policy Get',
    'Read the effective MySQL-primary SQL cache runtime policy and freshness metadata. No secret values are returned.',
    'GET',
    '/admin/cache/sql-policy',
    '[]',
    '{"type":"object","properties":{"refresh":{"type":"boolean","default":false}},"additionalProperties":false}',
    NULL,
    'admin,cache,sql_cache,read_only,diagnostics,no_secrets',
    528,
    1
  ),
  (
    'sql_cache_runtime_policy_update',
    'SQL Cache Runtime Policy Update',
    'Dry-run or partially update the MySQL-primary SQL cache runtime policy using optimistic revision concurrency.',
    'PATCH',
    '/admin/cache/sql-policy',
    '[]',
    '{"type":"object","required":["expected_revision","policy"],"properties":{"expected_revision":{"type":"integer","minimum":0},"dry_run":{"type":"boolean","default":false},"policy":{"type":"object","additionalProperties":false,"properties":{"enabled":{"type":"boolean"},"key_version":{"type":"string","maxLength":48,"pattern":"^[a-zA-Z0-9_-]+$"},"max_value_bytes":{"type":"integer","minimum":1024,"maximum":8388608},"oversize_cooldown_seconds":{"type":"integer","minimum":0,"maximum":86400},"circuit_breaker_seconds":{"type":"integer","minimum":0,"maximum":3600},"single_flight_enabled":{"type":"boolean"},"table_allowlist":{"type":"string","maxLength":4000},"table_blocklist":{"type":"string","maxLength":4000},"table_policies":{"type":"object","maxProperties":200,"additionalProperties":{"type":"object","additionalProperties":false,"properties":{"enabled":{"type":"boolean"},"ttl_seconds":{"type":"integer","minimum":0,"maximum":86400},"max_value_bytes":{"type":"integer","minimum":1024,"maximum":8388608},"oversize_cooldown_seconds":{"type":"integer","minimum":0,"maximum":86400}}}}}}},"additionalProperties":false}',
    NULL,
    'admin,cache,sql_cache,state_changing,dry_run_default,revision_guard,readback,no_secrets',
    529,
    1
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
  `sort_order` = VALUES(`sort_order`),
  `is_enabled` = VALUES(`is_enabled`);
