# Connected Execution Worker Bridge

Date: 2026-06-04

## Purpose

This change connects the DB-backed connected execution continuity layer to the existing Redis/BullMQ worker runtime.

It introduces a worker bridge for a single safe phase:

```text
action_kind = analysis_step
```

## What it does

The bridge can:

1. enqueue one pending resume action as a BullMQ job
2. claim that resume action atomically
3. process `analysis_step` metadata only
4. append a connected execution evidence report
5. update the latest session checkpoint
6. mark the resume action completed or blocked

## What it does not do

The bridge does not:

- call GPT/model providers
- call registered tools
- mutate repositories
- run arbitrary SQL operations beyond its own continuity metadata updates
- call external providers
- call local devices
- execute apply operations
- include secrets in payloads, DB rows, or responses

## New job type

```text
connected_execution_resume_action
```

## New endpoint

```text
POST /connected-execution/sessions/{connected_session_id}/resume-actions/{resume_action_id}/enqueue
```

This endpoint accepts only pending `analysis_step` actions in this phase.

## New admin tool

Migration `191_sprint66_connected_execution_worker_bridge.sql` registers:

```text
connected_execution_resume_action_enqueue_dry_run
```

It is tagged as:

```text
analysis_step_only
metadata_write
evidence_write
no_tool_execution
no_repo_mutation
no_provider_call
no_local_device_call
no_secrets
```

## Runtime certification

The migration also registers:

```text
connected_execution_worker_bridge_v1
```

with:

```text
risk_class: B
certification_status: analysis_step_worker_registered
dispatch_allowed: 1
apply_allowed: 0
```

## Safety model

This is intentionally not a general autonomous worker.

Unsupported action kinds are blocked and receive an evidence report instead of being executed.

Supported `analysis_step` actions create evidence only. The worker writes state so a later invocation can resume from the latest checkpoint.

## Future phases

Recommended rollout:

```text
Phase 1: analysis_step metadata only
Phase 2: read-only tool_call allowlist
Phase 3: dry-run tool_call allowlist
Phase 4: approval-gated apply with validator evidence
Phase 5: worker-driven multi-step loops with budget limits
```
