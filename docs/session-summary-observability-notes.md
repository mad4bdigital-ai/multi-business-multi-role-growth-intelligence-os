# Session Summary Observability Notes

## Purpose

This note documents the guarded runtime behavior for GPT session transcript summaries generated through Google AI Studio / Gemini and the fallback model chain.

## Runtime path

Session summary autosweep runs through:

```text
/dev-agent/session-summaries/autosweep
  -> runSessionSummaryAutosweep
  -> summarizeAndStoreSession
  -> loadSessionTranscript
  -> summarizeSessionTranscript
  -> writeSessionSummary
  -> verifySessionSummaryWrite
```

## Provider retry behavior

Gemini `generateContent` calls use bounded retry for retryable upstream HTTP statuses: `429`, `500`, `502`, `503`, and `504`.

Configuration:

- `MODEL_PROVIDER_MAX_RETRIES`, default `1`, max `5`
- `MODEL_PROVIDER_RETRY_BASE_MS`, default `1000`, capped at `10000`
- `Retry-After` is respected when the provider returns it, capped at 30 seconds

The retry path logs only sanitized metadata: provider, status, attempt number, max retries, and delay. It must not log prompt text, response bodies, API keys, tokens, or credentials.

## Operation logging

The SQL-primary `execution_log` table is the durable execution record. Each completed summary write creates a high-level `execution_log` row with. Transcript fallback paths such as `missing_drive_jsonl_id` are classified as `success_with_warnings` rather than plain `success`, so legacy/preview-only summaries are visible in monitoring:

- `entry_type = session_summary_autosweep`
- `execution_class = summary`
- `source_layer = sessionSummaryService`
- `route_keys = dev_agent_session_summary_autosweep`
- `selected_workflows = session_summary_autosweep`
- `execution_trace_id_writeback = run_id || summary_id`
- `artifact_json_asset_id = session_summary_<summary_id>` when graph attachment exists
- `output_summary` containing sanitized verification evidence and step status metadata

The returned `operation_log` array remains a bounded, per-step debug trace in the API response. It is not a separate database authority and must not replace `execution_log`. Session-level steps include:

- `load_session`
- `check_existing_summary`
- `load_transcript`
- `summarize_transcript`
- `write_session_summary`
- `verify_session_summary_write`
- `write_execution_log`

Autosweep-level steps include:

- `autosweep`
- `find_sessions_needing_summary`

The manual autosweep route returns a `run_id` so `operation_log`, created `session_summaries.dev_agent_run_id` rows, and `execution_log.execution_trace_id_writeback` can be correlated.

## Continuous verification

After each summary write, `verifySessionSummaryWrite` performs readback against `session_summaries` and checks for the linked `json_assets` session-summary asset. The returned verification object reports:

- `summary_row_present`
- `graph_asset_present`
- `graph_validation_status`
- `graph_active_status`

The summary row is the required persistence proof. The graph asset is reported separately so graph attachment issues can be diagnosed without losing the summary row.

## Failure classification

If Gemini or the fallback provider chain fails, the existing deterministic fallback summary is still written when possible. The operation result includes a `warning` such as `model_call_failed: Gemini API 429`, and the operation log marks the summary step as completed with a model warning rather than exposing raw upstream error bodies.
