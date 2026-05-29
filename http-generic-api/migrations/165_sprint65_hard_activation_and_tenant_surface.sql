-- Sprint 65: Hard activation evidence contract and tenant surface guard.
-- Hard activation requires separately evidenced session_context plus provider_bootstrap.
-- Tenant tools must not route User JWT callers into admin-only connector workaround paths.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'activation_hard_run',
  'Hard Activation Evidence Run',
  'Runs hard activation evidence orchestration. Calls session context first, then provider bootstrap validation, and returns one evidence matrix. Activation is not complete unless both session_context and provider_bootstrap evidence are present and valid.',
  'POST',
  '/activation/hard-run',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":50,"default":10},"include_raw":{"type":"boolean","default":false},"close_previous_sessions":{"type":"boolean","default":false},"provider_arguments":{"type":"object"}},"additionalProperties":false}',
  NULL,
  'activation,hard-activation,session-context,provider-bootstrap,evidence-matrix,admin,no_secrets',
  1,
  43
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

UPDATE `tenant_platform_endpoint_tools`
   SET `is_enabled` = 0,
       `description` = CONCAT(COALESCE(`description`, ''), ' [disabled: tenant surface must not dispatch User JWT callers into admin-only connector workaround routes]')
 WHERE `is_enabled` = 1
   AND (
     `http_path` LIKE '/connector/%'
     OR `http_path` LIKE '/admin/%'
     OR `http_path` LIKE '/admin/system/%'
   );
