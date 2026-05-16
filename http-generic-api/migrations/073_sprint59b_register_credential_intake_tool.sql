-- Sprint 59b: Register secure credential intake session creation tool.

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `sort_order`, `is_enabled`)
VALUES
  ('credential_intake_session_create',
   'Create Credential Intake Session',
   'Create a short-lived, single-use secure web form URL for entering connector credentials. Supports schema-driven fields for API keys, bearer tokens, MCP, webhook, basic auth, custom headers, and client credentials.',
   'POST', '/credential-intake/sessions',
   '[]',
   '{"type":"object","required":["user_id","tenant_id","app_key","auth_type"],"properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"},"app_key":{"type":"string"},"auth_type":{"type":"string","enum":["api_key","bearer_token","mcp","webhook","basic_auth","oauth2","custom_headers","client_credentials"]},"display_label":{"type":"string"},"mcp_endpoint":{"type":"string"},"webhook_url":{"type":"string"},"api_base_url":{"type":"string"},"workspace_id":{"type":"string"},"credential_schema":{"type":"object","description":"Optional schema: {fields:[{name,label,type,target,required,secret,placeholder,help,options}]}"},"metadata":{"type":"object"},"expires_in_minutes":{"type":"integer","minimum":1,"maximum":1440,"default":30},"created_by":{"type":"string"}}}',
   NULL,
   'admin,credentials,secure_intake,read_write',
   530,
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
