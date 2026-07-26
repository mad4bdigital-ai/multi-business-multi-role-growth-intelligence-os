-- Sprint 67: ChatGPT current conversation URL capture tool.
-- Registers a semantic helper for browser/local/extension capture of the active ChatGPT URL.
-- No schema changes and no secrets.

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('gpt_session_conversation_ref_capture_current',
 'GPT Session Conversation Reference Capture Current URL',
 'Capture the current ChatGPT browser URL for the current activation session, then mark it primary and supersede stale refs for the same conversation/share id.',
 'POST', '/gpt/sessions/{id}/conversation-ref/capture-current',
 '["id"]',
 '{"type":"object","required":["id","current_url"],"properties":{"id":{"type":"string","description":"Platform customer_sessions.session_id from activation/session-context.current_session_id."},"current_url":{"type":"string","description":"Current ChatGPT browser URL captured by a browser connector or browser extension."},"active_tab_url":{"type":"string","description":"Alias for current_url when supplied by browser automation."},"location_href":{"type":"string","description":"Alias for current_url when supplied by browser JavaScript."},"source":{"type":"string","enum":["browser_connector","browser_extension","local_connector","manual_user_supplied"],"default":"browser_connector"},"captured_by":{"type":"string","description":"browser_connector, browser_extension, local_connector, or operator label."},"correction_reason":{"type":"string","description":"Why this captured ref is primary. Should reference activation_session_context.current_session_id."}}}',
 NULL,
 'session,archive,conversation_ref,chatgpt,capture_current,browser_connector,browser_extension,no_secrets',
 80,
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
('gpt_session_conversation_ref_capture_current',
 'GPT Session Conversation Reference Capture Current URL',
 'Capture the current Tenant GPT browser URL for the current tenant activation session, then mark it primary and supersede stale refs for the same conversation/share id.',
 'POST', '/gpt/sessions/{id}/conversation-ref/capture-current',
 '["id"]',
 '{"type":"object","required":["id","current_url"],"properties":{"id":{"type":"string","description":"Tenant customer_sessions.session_id from activation/session-context.current_session_id."},"current_url":{"type":"string","description":"Current Tenant GPT browser URL captured by a browser connector or browser extension."},"active_tab_url":{"type":"string"},"location_href":{"type":"string"},"source":{"type":"string","enum":["browser_connector","browser_extension","local_connector","manual_user_supplied"],"default":"browser_connector"},"captured_by":{"type":"string"},"correction_reason":{"type":"string"}}}',
 NULL,
 'session,archive,conversation_ref,chatgpt,capture_current,browser_connector,browser_extension,tenant_custom_gpt,no_secrets',
 80,
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
