-- Sprint 66: Tenant SSH CLI execute runtime config default
-- Keeps the execution runtime disabled by default in SQL-primary runtime config.
-- Runtime activation is explicit and audited through platform_runtime_config.

INSERT INTO platform_runtime_config (config_key, config_json, status, note)
VALUES (
  'tenant_ssh_cli_execute_runtime',
  JSON_OBJECT('enabled', false, 'driver', 'disabled', 'reason', 'default_disabled_until_dedicated_runtime_or_explicit_host_spawn_approval'),
  'active',
  'Tenant SSH CLI execute runtime gate. Default disabled; enable only with explicit reviewed runtime driver.'
)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
