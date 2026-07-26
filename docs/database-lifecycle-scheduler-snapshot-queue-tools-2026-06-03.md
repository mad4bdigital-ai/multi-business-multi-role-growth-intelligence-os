# Database Lifecycle Scheduler Snapshot Queue Tools

Date: 2026-06-03

## Purpose

This change registers governed admin tool rows for the database lifecycle scheduler snapshot direct runner and queue enqueue surfaces.

The implementation routes already existed after the queue-enabled lifecycle snapshot runner work, but GPT/admin tool dispatch did not have dedicated tool rows for the two scheduler snapshot surfaces.

## Tools

```text
database_lifecycle_scheduler_snapshot_runner_dry_run
database_lifecycle_scheduler_snapshot_job_enqueue_dry_run
```

## Scope

Both tools are dry-run-only from the GPT/admin tool registry perspective.

They target:

```text
POST /platform/engines/database-lifecycle/scheduler-snapshot-runner
POST /platform/engines/database-lifecycle/scheduler-snapshot-jobs
```

## Safety

- `apply=true` is not accepted by the tool schema.
- `fixed_body` sets `apply=false` and `summary_only=true`.
- The queue enqueue tool may write job metadata to Redis/BullMQ.
- The queued payload remains dry-run.
- No snapshot write, archive, delete, drop, truncate, compaction, or secret read is enabled by this migration.
- The route and worker must still enforce lifecycle gates.

## Migration

```text
188_sprint66_database_lifecycle_scheduler_snapshot_queue_tools.sql
```

The migration is additive:

- admin tool registry upsert
- runtime dispatch certification upsert
- no destructive SQL
- no `CAST(? AS JSON)`

## Operational validation after merge

1. Governed migration dry-run.
2. Governed migration apply.
3. Read back both admin tools and certification row.
4. Run `release_readiness`.
5. Execute one queue enqueue dry-run with an idempotency key.
6. Verify Redis/queue health and job result without exposing secrets.
