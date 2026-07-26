-- Sprint 67: primary/superseded metadata for GPT session conversation refs.
-- Additive metadata + tool registry only. No destructive SQL.

ALTER TABLE `gpt_session_conversation_refs`
  ADD COLUMN IF NOT EXISTS `is_primary` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN IF NOT EXISTS `superseded_by_ref_id` VARCHAR(64) NULL AFTER `is_primary`,
  ADD COLUMN IF NOT EXISTS `superseded_at` DATETIME NULL AFTER `superseded_by_ref_id`,
  ADD COLUMN IF NOT EXISTS `correction_reason` VARCHAR(512) NULL AFTER `superseded_at`,
  ADD KEY IF NOT EXISTS `idx_gpt_session_conversation_refs_primary` (`is_primary`, `status`, `updated_at`),
  ADD KEY IF NOT EXISTS `idx_gpt_session_conversation_refs_superseded_by` (`superseded_by_ref_id`);

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('gpt_session_conversation_ref_mark_primary',
 'GPT Session Conversation Reference Mark Primary',
 'Mark the current activation session conversation reference as primary and supersede stale references for the same ChatGPT conversation/share id.',
 'POST', '/gpt/sessions/{id}/conversation-ref/mark-primary',
 '["id"]',
 '{"type":"object","required":["id"],"properties":{"id":{"type":"string","description":"Platform customer_sessions.session_id that must be treated as the current activation session."},"ref_id":{"type":"string","description":"Optional existing gpt_session_conversation_refs.ref_id to mark primary."},"conversation_url":{"type":"string","description":"Private ChatGPT conversation URL. If supplied, the reference is upserted before marking primary."},"share_url":{"type":"string","description":"Optional ChatGPT share URL. If supplied, the reference is upserted before marking primary."},"correction_reason":{"type":"string","description":"Why this ref is primary, for example activation_session_context.current_session_id."},"source":{"type":"string"},"captured_by":{"type":"string"}}}',
 NULL,
 'session,archive,conversation_ref,chatgpt,primary,supersede,no_secrets',
 79,
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
('gpt_session_conversation_ref_mark_primary',
 'GPT Session Conversation Reference Mark Primary',
 'Mark the current tenant GPT activation session conversation reference as primary and supersede stale references for the same ChatGPT conversation/share id.',
 'POST', '/gpt/sessions/{id}/conversation-ref/mark-primary',
 '["id"]',
 '{"type":"object","required":["id"],"properties":{"id":{"type":"string","description":"Tenant customer_sessions.session_id that must be treated as the current activation session."},"ref_id":{"type":"string"},"conversation_url":{"type":"string","description":"Private ChatGPT Tenant GPT conversation URL."},"share_url":{"type":"string"},"correction_reason":{"type":"string"},"source":{"type":"string"},"captured_by":{"type":"string"}}}',
 NULL,
 'session,archive,conversation_ref,chatgpt,primary,supersede,tenant_custom_gpt,no_secrets',
 79,
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
