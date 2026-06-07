-- Sprint 67: GPT session conversation references.
-- Additive table + tool registry only. No destructive SQL.
-- Links platform customer_sessions to personal ChatGPT conversation URLs and
-- optional ChatGPT share URLs for the two supported Custom GPT interfaces.

CREATE TABLE IF NOT EXISTS `gpt_session_conversation_refs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ref_id` VARCHAR(64) NOT NULL,
  `session_id` VARCHAR(128) NOT NULL,
  `tenant_id` VARCHAR(36) NULL,
  `user_id` VARCHAR(36) NULL,
  `interface_scope` VARCHAR(64) NOT NULL DEFAULT 'unknown_custom_gpt',
  `interface_display_name` VARCHAR(200) NULL,
  `gpt_app_id` VARCHAR(128) NULL,
  `gpt_slug` VARCHAR(255) NULL,
  `conversation_id` VARCHAR(128) NULL,
  `personal_conversation_url` VARCHAR(1024) NULL,
  `share_id` VARCHAR(128) NULL,
  `share_url` VARCHAR(1024) NULL,
  `source` VARCHAR(64) NOT NULL DEFAULT 'manual_user_supplied',
  `captured_by` VARCHAR(128) NOT NULL DEFAULT 'custom_gpt',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `metadata_json` LONGTEXT NULL CHECK (metadata_json IS NULL OR JSON_VALID(metadata_json)),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gpt_session_conversation_refs_ref_id` (`ref_id`),
  UNIQUE KEY `uq_gpt_session_conversation_refs_personal` (`session_id`, `gpt_app_id`, `conversation_id`),
  UNIQUE KEY `uq_gpt_session_conversation_refs_share` (`session_id`, `share_id`),
  KEY `idx_gpt_session_conversation_refs_session` (`session_id`),
  KEY `idx_gpt_session_conversation_refs_tenant_user` (`tenant_id`, `user_id`),
  KEY `idx_gpt_session_conversation_refs_interface` (`interface_scope`, `gpt_app_id`),
  KEY `idx_gpt_session_conversation_refs_status` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('gpt_session_conversation_ref_upsert',
 'GPT Session Conversation Reference Upsert',
 'Attach a personal ChatGPT conversation URL and/or share URL to a platform GPT session archive. Supports Admin Custom GPT and Tenant Custom GPT URLs.',
 'POST', '/gpt/sessions/{id}/conversation-ref',
 '["id"]',
 '{"type":"object","required":["id"],"properties":{"id":{"type":"string","description":"Platform customer_sessions.session_id"},"conversation_url":{"type":"string","description":"Private ChatGPT conversation URL, such as https://chatgpt.com/g/<gpt-id>-<slug>/c/<conversation-id>. Private to the GPT account owner."},"share_url":{"type":"string","description":"Optional ChatGPT share URL, such as https://chatgpt.com/share/<share-id>."},"interface_scope":{"type":"string","enum":["admin_custom_gpt","tenant_custom_gpt","unknown_custom_gpt"],"description":"Optional hint when only share_url is supplied."},"source":{"type":"string","description":"manual_user_supplied, browser_connector, extension, or other capture source."},"captured_by":{"type":"string","description":"custom_gpt, local_connector, browser_extension, or operator label."}}}',
 NULL,
 'session,archive,conversation_ref,chatgpt,admin_custom_gpt,tenant_custom_gpt,no_secrets',
 78,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  sort_order = VALUES(sort_order),
  is_enabled = VALUES(is_enabled);

INSERT INTO `tenant_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('gpt_session_conversation_ref_upsert',
 'GPT Session Conversation Reference Upsert',
 'Attach a personal ChatGPT conversation URL and/or share URL to the tenant GPT session archive. Supports the MAD4B Growth Intelligence Tenant Custom GPT URL.',
 'POST', '/gpt/sessions/{id}/conversation-ref',
 '["id"]',
 '{"type":"object","required":["id"],"properties":{"id":{"type":"string","description":"Platform customer_sessions.session_id for this tenant/user session."},"conversation_url":{"type":"string","description":"Private ChatGPT Tenant GPT conversation URL, such as https://chatgpt.com/g/g-69b6e4de8fd88191ac132362e1ee300e-mad4b-growth-intelligence-tenant/c/<conversation-id>."},"share_url":{"type":"string","description":"Optional ChatGPT share URL."},"interface_scope":{"type":"string","enum":["tenant_custom_gpt","unknown_custom_gpt"],"description":"Optional hint when only share_url is supplied."},"source":{"type":"string"},"captured_by":{"type":"string"}}}',
 NULL,
 'session,archive,conversation_ref,chatgpt,tenant_custom_gpt,no_secrets',
 78,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  sort_order = VALUES(sort_order),
  is_enabled = VALUES(is_enabled);
