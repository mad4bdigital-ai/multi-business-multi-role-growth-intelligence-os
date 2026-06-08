-- Sprint 68: Governed GPT session archive JSONL backfill tool.
-- Rebuilds readable Google Doc transcripts from existing JSONL sidecars for legacy sparse/tool-only sessions.
-- Does not delete old Drive artifacts and never exposes raw transcript content or secrets.

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`,
  `path_param_keys`, `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'gpt_session_archive_backfill',
  'GPT Session Archive Backfill',
  'Rebuild readable GPT session transcript Google Docs from existing JSONL sidecars for legacy sparse/tool-only sessions. Supports dry-run candidate listing and bounded apply. Does not delete old Drive artifacts or return raw transcript content.',
  'POST',
  '/release/session-archive-backfill',
  NULL,
  '{"type":"object","properties":{"session_id":{"type":"string","description":"Optional single customer_sessions.session_id to backfill."},"session_ids":{"type":"array","items":{"type":"string"},"maxItems":25,"description":"Optional explicit session ids to backfill."},"limit":{"type":"integer","minimum":1,"maximum":25,"default":5},"dry_run":{"type":"boolean","default":true},"reason":{"type":"string","default":"legacy_tool_only_backfill"}},"additionalProperties":false}',
  NULL,
  'release,session-archive,backfill,jsonl,drive-writeback,read_write,admin,no_secrets,dry_run_default_true',
  1,
  105
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);

CREATE OR REPLACE VIEW `v_gpt_session_archive_monitoring_issues` AS
SELECT session_id, 'archive_write_failed' AS issue_code, 'fail' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE archive_status = 'write_failed'
UNION ALL
SELECT session_id, 'archive_ready_partial' AS issue_code, 'warn' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE archive_status = 'ready_partial'
UNION ALL
SELECT session_id, 'missing_drive_jsonl' AS issue_code, 'fail' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE turn_rows > 0 AND COALESCE(drive_jsonl_id, '') = ''
UNION ALL
SELECT session_id, 'active_ref_without_primary' AS issue_code, 'fail' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE active_refs > 0 AND primary_refs = 0
UNION ALL
SELECT session_id, 'multiple_primary_refs' AS issue_code, 'fail' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE primary_refs > 1
UNION ALL
SELECT session_id, 'tool_only_capture_drift_after_pinning' AS issue_code, 'fail' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring` m
WHERE started_at >= '2026-06-08 19:35:00'
  AND tool_turns >= 5
  AND user_turns = 0
  AND assistant_turns = 0
  AND NOT EXISTS (
    SELECT 1 FROM `session_events` e
     WHERE e.session_id COLLATE utf8mb4_uca1400_ai_ci = m.session_id
       AND e.action_key = 'gpt_session_archive_backfill'
  )
UNION ALL
SELECT session_id, 'sparse_user_assistant_capture' AS issue_code, 'warn' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring` m
WHERE tool_turns >= 10
  AND (user_turns = 0 OR assistant_turns = 0)
  AND NOT EXISTS (
    SELECT 1 FROM `session_events` e
     WHERE e.session_id COLLATE utf8mb4_uca1400_ai_ci = m.session_id
       AND e.action_key = 'gpt_session_archive_backfill'
  )
UNION ALL
SELECT session_id, 'missing_conversation_ref' AS issue_code, 'warn' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE turn_rows > 0
  AND active_refs = 0
  AND session_status IN ('completed', 'closed');
