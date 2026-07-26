-- Sprint 69: separate actionable conversation-reference gaps from raw no-reference observations.
-- The existing sessions_without_active_ref field now follows the same governed predicate as
-- the missing_conversation_ref issue. Raw and non-actionable counts remain available for audit.
-- No transcript content, URLs, or secrets are exposed.

CREATE OR REPLACE VIEW `v_gpt_session_archive_monitoring_summary` AS
SELECT
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring`) AS monitored_sessions,
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring_issues`
    WHERE severity = 'fail') AS fail_issue_rows,
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring_issues`
    WHERE severity = 'warn') AS warn_issue_rows,
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring_issues`) AS total_issue_rows,
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring`
    WHERE archive_status IN ('ready', 'ready_rebuilt', 'ready_text_snapshot')) AS archive_ready_sessions,
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring`
    WHERE COALESCE(drive_jsonl_id, '') <> '') AS sessions_with_jsonl,
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring`
    WHERE primary_refs = 1) AS sessions_with_one_primary_ref,
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring`
    WHERE primary_refs > 1) AS sessions_with_multiple_primary_refs,
  (SELECT COUNT(DISTINCT session_id)
     FROM `v_gpt_session_archive_monitoring_issues`
    WHERE issue_code = 'missing_conversation_ref') AS sessions_without_active_ref,
  (SELECT COUNT(*)
     FROM `v_gpt_session_archive_monitoring`
    WHERE active_refs = 0) AS sessions_without_active_ref_observed,
  GREATEST(
    (SELECT COUNT(*)
       FROM `v_gpt_session_archive_monitoring`
      WHERE active_refs = 0)
    -
    (SELECT COUNT(DISTINCT session_id)
       FROM `v_gpt_session_archive_monitoring_issues`
      WHERE issue_code = 'missing_conversation_ref'),
    0
  ) AS sessions_without_active_ref_non_actionable;
