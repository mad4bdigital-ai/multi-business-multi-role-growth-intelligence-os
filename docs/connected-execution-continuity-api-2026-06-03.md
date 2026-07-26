# Connected Execution Continuity API

Date: 2026-06-03

## Purpose

This change adds the first runtime/admin API layer over the connected execution continuity foundation.

It lets the platform persist and resume long-running work dynamically through DB-backed state instead of relying only on text handoff in a conversation.

## Scope

New admin-protected endpoints:

```text
POST /connected-execution/sessions
GET  /connected-execution/sessions/{connected_session_id}/checkpoint
POST /connected-execution/sessions/{connected_session_id}/evidence-reports
POST /connected-execution/sessions/{connected_session_id}/resume-actions
```

## Behavior

The API supports:

- create/update connected execution sessions
- read latest checkpoint projection
- append sanitized evidence reports
- enqueue pending resume action metadata

The API does not:

- execute a pending resume action
- claim work
- start a background worker
- enable queue processing
- read or return secrets
- mutate provider systems directly

## Admin tools

Migration `187_sprint66_connected_execution_continuity_api_tools.sql` registers:

```text
connected_execution_session_upsert
connected_execution_latest_checkpoint_get
connected_execution_evidence_report_create
connected_execution_resume_action_enqueue
```

## Runtime certification

The migration also registers:

```text
connected_execution_continuity_api_tools_v1
```

with:

```text
risk_class: B
certification_status: metadata_write_registered
dispatch_allowed: 1
apply_allowed: 0
```

## Dynamic resume model

A future invocation resolver or worker can use this API as follows:

1. Load latest session/checkpoint.
2. Read pending resume action metadata.
3. Validate authority, guardrails, and budget.
4. Execute at most one safe action through the governed dispatcher.
5. Append a new evidence report.
6. Update the session cursor.

This change implements steps 1, 2, 5, and 6 as persistence surfaces only. It does not implement step 4 execution.

## Safety

- Admin-protected routes only.
- Metadata write/read only.
- `secrets_included=false` in responses and rows.
- Resume actions are records, not execution authority.
- Any future worker must enforce dry-run/apply controls, audit evidence, resource authority, and readback.

## Migration

```text
187_sprint66_connected_execution_continuity_api_tools.sql
```

The migration is additive:

- admin tool registry upsert
- runtime certification registry upsert
- no destructive SQL
- no `CAST(? AS JSON)`

## OpenAPI

The four endpoints are documented under the `connected-execution` tag in `openapi.yaml`.
