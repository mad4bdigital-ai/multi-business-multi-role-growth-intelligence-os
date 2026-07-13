-- Local Manager app-managed connector repair desktop action.
-- Extends the governed desktop command schema without exposing installer URLs or secrets.

UPDATE `admin_platform_endpoint_tools`
SET `input_schema` = JSON_SET(
  `input_schema`,
  '$.properties.action.enum',
  JSON_ARRAY('open_url', 'open_n8n', 'notify', 'focus_local_manager', 'repair_connector', 'codex_exec_readonly', 'capture_chatgpt_current_url')
),
`description` = 'Queue a foreground desktop action for a linked Local Manager device. Connector repair runs inside the Windows app through the signed installer coordinator and UAC; it must not open a browser download.',
`tags` = 'local_manager,device,desktop,state_changing,audited,gpt_remote,connector_repair,app_managed_installer,interactive_user,no_repo_mutation,no_secrets',
`updated_at` = NOW()
WHERE `tool_key` = 'local_manager_desktop_command_enqueue'
  AND JSON_VALID(`input_schema`);
