-- Sprint 64: Hybrid Managed/Dedicated integration policy.
-- Purpose: keep activation mode canonical (managed|dedicated) while allowing per-app
-- credential source modes such as Cloudflare dedicated + Google managed.

CREATE TABLE IF NOT EXISTS `tenant_integration_policies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` VARCHAR(64) NOT NULL,
  `app_key` VARCHAR(120) NOT NULL,
  `source_mode` ENUM('managed','dedicated') NOT NULL DEFAULT 'managed',
  `fallback_allowed` TINYINT(1) NOT NULL DEFAULT 0,
  `required_for_device_install` TINYINT(1) NOT NULL DEFAULT 0,
  `notes` TEXT NULL,
  `status` ENUM('active','archived') NOT NULL DEFAULT 'active',
  `source` VARCHAR(120) NULL,
  `created_by` VARCHAR(64) NULL,
  `updated_by` VARCHAR(64) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_integration_policy` (`tenant_id`, `app_key`),
  KEY `idx_tenant_policy_mode` (`tenant_id`, `source_mode`, `status`),
  KEY `idx_policy_app` (`app_key`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `tenant_platform_endpoint_tools`
  (`tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`)
VALUES
  (
    'connect_integration_policy_update',
    'Update Integration Source Policy',
    'Configure per-app managed/dedicated credential source modes for mixed tenant onboarding. Activation mode remains managed or dedicated; this policy controls each integration.',
    'POST',
    '/connect/api/integration-policy',
    NULL,
    '{"type":"object","required":["integration_modes"],"properties":{"integration_modes":{"type":"object","description":"Map app_key to managed or dedicated source policy.","additionalProperties":true}}}',
    NULL,
    'connect,integrations,hybrid,policy,state_changing,managed,dedicated',
    1,
    42
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
   SET `description` = 'Activate the tenant workspace in managed or dedicated mode, optionally with per-app mixed managed/dedicated integration_modes.',
       `input_schema` = '{"type":"object","required":["mode"],"properties":{"mode":{"type":"string","enum":["managed","dedicated"]},"device_id":{"type":"string"},"workspace_name":{"type":"string"},"cloudflare_mode":{"type":"string","enum":["managed","dedicated"]},"google_auth_mode":{"type":"string","enum":["managed","dedicated"]},"n8n_activation_mode":{"type":"string","enum":["managed_main_server","self_hosted_local"]},"integration_modes":{"type":"object","description":"Optional per-app source policy.","additionalProperties":true}}}'
 WHERE `tool_key` = 'connect_activate';

UPDATE `tenant_platform_endpoint_tools`
   SET `description` = 'Read connection status, onboarding state, registered devices, Dedicated readiness, and hybrid per-app managed/dedicated integration policy.'
 WHERE `tool_key` = 'connect_status';
