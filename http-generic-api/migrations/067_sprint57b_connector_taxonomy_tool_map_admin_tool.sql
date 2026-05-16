-- Sprint 57b: Register connector taxonomy tool-map diagnostic.

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `sort_order`, `is_enabled`)
VALUES
  ('connector_taxonomy_tool_map',
   'Connector Taxonomy Tool Map',
   'Read-only app integration to governed tool binding map. Filters: app_key, app_category, tool_key, tool_surface, binding_role, credential_source, exposure_scope, only_bound, only_connected, limit.',
   'GET', '/admin/connector-taxonomy/tool-map',
   '[]',
   '{"type":"object","properties":{"app_key":{"type":"string"},"app_category":{"type":"string"},"tool_key":{"type":"string"},"tool_surface":{"type":"string","enum":["admin_platform_tool","tenant_platform_tool","system_tool","platform_endpoint_export","device_tool","virtual_tool"]},"binding_role":{"type":"string","enum":["connection_management","credential_status","device_control","workflow_control","dns_control","app_install","diagnostic","read_only","state_changing","unknown"]},"credential_source":{"type":"string","enum":["user_connection","tenant_connection","platform_managed","device_connector","none","mixed"]},"exposure_scope":{"type":"string","enum":["admin","tenant","both"]},"only_bound":{"type":"boolean"},"only_connected":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":500,"default":100}}}',
   NULL,
   'admin,connector_taxonomy,diagnostics,read_only',
   523,
   1)
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
