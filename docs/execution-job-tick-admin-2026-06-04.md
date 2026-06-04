# Execution Job Tick Admin Recovery Surface

Date: 2026-06-04

## Purpose

This recovery surface processes exactly one already-queued job through the same `executeSingleQueuedJob` runner used by the worker runtime.

It exists for smoke and recovery cases where a job was written to Redis/BullMQ but was not picked up by the background worker in the expected window.

## Endpoint

```text
POST /jobs/{job_id}/tick
```

## Admin tool

Migration `192_sprint66_execution_job_tick_admin_tool.sql` registers:

```text
execution_job_tick_admin
```

## Guardrails

The route is intentionally narrow:

- admin only
- backend API key required
- one job per request
- job must already exist
- job must currently be `queued`
- uses the same `executeSingleQueuedJob` runner path as the worker
- does not create jobs
- does not modify queue configuration
- does not grant new execution capability
- does not read or return secrets

## Response model

Successful response returns:

```text
ok: true
ticked: true
before_status: queued
job: JobSummary
result: optional job result
error: optional job error
secrets_included: false
```

Non-queued jobs return `409 job_not_queued`.
Missing jobs return `404 job_not_found`.
Missing tick dependencies return `503 job_tick_unavailable`.

## Intended smoke use

1. Enqueue a governed dry-run or metadata-only job.
2. If health shows the job remains queued, call `execution_job_tick_admin` for that job id.
3. Read back job status, target tables, evidence rows, and release readiness.

## Safety note

This is not a scheduler and not a worker replacement. It is a recovery/tick surface for one queued job only.
