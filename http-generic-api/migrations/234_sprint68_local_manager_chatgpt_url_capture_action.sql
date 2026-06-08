-- Sprint 68: Local Manager ChatGPT current URL capture action.
-- Updates the generic Local Manager desktop command enqueue schema only.
-- No new secrets and no raw transcript/page content capture.

UPDATE `admin_platform_endpoint_tools`
SET `input_schema` = JSON_SET(
  CAST(`input_schema` AS JSON),
  '$.properties.action.enum',
  JSON_ARRAY('open_url', 'open_n8n', 'notify', 'focus_local_manager', 'codex_exec_readonly', 'capture_chatgpt_current_url'),
  '$.properties.payload.properties.session_id',
  JSON_OBJECT('type', 'string', 'description', 'Required for capture_chatgpt_current_url: activation_session_context.current_session_id.'),
  '$.properties.payload.properties.capture_endpoint',
  JSON_OBJECT('type', 'string', 'description', 'Optional path, defaults to /gpt/sessions/{session_id}/conversation-ref/capture-current.'),
  '$.properties.payload.properties.expected_host',
  JSON_OBJECT('type', 'string', 'default', 'chatgpt.com'),
  '$.properties.payload.properties.current_url',
  JSON_OBJECT('type', 'string', 'description', 'Returned by browser connector/extension/local prompt result; never include page content or cookies.')
),
`description` = 'Queue a foreground desktop action for a linked Local Manager device. Supports URL open, notification, local n8n, read-only Codex, and ChatGPT current URL capture for conversation archive refs.',
`tags` = 'local_manager,device,desktop,state_changing,audited,gpt_remote,codex,chatgpt_url_capture,interactive_user,read_only,no_repo_mutation,no_secrets',
`updated_at` = NOW()
WHERE `tool_key` = 'local_manager_desktop_command_enqueue'
  AND JSON_VALID(`input_schema`);
