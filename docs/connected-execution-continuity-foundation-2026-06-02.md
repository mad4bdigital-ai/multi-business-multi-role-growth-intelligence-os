# Connected Execution Continuity Foundation

Date: 2026-06-02

## Purpose

This foundation changes the operating model from manual, disconnected rounds to DB-backed connected execution sessions.

It does not make the assistant run in the background by itself. Instead, it gives the platform a durable continuity layer so every invocation can resume from the latest checkpoint, plan, evidence report, and next action without requiring the user to say a specific phrase such as "continue".

## Problem

Long-running execution currently depends on the conversation turn staying alive. When the turn ends, the assistant can leave a checkpoint in text, but the platform does not have a normalized runtime object for:

- current state
- plan/run/step linkage
- evidence collected so far
- next action
- blockers
- resume policy
- budget policy
- pending actions
- cross-surface execution types beyond repo work

## Existing platform surfaces reused

The foundation is intentionally layered over existing plan/execution tables:

- `execution_plans`
- `workflow_runs`
- `step_runs`
- `approval_holds`
- `request_envelopes`

The new tables do not replace them.

## New tables

### `connected_execution_sessions`

Durable session-level state for connected execution.

Stores:

- linked plan/run/step IDs
- mode: `single_turn`, `connected_rounds`, or `worker_driven`
- status
- resume policy
- budget policy
- checkpoint policy
- resume cursor
- latest checkpoint summary
- next action
- last evidence report ID
- round count/max rounds
- last error

### `connected_execution_evidence_reports`

Append-only evidence reports for each checkpoint or transition.

Stores:

- summary
- evidence
- CI/readiness evidence
- artifact refs
- blockers
- next action
- first resume instruction
- secrets flag

### `connected_execution_resume_actions`

Pending dynamic actions that can be resumed by a GPT invocation, governed worker, or future queue consumer.

Supported action kinds:

- `tool_call`
- `repo_operation`
- `db_operation`
- `provider_operation`
- `local_device_operation`
- `document_generation`
- `analysis_step`
- `approval_request`
- `user_prompt`
- `stop`

## Latest checkpoint view

`connected_execution_latest_checkpoint` gives a compact read model over the latest evidence report for a connected session.

It is intended for:

- dynamic resume
- status reporting
- UI/dashboard rendering
- handoff summaries

## Dynamic resume model

A future runtime layer can do this at the start of each invocation:

1. Resolve tenant/user/session context.
2. Find latest active `connected_execution_sessions` row.
3. Read `connected_execution_latest_checkpoint`.
4. Read the next pending `connected_execution_resume_actions` row.
5. Validate guardrails, authority, and budget.
6. Execute only the next safe action.
7. Write a new evidence report.
8. Update the session cursor and next action.

This makes resume dynamic. The user does not need to say "continue" if the runtime invocation policy decides an active connected session should resume.

## Important runtime boundary

The assistant cannot keep executing after a response ends unless a platform worker, queue, webhook, scheduler, or new invocation calls it again.

Therefore, this foundation supports two modes:

### `connected_rounds`

Default mode. Every new GPT/tool invocation resumes from DB state if allowed.

### `worker_driven`

Future mode. A governed worker or n8n workflow can claim pending resume actions and execute them until a stop condition, approval hold, or budget limit is reached.

The current production health reports queue/worker disabled, so this migration does not assume background execution is available.

## Checkpoint contract

Every long task should persist an evidence report with:

```text
current_status
last_verified_evidence
open_pr_or_artifact
last_ci_or_readiness_run_id
pending_migration_or_apply_step
blockers
next_action
first_resume_instruction
secrets_included=false
```

This is the DB equivalent of the previous text-only handoff.

## Generic, not repo-only

The model supports repo and non-repo tasks by using generic action kinds and JSON payloads. Examples:

- repo PR/CI repair
- DB migration apply/readback
- local connector repair
- PDF/doc/spreadsheet generation
- browser/UI diagnostic
- provider validation
- approval request
- release readiness audit

## Safety model

This foundation does not execute pending actions. It only records state and pending action intent.

Execution layers must still enforce:

- route/tool authority
- resource authority
- dry-run before apply where required
- audit evidence
- readback
- budget and max rounds
- no secrets in evidence reports
- approval holds for high-risk actions

## Migration

```text
181_sprint66_connected_execution_continuity_foundation.sql
```

The migration is additive:

- `CREATE TABLE IF NOT EXISTS`
- `CREATE OR REPLACE VIEW`
- `INSERT IGNORE` certification row
- no `DROP`
- no `DELETE`
- no `TRUNCATE`
- no `CAST(? AS JSON)`

## Next implementation steps

After this foundation is merged/applied:

1. Add admin/tenant-safe read/write tools for connected execution sessions.
2. Add a start-of-invocation resolver that loads latest connected session state.
3. Add a safe claim/complete flow for pending resume actions.
4. Add dashboard projection for active connected sessions.
5. Add optional worker/n8n driver only after queue/worker readiness is explicit.
