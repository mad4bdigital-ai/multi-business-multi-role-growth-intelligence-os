-- Sprint 56e: Register connector taxonomy diagnostics as admin tools.
--
-- These tools expose read-only connector taxonomy reports through /gpt/tools.
-- They call dedicated GET routes and do not expose arbitrary SQL.

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `sort_order`, `is_enabled`)
VALUES
  ('connector_taxonomy_summary',
   'Connector Taxonomy Summary',
   'Read-only summary of connector family registry, app-action bindings, coverage counts, and taxonomy quality checks.',
   'GET', '/admin/connector-taxonomy/summary',
   '[]',
   '{"type":"object","properties":{}}',
   NULL,
   'admin,connector_taxonomy,diagnostics,read_only',
   520,
   1),
  ('connector_taxonomy_app_map',
   'Connector Taxonomy App Map',
   'Read-only app integration to action capability map with endpoint/export/connection counts. Filters: app_key, app_category, action_key, credential_source, exposure_default, only_unbound, only_connected, limit.',
   'GET', '/admin/connector-taxonomy/app-map',
   '[]',
   '{"type":"object","properties":{"app_key":{"type":"string"},"app_category":{"type":"string"},"action_key":{"type":"string"},"credential_source":{"type":"string","enum":["user_connection","tenant_connection","platform_managed","target_resolved","none","mixed"]},"exposure_default":{"type":"string","enum":["not_exported","curated_exports","manual_tools","runtime_only"]},"only_unbound":{"type":"boolean"},"only_connected":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":500,"default":100}}}',
   NULL,
   'admin,connector_taxonomy,diagnostics,read_only',
   521,
   1),
  ('connector_taxonomy_family_coverage',
   'Connector Taxonomy Family Coverage',
   'Read-only connector family coverage report across actions, endpoints, and connected systems. Filters: connector_family, provider_family, protocol_type, runtime_layer, registry_status, only_in_use, limit.',
   'GET', '/admin/connector-taxonomy/family-coverage',
   '[]',
   '{"type":"object","properties":{"connector_family":{"type":"string"},"provider_family":{"type":"string"},"protocol_type":{"type":"string","enum":["rest_api","mcp","webhook","local_device","native_runtime","resolver","transport_executor","unknown"]},"runtime_layer":{"type":"string","enum":["provider_http","mcp","local_connector","native_runtime","resolver","transport_executor","unknown"]},"registry_status":{"type":"string","enum":["active","pending","deprecated","archived"]},"only_in_use":{"type":"boolean"},"limit":{"type":"integer","minimum":1,"maximum":500,"default":100}}}',
   NULL,
   'admin,connector_taxonomy,diagnostics,read_only',
   522,
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
