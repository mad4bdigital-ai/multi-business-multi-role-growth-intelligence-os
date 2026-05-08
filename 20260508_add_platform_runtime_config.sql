CREATE TABLE IF NOT EXISTS platform_runtime_config (
  config_key VARCHAR(128) PRIMARY KEY,
  config_json JSON NOT NULL,
  status ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO platform_runtime_config (config_key, config_json, status)
VALUES (
  'activation.bootstrap.github',
  JSON_OBJECT(
    'source', 'db_runtime',
    'sheets_required', false,
    'github_parent_action_key', 'github_api_mcp',
    'github_endpoint_key', 'github_get_repository',
    'github_owner', 'mad4bdigital-ai',
    'github_repo', 'multi-business-multi-role-growth-intelligence-os',
    'github_branch', 'main'
  ),
  'active'
)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = 'active',
  updated_at = NOW();