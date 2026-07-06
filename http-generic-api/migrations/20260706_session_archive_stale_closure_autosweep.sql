-- Session archive stale closure autosweep runtime config.
-- Additive/idempotent config only. Execution is performed by dynamicAuditRuntime
-- through existing session archive close/export services and the dynamic audit scheduler lock.

INSERT INTO platform_runtime_config (config_key, config_json, status, note, created_at, updated_at)
VALUES (
  'session_archive_stale_closure_autosweep',
  JSON_OBJECT(
    'enabled', TRUE,
    'scheduler_owner', 'dynamic_audit_runtime',
    'cycle_alias', 'governed_platform_automation_tick',
    'mode', 'internal_runtime_interval_with_mysql_advisory_lock',
    'stale_days', 3,
    'limit', 25,
    'selection', JSON_OBJECT(
      'originator', 'gpt_action',
      'session_status', 'active',
      'requires_turn_count_gt', 0,
      'requires_all_turns_drive_backed', TRUE,
      'latest_turn_older_than_days', 3
    ),
    'closure_tool_key', 'gpt_session_end',
    'runtime_service_path', 'http-generic-api/dynamicAuditRuntime.js',
    'requires_summary', TRUE,
    'requires_drive_export', TRUE,
    'readback_required', TRUE,
    'audit_required', TRUE,
    'provider_call_allowed', FALSE,
    'external_send_allowed', FALSE,
    'raw_payload_stored', FALSE,
    'secrets_included', FALSE
  ),
  'active',
  'Automatically closes stale active GPT action sessions whose latest archived turn is older than 3 days and whose turns are fully Drive-backed. Runs inside governed_platform_automation_tick.',
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = NOW();

UPDATE platform_runtime_config
   SET config_json = JSON_SET(
         IF(JSON_VALID(config_json), config_json, JSON_OBJECT()),
         '$.session_archive_stale_closure_enabled', TRUE,
         '$.session_archive_stale_closure_config_key', 'session_archive_stale_closure_autosweep'
       ),
       note = CONCAT(COALESCE(note, ''), ' Session archive stale closure autosweep is bound through session_archive_stale_closure_autosweep.'),
       updated_at = NOW()
 WHERE config_key = 'dynamic_audit_scheduler'
 LIMIT 1;
