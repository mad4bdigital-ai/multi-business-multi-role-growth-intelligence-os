-- Sprint 67: GPT session archive monitoring.
-- Read-only views for conversation archive and ChatGPT conversation-ref integrity.
-- No raw turn content or secrets are exposed.

CREATE OR REPLACE VIEW `v_gpt_session_archive_monitoring` AS
SELECT
  s.session_id,
  s.tenant_id,
  s.user_id,
  s.originator,
  s.session_status,
  s.started_at,
  s.ended_at,
  s.archive_status,
  s.drive_doc_id,
  s.drive_jsonl_id,
  COALESCE(t.turn_rows, 0) AS turn_rows,
  COALESCE(t.user_turns, 0) AS user_turns,
  COALESCE(t.assistant_turns, 0) AS assistant_turns,
  COALESCE(t.tool_turns, 0) AS tool_turns,
  COALESCE(r.total_refs, 0) AS total_refs,
  COALESCE(r.active_refs, 0) AS active_refs,
  COALESCE(r.primary_refs, 0) AS primary_refs,
  COALESCE(r.superseded_refs, 0) AS superseded_refs,
  COALESCE(r.latest_conversation_id, NULL) AS latest_conversation_id,
  COALESCE(r.latest_share_id, NULL) AS latest_share_id,
  JSON_OBJECT(
    'session_id', s.session_id,
    'archive_status', s.archive_status,
    'has_drive_doc_id', IF(COALESCE(s.drive_doc_id, '') <> '', TRUE, FALSE),
    'has_drive_jsonl_id', IF(COALESCE(s.drive_jsonl_id, '') <> '', TRUE, FALSE),
    'turn_rows', COALESCE(t.turn_rows, 0),
    'user_turns', COALESCE(t.user_turns, 0),
    'assistant_turns', COALESCE(t.assistant_turns, 0),
    'tool_turns', COALESCE(t.tool_turns, 0),
    'active_refs', COALESCE(r.active_refs, 0),
    'primary_refs', COALESCE(r.primary_refs, 0),
    'superseded_refs', COALESCE(r.superseded_refs, 0),
    'monitoring_policy_start', '2026-06-07 00:00:00',
    'secrets_included', FALSE
  ) AS evidence_json
FROM `customer_sessions` s
LEFT JOIN (
  SELECT
    session_id,
    COUNT(*) AS turn_rows,
    SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS user_turns,
    SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS assistant_turns,
    SUM(CASE WHEN role = 'tool' THEN 1 ELSE 0 END) AS tool_turns
  FROM `gpt_session_turns`
  GROUP BY session_id
) t ON t.session_id COLLATE utf8mb4_uca1400_ai_ci = s.session_id
LEFT JOIN (
  SELECT
    session_id,
    COUNT(*) AS total_refs,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_refs,
    SUM(CASE WHEN status = 'active' AND COALESCE(is_primary, 0) = 1 THEN 1 ELSE 0 END) AS primary_refs,
    SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END) AS superseded_refs,
    MAX(conversation_id) AS latest_conversation_id,
    MAX(share_id) AS latest_share_id
  FROM `gpt_session_conversation_refs`
  GROUP BY session_id
) r ON r.session_id = s.session_id
WHERE s.originator = 'gpt_action'
  AND s.started_at >= '2026-06-07 00:00:00';

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
SELECT session_id, 'sparse_user_assistant_capture' AS issue_code, 'warn' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE tool_turns >= 10 AND (user_turns = 0 OR assistant_turns = 0)
UNION ALL
SELECT session_id, 'missing_conversation_ref' AS issue_code, 'warn' AS severity, evidence_json
FROM `v_gpt_session_archive_monitoring`
WHERE turn_rows > 0
  AND active_refs = 0
  AND session_status IN ('completed', 'closed');

CREATE OR REPLACE VIEW `v_gpt_session_archive_monitoring_summary` AS
SELECT
  COUNT(DISTINCT m.session_id) AS monitored_sessions,
  COALESCE(SUM(CASE WHEN i.severity = 'fail' THEN 1 ELSE 0 END), 0) AS fail_issue_rows,
  COALESCE(SUM(CASE WHEN i.severity = 'warn' THEN 1 ELSE 0 END), 0) AS warn_issue_rows,
  COALESCE(COUNT(i.issue_code), 0) AS total_issue_rows,
  COALESCE(SUM(CASE WHEN m.archive_status IN ('ready', 'ready_rebuilt', 'ready_text_snapshot') THEN 1 ELSE 0 END), 0) AS archive_ready_sessions,
  COALESCE(SUM(CASE WHEN COALESCE(m.drive_jsonl_id, '') <> '' THEN 1 ELSE 0 END), 0) AS sessions_with_jsonl,
  COALESCE(SUM(CASE WHEN m.primary_refs = 1 THEN 1 ELSE 0 END), 0) AS sessions_with_one_primary_ref,
  COALESCE(SUM(CASE WHEN m.primary_refs > 1 THEN 1 ELSE 0 END), 0) AS sessions_with_multiple_primary_refs,
  COALESCE(SUM(CASE WHEN m.active_refs = 0 THEN 1 ELSE 0 END), 0) AS sessions_without_active_ref
FROM `v_gpt_session_archive_monitoring` m
LEFT JOIN `v_gpt_session_archive_monitoring_issues` i ON i.session_id = m.session_id;
