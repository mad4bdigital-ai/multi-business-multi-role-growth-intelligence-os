-- Sprint 68: Agent runtime ledger readiness views.
-- Summary-only monitoring for agent_model_runs and agent_tool_calls.

CREATE OR REPLACE VIEW `v_agent_runtime_ledger_counts` AS
SELECT
  (SELECT COUNT(*) FROM `agent_model_runs`) AS model_run_total,
  (SELECT COUNT(*) FROM `agent_model_runs` WHERE `status` = 'completed') AS model_run_completed_total,
  (SELECT COUNT(*) FROM `agent_model_runs` WHERE `status` = 'failed') AS model_run_failed_total,
  (SELECT COUNT(*) FROM `agent_model_runs` WHERE `trace_id` IS NULL OR `trace_id` = '') AS model_run_missing_trace_total,
  (SELECT COUNT(*) FROM `agent_tool_calls`) AS tool_call_total,
  (SELECT COUNT(*) FROM `agent_tool_calls` WHERE `authorization_status` = 'authorized') AS tool_call_authorized_total,
  (SELECT COUNT(*) FROM `agent_tool_calls` WHERE `authorization_status` = 'failed') AS tool_call_failed_total,
  (SELECT COUNT(*) FROM `agent_tool_calls` WHERE `trace_id` IS NULL OR `trace_id` = '') AS tool_call_missing_trace_total,
  0 AS raw_prompt_stored,
  0 AS raw_tool_args_stored,
  0 AS raw_tool_result_stored,
  0 AS secrets_included;

CREATE OR REPLACE VIEW `v_agent_runtime_ledger_quality` AS
SELECT
  'model_runs' AS surface,
  COUNT(*) AS checked_rows,
  SUM(CASE WHEN `status` NOT IN ('completed','failed','cancelled','started','streaming') THEN 1 ELSE 0 END) AS invalid_status_rows,
  SUM(CASE WHEN `trace_id` IS NULL OR `trace_id` = '' THEN 1 ELSE 0 END) AS missing_trace_rows,
  SUM(CASE WHEN `no_raw_thinking_stored` <> 1 THEN 1 ELSE 0 END) AS raw_thinking_flag_rows,
  SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(`input_message_summary_json`, '$.raw_content_stored')) <> 'false' THEN 1 ELSE 0 END) AS raw_input_rows,
  SUM(CASE WHEN `output_message_summary_json` IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(`output_message_summary_json`, '$.raw_content_stored')) <> 'false' THEN 1 ELSE 0 END) AS raw_output_rows,
  SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(`input_message_summary_json`, '$.secrets_included')) <> 'false' THEN 1 ELSE 0 END) AS secret_input_rows,
  SUM(CASE WHEN `output_message_summary_json` IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(`output_message_summary_json`, '$.secrets_included')) <> 'false' THEN 1 ELSE 0 END) AS secret_output_rows
FROM `agent_model_runs`
UNION ALL
SELECT
  'tool_calls',
  COUNT(*),
  SUM(CASE WHEN `authorization_status` NOT IN ('pending','authorized','denied','failed') THEN 1 ELSE 0 END),
  SUM(CASE WHEN `trace_id` IS NULL OR `trace_id` = '' THEN 1 ELSE 0 END),
  0,
  SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(`input_summary_json`, '$.raw_args_stored')) <> 'false' THEN 1 ELSE 0 END),
  SUM(CASE WHEN `output_summary_json` IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(`output_summary_json`, '$.raw_result_stored')) <> 'false' THEN 1 ELSE 0 END),
  SUM(CASE WHEN `secrets_returned_to_model` <> 0 THEN 1 ELSE 0 END),
  SUM(CASE WHEN `pre_tool_gate_json` IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(`pre_tool_gate_json`, '$.secrets_included')) <> 'false' THEN 1 ELSE 0 END)
FROM `agent_tool_calls`;

CREATE OR REPLACE VIEW `v_agent_runtime_ledger_readiness` AS
SELECT
  'agent_runtime_ledger' AS readiness_key,
  CASE
    WHEN (SELECT COALESCE(SUM(invalid_status_rows + raw_thinking_flag_rows + raw_input_rows + raw_output_rows + secret_input_rows + secret_output_rows),0) FROM `v_agent_runtime_ledger_quality`) > 0 THEN 'fail'
    WHEN c.model_run_total = 0 THEN 'warn'
    WHEN c.tool_call_total = 0 THEN 'warn'
    WHEN c.tool_call_missing_trace_total > 1 THEN 'warn'
    ELSE 'pass'
  END AS readiness_status,
  c.model_run_total,
  c.model_run_completed_total,
  c.model_run_failed_total,
  c.model_run_missing_trace_total,
  c.tool_call_total,
  c.tool_call_authorized_total,
  c.tool_call_failed_total,
  c.tool_call_missing_trace_total,
  (SELECT COALESCE(SUM(invalid_status_rows),0) FROM `v_agent_runtime_ledger_quality`) AS invalid_status_rows,
  (SELECT COALESCE(SUM(raw_thinking_flag_rows + raw_input_rows + raw_output_rows),0) FROM `v_agent_runtime_ledger_quality`) AS raw_content_issue_rows,
  (SELECT COALESCE(SUM(secret_input_rows + secret_output_rows),0) FROM `v_agent_runtime_ledger_quality`) AS secret_issue_rows,
  CASE
    WHEN c.model_run_total = 0 THEN 'no_agent_model_runs_recorded'
    WHEN c.tool_call_total = 0 THEN 'no_agent_tool_calls_recorded'
    WHEN c.tool_call_missing_trace_total > 1 THEN 'tool_call_trace_gap_high'
    WHEN (SELECT COALESCE(SUM(invalid_status_rows),0) FROM `v_agent_runtime_ledger_quality`) > 0 THEN 'invalid_status_rows'
    WHEN (SELECT COALESCE(SUM(raw_thinking_flag_rows + raw_input_rows + raw_output_rows),0) FROM `v_agent_runtime_ledger_quality`) > 0 THEN 'raw_content_flags'
    WHEN (SELECT COALESCE(SUM(secret_input_rows + secret_output_rows),0) FROM `v_agent_runtime_ledger_quality`) > 0 THEN 'secret_flags'
    ELSE 'ready'
  END AS readiness_reason,
  'agent_runtime_ledger_smoke' AS recommended_smoke_alias,
  0 AS raw_prompt_stored,
  0 AS raw_tool_args_stored,
  0 AS raw_tool_result_stored,
  0 AS secrets_included
FROM `v_agent_runtime_ledger_counts` c;
