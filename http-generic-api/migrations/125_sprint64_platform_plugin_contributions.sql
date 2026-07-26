-- Sprint 64: Platform Plugin contribution intake.
-- Tenant/user scoped plugin drafts are stored separately from the Platform Base.
-- Contributions do not store credentials and require later certification before promotion.

CREATE TABLE IF NOT EXISTS `platform_plugin_contributions` (
  `contribution_id` varchar(64) NOT NULL,
  `plugin_key` varchar(191) NOT NULL,
  `display_name` varchar(255) NOT NULL,
  `plugin_type` varchar(80) NOT NULL DEFAULT 'rest_api',
  `owner_scope` enum('tenant','user') NOT NULL DEFAULT 'tenant',
  `owner_tenant_id` varchar(64) NULL,
  `owner_user_id` varchar(64) NULL,
  `target` enum('tenant_private','user_private','marketplace_candidate','platform_base_candidate') NOT NULL DEFAULT 'tenant_private',
  `base_plugin_key` varchar(191) NULL,
  `status` enum('draft','submitted','validation_failed','certified','rejected','archived') NOT NULL DEFAULT 'draft',
  `certification_status` varchar(80) NOT NULL DEFAULT 'not_started',
  `manifest_json` json NULL,
  `protocol_bindings_json` json NULL,
  `action_bindings_json` json NULL,
  `credential_policy_json` json NULL,
  `validation_report_json` json NULL,
  `notes` text NULL,
  `created_by` varchar(64) NULL,
  `updated_by` varchar(64) NULL,
  `submitted_at` datetime NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`contribution_id`),
  UNIQUE KEY `uniq_platform_plugin_contribution_owner_key` (`owner_scope`, `owner_tenant_id`, `owner_user_id`, `plugin_key`),
  KEY `idx_platform_plugin_contribution_tenant` (`owner_tenant_id`, `status`),
  KEY `idx_platform_plugin_contribution_user` (`owner_user_id`, `status`),
  KEY `idx_platform_plugin_contribution_plugin` (`plugin_key`, `status`),
  KEY `idx_platform_plugin_contribution_base` (`base_plugin_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'platform_plugin_contribution_create',
  'Create Platform Plugin Contribution',
  'Create a tenant/user scoped Platform Plugin draft contribution. Rejects secret-like payload keys and does not modify Platform Base definitions.',
  'POST',
  '/platform/plugins/contributions',
  NULL,
  '{"type":"object","required":["plugin_key","display_name"],"properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"owner_scope":{"type":"string","enum":["tenant","user"],"default":"tenant"},"target":{"type":"string","enum":["tenant_private","user_private","marketplace_candidate","platform_base_candidate"]},"plugin_key":{"type":"string"},"display_name":{"type":"string"},"plugin_type":{"type":"string","default":"rest_api"},"base_plugin_key":{"type":"string"},"manifest":{"type":"object"},"protocol_bindings":{"type":"array"},"action_bindings":{"type":"array"},"credential_policy":{"type":"object"},"notes":{"type":"string"},"submit":{"type":"boolean","default":false}}}',
  NULL,
  'admin,platform-plugin,contribution,state_changing,audited,no_secrets,draft_only',
  1,
  125
),
(
  'platform_plugin_contribution_list',
  'List Platform Plugin Contributions',
  'List tenant/user scoped Platform Plugin contributions without secrets.',
  'GET',
  '/platform/plugins/contributions',
  NULL,
  '{"type":"object","properties":{"tenant_id":{"type":"string"},"user_id":{"type":"string"},"status":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":50}}}',
  NULL,
  'admin,platform-plugin,contribution,read_only,diagnostics,no_secrets',
  1,
  126
),
(
  'platform_plugin_contribution_get',
  'Get Platform Plugin Contribution',
  'Read one Platform Plugin contribution by contribution_id without secrets.',
  'GET',
  '/platform/plugins/contributions/{contribution_id}',
  'contribution_id',
  '{"type":"object","required":["contribution_id"],"properties":{"contribution_id":{"type":"string"}}}',
  NULL,
  'admin,platform-plugin,contribution,read_only,diagnostics,no_secrets',
  1,
  127
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
