-- Sprint 62g: register admin tool for short-lived connector installer downloads

INSERT INTO `admin_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  ('local_connector_installer_download_link',
   'Create Local Connector Installer Download Link',
   'Create a short-lived signed download URL for install-local-connector.ps1 without exposing live credentials in the GPT response.',
   'POST',
   '/local-connector/install/download-link',
   NULL,
   '{"type":"object","required":["user_id","tenant_id","device_id"],"properties":{"user_id":{"type":"string"},"tenant_id":{"type":"string"},"device_id":{"type":"string"},"ttl_minutes":{"type":"integer","minimum":5,"maximum":120}}}',
   NULL,
   'local_connector,installer,download,admin',
   1,
   63)
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
