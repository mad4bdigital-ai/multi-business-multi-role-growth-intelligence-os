-- Sprint 66: Remote database credential intake and auto-promotion governance
-- Separates SSH credentials from remote database credentials. SSH remains
-- ssh_host/ssh_port/ssh_user/ssh_private_key only. Remote database connections
-- use DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD through auth_type
-- remote_database.

ALTER TABLE `app_integrations`
  MODIFY COLUMN `auth_type` enum('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','ssh_key_pair','local_path','remote_database') NOT NULL;

ALTER TABLE `credential_intake_sessions`
  MODIFY COLUMN `auth_type` enum('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','custom_headers','client_credentials','ssh_key_pair','local_path','remote_database') NOT NULL;

ALTER TABLE `user_app_connections`
  MODIFY COLUMN `auth_type` enum('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','custom_headers','client_credentials','ssh_key_pair','local_path','remote_database') NOT NULL;

INSERT INTO `app_integrations`
  (`app_key`, `display_name`, `description`, `auth_type`, `category`, `default_action_grants`, `status`)
VALUES
  ('remote_mysql_database', 'Remote MySQL Database', 'Remote MySQL-compatible database credentials for governed database validation and controlled remote database operations. Uses DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD.', 'remote_database', 'infrastructure', JSON_ARRAY('database.validate_connection','database.read_schema'), 'beta')
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `auth_type` = VALUES(`auth_type`),
  `category` = VALUES(`category`),
  `default_action_grants` = VALUES(`default_action_grants`),
  `status` = VALUES(`status`);

UPDATE `admin_platform_endpoint_tools`
   SET `input_schema` = JSON_SET(
       COALESCE(`input_schema`, JSON_OBJECT()),
       '$.properties.auth_type.enum',
       JSON_ARRAY('api_key','bearer_token','mcp','webhook','basic_auth','oauth2','custom_headers','client_credentials','ssh_key_pair','remote_database'),
       '$.properties.metadata.properties.auto_promote_platform_secrets', JSON_OBJECT('type','boolean'),
       '$.properties.metadata.properties.platform_secret_mappings', JSON_OBJECT('type','array'),
       '$.properties.metadata.properties.promotion_approved', JSON_OBJECT('type','boolean'),
       '$.properties.metadata.properties.promotion_reason', JSON_OBJECT('type','string')
     ),
       `description` = 'Create a short-lived, single-use secure web form URL for entering connector credentials. Supports schema-driven fields for API keys, bearer tokens, MCP, webhook, basic auth, custom headers, client credentials, SSH key-pair credentials, and remote database credentials. Metadata may request server-side auto-promotion to platform secrets after form submission.'
 WHERE `tool_key` = 'credential_intake_session_create';
