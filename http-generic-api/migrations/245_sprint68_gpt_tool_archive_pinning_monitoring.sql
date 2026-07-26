-- Sprint 68: GPT tool auto-archive pinning monitor.
-- The runtime now refuses unpinned fallback auto-archive into sessions that only have tool turns.
-- Keep the historical sparse-capture warning, but fail new post-policy tool-only drift.

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
FROM `v_gpt_session_archive_monitoring`
WHERE started_at >= '2026-06-08 19:35:00'
  AND tool_turns >= 5
  AND user_turns = 0
  AND assistant_turns = 0
UNION ALL
SELECT session_id, 'sparse_user_assistant_capture' AS issue_code, 'warn' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE tool_turns >= 10 AND (user_turns = 0 OR assistant_turns = 0)
UNION ALL
SELECT session_id, 'missing_conversation_ref' AS issue_code, 'warn' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE turn_rows > 0
  AND active_refs = 0
  AND session_status IN ('completed', 'closed');
