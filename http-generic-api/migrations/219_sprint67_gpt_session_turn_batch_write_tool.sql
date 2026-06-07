-- Sprint 67: Register GPT session batch turn write tool.
-- Additive registry update only. No destructive SQL.
-- This complements gpt_session_turn_write by allowing a GPT to write the
-- user prompt and assistant reply for one exchange in a single governed call.

INSERT INTO `admin_platform_endpoint_tools`
  (tool_key, display_name, description, http_method, http_path,
   path_param_keys, input_schema, fixed_body, tags, sort_order, is_enabled)
VALUES
('gpt_session_turns_write_batch',
 'GPT Session Turns Write Batch',
 'Append multiple conversation turns to the active customer_sessions row in one call. Use this once per conversational exchange with the user prompt and assistant reply so the Drive transcript and JSONL sidecar contain non-tool turns. SQL stores only bounded previews and hashes.',
 'POST', '/gpt/sessions/{id}/turns',
 '["id"]',
 '{"type":"object","required":["id","turns"],"properties":{"id":{"type":"string","description":"session_id returned by getActivationSessionContext"},"turns":{"type":"array","minItems":1,"maxItems":20,"items":{"type":"object","required":["role","content"],"properties":{"role":{"type":"string","enum":["user","assistant","tool"]},"content":{"type":"string","description":"Full turn content. The platform writes this to Drive and stores only a bounded preview plus hash in SQL."},"action_key":{"type":"string","description":"Optional governed action key when the turn is a tool call result."}}}}}}',
 NULL,
 'session,archive,writeback,batch,no_secrets',
 77,
 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description  = VALUES(description),
  http_method  = VALUES(http_method),
  http_path    = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  tags         = VALUES(tags),
  sort_order   = VALUES(sort_order),
  is_enabled   = VALUES(is_enabled);
