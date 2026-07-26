-- Sprint 65: Remote Runtime local_path diff name-status command.
-- Adds one read-only local_path command mapped to a fixed connector_shell alias.
-- No SSH, freeform shell, file reads/writes, extra args, deploy, or restart are enabled.

INSERT INTO remote_runtime_command_allowlists
  (command_id, plugin_key, command_key, display_name, target_kind, command_template, input_schema_json, risk_class, requires_approval, is_consequential, output_policy, status, notes)
VALUES
  (UUID(), 'remote_ssh_runtime', 'diff_name_status', 'Diff Name Status', 'local_path', 'remote_runtime:local:diff_name_status', JSON_OBJECT('type','object','additionalProperties',false), 'low', 0, 0, 'bounded_text', 'active', 'Read-only git diff --name-status for a registered local project path.')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  target_kind = VALUES(target_kind),
  command_template = VALUES(command_template),
  input_schema_json = VALUES(input_schema_json),
  risk_class = VALUES(risk_class),
  requires_approval = VALUES(requires_approval),
  is_consequential = VALUES(is_consequential),
  output_policy = VALUES(output_policy),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO local_connector_shell_allowlists (
  config_id, alias, command_template, allow_extra_args, description
)
SELECT
  '8db63b00-4fce-11f1-b256-614c56cd019b',
  'repo_diff_name_status_growth_os',
  '"C:\\Program Files\\Git\\cmd\\git.exe" -C "D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS" diff --name-status',
  0,
  'Read-only git diff --name-status for Growth Intelligence OS local repo'
WHERE NOT EXISTS (
  SELECT 1 FROM local_connector_shell_allowlists
  WHERE config_id='8db63b00-4fce-11f1-b256-614c56cd019b'
    AND alias='repo_diff_name_status_growth_os'
);

UPDATE remote_runtime_targets
SET command_allowlist_json = JSON_ARRAY('validate','repo_status','controlled_repair','diff_name_status'),
    updated_by = 'migration_156_remote_runtime_diff_name_status',
    updated_at = CURRENT_TIMESTAMP
WHERE target_id = 'f7067be0-5974-11f1-9baf-8e76a7e1749f';

UPDATE admin_platform_endpoint_tools
SET input_schema = '{"type":"object","required":["target_id"],"properties":{"target_id":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"device_id":{"type":"string"},"command_key":{"type":"string","enum":["status","git_status","diff_name_status"],"default":"status"},"inputs":{"type":"object"},"timeout_ms":{"type":"integer","minimum":1000,"maximum":120000}}}',
    description = 'Execute allowlisted Remote Runtime local_path read-only commands. Supports status/git_status through repo_status_growth_os and diff_name_status through repo_diff_name_status_growth_os. Rejects Hostinger/SSH targets, arbitrary shell, file access, extra args, deploy, and restart.'
WHERE tool_key = 'remote_runtime_local_readonly_execute';
