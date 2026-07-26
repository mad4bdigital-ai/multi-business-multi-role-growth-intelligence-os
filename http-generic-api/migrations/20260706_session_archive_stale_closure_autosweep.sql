-- Enable bounded stale GPT session closure from the existing dynamic audit scheduler.
-- Additive runtime configuration only. The runtime closes only gpt_action sessions that are
-- still active, have turns, have no turn storage gaps, and whose latest archived turn is older
-- than stale_days. Closure uses session archive services, summary writeback, Drive export, and
-- same-cycle readback. No provider call, external send, credential payload read, or secrets.

INSERT INTO platform_runtime_config (
  config_key,
  config_json,
  status,
  note
) VALUES (
  'session_archive_stale_closure_autosweep',
  JSON_OBJECT(
    'enabled', TRUE,
    'stale_days', 3,
    'limit', 25,
    'user_email', 'nagyxs@gmail.com',
    'scheduler_owner', 'dynamic_audit_runtime',
    'cycle_alias', 'governed_platform_automation_tick',
    'selection_policy', JSON_OBJECT(
      'originator', 'gpt_action',
      'session_status', 'active',
      'min_turn_count', 1,
      'require_drive_backed_turns', TRUE,
      'latest_turn_older_than_days', 3
    ),
    'closure_policy', JSON_OBJECT(
      'tool_equivalent', 'gpt_session_end',
      'archive_close_required', TRUE,
      'summary_required', TRUE,
      'drive_export_required', TRUE,
      'same_cycle_readback_required', TRUE,
      'bulk_sql_close_allowed', FALSE
    ),
    'raw_payload_stored', FALSE,
    'secrets_included', FALSE
  ),
  'active',
  'Autosweep stale active GPT action sessions through dynamic audit runtime using archive close plus Drive export readback.'
)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = 'active',
  note = VALUES(note),
  updated_at = CURRENT_TIMESTAMP;
