# Session Context, Graph Memory, and Conversation Archive Notes

## Purpose

This note records the current platform decisions around hard activation session context, graph-memory usage, GPT session persistence, turn archival, and summary retrieval. Keep it updated whenever `/activation/session-context`, GPT session archive behavior, graph-memory context, or session summarization changes.

## Current implemented state

### Graph memory runtime

Graph memory is now a production v1 foundation used by multiple admin/runtime surfaces:

- `platformGraphMemoryResolver` resolves summary-only JSON assets through platform graph nodes and edges.
- Ranking weights are DB-governed through `platform_graph_memory_rank_rules` with safe code fallback.
- `release_readiness` includes non-blocking `graph_memory_diagnostics`.
- Endpoint execution planning attaches `graph_memory_context` as advisory-only context.
- Tenant connect activation flows attach `activation_graph_context` as advisory-only context.
- `graph_memory_usage_events` records non-blocking activation graph telemetry.
- Activation doctrine assets are seeded for managed flow, dedicated flow, per-app hybrid policy, device install prerequisites, and graph-authority boundaries.

All graph-memory contexts must stay summary-only:

```text
included_payload = summary_only
full_json_payload_included = false
raw_secret_values_included = false
secrets_included = false
```

Graph memory may explain context and suggest relevant policy assets, but it must not replace SQL authority tables, same-cycle validation, activation mode policy, integration readiness, credential resolution, or device provisioning evidence.

### Activation session context

`GET /activation/session-context` opens a new platform GPT session and returns platform-side continuity evidence. It does not access native ChatGPT history unless that content was explicitly archived into platform tables or Drive.

Parallel conversations are now the default. The endpoint must not close other active GPT conversations unless the caller explicitly asks for the legacy behavior:

```text
close_previous_sessions=true
close_previous=true
```

The response includes `session_management` with evidence such as:

```text
parallel_sessions_allowed
close_previous_sessions_requested
active_sessions_before_open
active_sessions_after_open
status_written = active
```

The endpoint also returns `conversation_memory` to make availability explicit:

- `native_chatgpt_history_available`: always false for platform-side activation.
- `platform_stored_sessions_available`: whether `customer_sessions` has platform records.
- `stored_turns_available`: whether `gpt_session_turns` has archived turns for relevant sessions.
- `turn_content_loaded`: true only when `include_turns=true` is requested.
- `summary_strategy`: prefer `session_summaries` and tagged refs, then load bounded turn previews on demand.
- `graph_assisted_lookup`: whether graph memory was attempted for context lookup.

Optional turn preview loading is bounded and explicit:

```text
include_turns=true
turns_limit=<bounded integer>
raw_max_chars=<bounded integer>
```

### GPT session and turn persistence

Current storage responsibilities:

| Table or store | Purpose |
|---|---|
| `customer_sessions` | One row per platform GPT session, session status, turn count, Drive archive pointers. |
| `gpt_session_turns` | One row per persisted turn, role, turn index, preview, content hash, action key, Drive pointers. |
| Google Drive session archive | Full conversation document / JSONL archive for durable long text. |
| `session_summaries` | Compact session-level summary, tags, blockers, feature requests, integration needs, complexity. |
| `platform_pending_tasks.conversation_context_ref` | References to important `gpt_session_turns:<session_id>` contexts for task continuation. |

The intended policy is: SQL should store identifiers, bounded previews, hashes, tags, summaries, and Drive pointers. Full conversation text should live in Drive archives, not inline SQL rows.

A small number of legacy `storage_mode='inline'` turn rows existed from smoke tests and should be converted to `preview_only` by the cleanup migration. New writes must keep `gpt_session_turns.content` null, keep the bounded preview only in `content_preview`, and store the full transcript in Drive doc/JSONL archives.

### Session summaries

There are two known summary writers:

1. `POST /gpt/sessions/{id}/end` may insert a caller-provided manual summary into `session_summaries`.
2. `POST /dev-agent/run` executes `runDevAgentSweep()`, which can summarize completed sessions and extract:
   - `summary_text`
   - `tasks_completed`
   - `blockers`
   - `feature_requests`
   - `integration_needs`
   - `complexity`

The desired retrieval behavior is summary-first:

1. Load `session_summaries` and their tags.
2. Resolve task context references such as `gpt_session_turns:<session_id>`.
3. Use graph memory to find relevant doctrine or prior context assets.
4. Load bounded turn previews only when `include_turns=true` or a task explicitly requires transcript detail.
5. Load full Drive transcript only for targeted continuation/debugging and never as a default activation payload.

## Current follow-up backlog

### 1. Clean SQL turn storage

Status: implemented by `fix/session-turns-sql-preview-cleanup`.

Required behavior:

- `recordGptSessionTurn()` writes full turn content only to Drive doc / JSONL.
- For `storage_mode='drive'`, `gpt_session_turns.content` is null.
- If Drive archive is unavailable, new rows use `storage_mode='preview_only'`; they still keep only a bounded preview in SQL.
- `gpt_session_turns.content_preview` keeps the bounded preview.
- Existing Drive/hybrid/preview rows are backfilled to clear `content` while preserving `content_preview`, `content_sha256`, and Drive pointers.
- Existing legacy `inline` rows are converted to `preview_only` after preserving a bounded preview.
- Regression tests prevent assigning `contentPreview` to both `content` and `content_preview` again.

### 2. Autosummarize sessions

Status: implemented by `feature/session-summary-autosweep`.

Implemented behavior:

- `endSession` triggers `summarizeSessionIfNeeded()` after Drive archive close.
- Manual summaries supplied to `endSession` are written through the same summary service and graph attachment path.
- `POST /dev-agent/session-summaries/autosweep` runs a governed manual autosweep.
- `POST /dev-agent/run` uses the Drive-backed autosweep for phase 1 before proposal extraction.
- The summarizer loads Drive JSONL first, falls back to SQL `content_preview` only when Drive JSONL is unavailable, and never reads SQL `content` as a full transcript source.
- Large transcripts are chunked before model summarization.
- Secret-like values are redacted before summarization.
- `session_summaries` stores compact tags and source metadata such as `tags_json`, `summary_sha256`, `summary_version`, `summary_source`, `source_turn_count`, `source_last_turn_at`, `source_drive_jsonl_id`, and `source_drive_doc_id`.
- Each summary is also attached as a summary-only `json_assets` record and graph memory node/edge so activation/context retrieval can find summaries without loading full turns.

### 3. Graph-assisted transcript retrieval

Future graph behavior:

- Represent session summaries as graph nodes when stable.
- Attach summaries to platform, tenant, task, device, endpoint, and activation policy nodes.
- Use graph ranking to pick summary IDs before turn IDs.
- Load actual transcript turns only after a selected summary or task context reference proves relevance.

## Documentation update rule

When any of the above behavior changes, update this file together with:

- `AI_Agent_Knowledge_Guide.md`
- `GPT_Admin_Assistant_Knowledge_Guide.md`
- `http-generic-api/openapi.yaml` when response shapes change
- `http-generic-api/openapi.custom-gpt.auth-dispatcher.yaml` when GPT action descriptions or parameters change
- tests or validators covering the behavior

Documentation should distinguish evidence that is platform-side (`customer_sessions`, `gpt_session_turns`, `session_summaries`, Drive archive) from native ChatGPT conversation history, which is not directly accessible to the backend.
