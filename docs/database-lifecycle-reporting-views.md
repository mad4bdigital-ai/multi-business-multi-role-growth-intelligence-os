# Database lifecycle reporting views

## Purpose

The database lifecycle registry records ownership, usage status, retention, and risk metadata for runtime tables. The reporting views in migration `172_sprint65_database_lifecycle_reporting_views.sql` provide read-only operational summaries for the AI Intelligence Runtime & Governance Layer.

## Scope

These views are visibility surfaces only. They do not drop, truncate, delete, archive, or mutate application tables.

## Views

### `v_database_lifecycle_status_summary`
Summarizes table counts and size by `usage_status` and `risk_level`.

### `v_database_lifecycle_owner_coverage`
Shows how many tables each owner engine covers, including high-risk, unclassified, and placeholder counts.

### `v_database_lifecycle_growth_hotspots`
Lists large or high-row-count tables that need growth monitoring.

### `v_database_lifecycle_placeholder_review`
Lists tables marked as `planned_placeholder` so owners can decide whether to keep, link to roadmap, or propose archive candidacy.

### `v_database_lifecycle_high_risk_review`
Lists high-risk tables across all families for periodic review.

### `v_database_lifecycle_credential_review`
Lists credential/secret/token-related lifecycle entries without exposing secret values.

### `v_database_lifecycle_backup_snapshot_review`
Lists backup and repair snapshot tables for retention review.

## Retention plan CLI

`http-generic-api/scripts/database-lifecycle-retention-plan.mjs` reads the
lifecycle registry and emits a dry-run retention/growth action plan for
hotspots, backup snapshots, placeholders, and high-risk rows.

The plan is review-only:

- it does not write to the database;
- it does not drop, truncate, or delete tables;
- it does not execute archive or compaction work;
- every generated action has `execution_allowed = false`.

Execution requires a future, separate governed runner with approval, validator,
readback, and audit evidence gates.

## Report snapshots

Migration `182_sprint66_database_lifecycle_report_snapshots.sql` adds
`database_lifecycle_report_snapshots` and
`v_database_lifecycle_report_snapshot_summary` for evidence-only lifecycle
report snapshots.

`http-generic-api/scripts/database-lifecycle-report-snapshot.mjs` can build a
snapshot from the retention plan. It is dry-run by default. Database writeback is
confirmation-gated:

```powershell
node scripts/database-lifecycle-report-snapshot.mjs --limit 80
node scripts/database-lifecycle-report-snapshot.mjs `
  --limit 80 `
  --apply `
  --confirm APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT
```

Snapshot writeback records report evidence only. It does not archive, delete,
drop, truncate, compact, read secrets, or execute lifecycle cleanup.

## Snapshot schedule readiness

Migration `183_sprint66_database_lifecycle_snapshot_schedule_readiness.sql`
adds `database_lifecycle_report_snapshot_schedules` and
`v_database_lifecycle_report_snapshot_schedule_readiness`.

The default weekly retention-plan schedule is inserted as `planned_disabled`
with `approval_status = pending`. It records cadence, retention, notification,
and executor-policy metadata only. It does not start a recurring job.

`http-generic-api/scripts/database-lifecycle-report-schedule-readiness.mjs`
reports whether schedule metadata is ready:

```powershell
node scripts/database-lifecycle-report-schedule-readiness.mjs
node scripts/database-lifecycle-report-schedule-readiness.mjs `
  --schedule-key database_lifecycle_retention_plan_weekly
```

Readiness output is dry-run and `will_execute = false`. A separate scheduler
binding must be approved before any recurring snapshot writeback is enabled.

## Scheduler binding readiness

Migration `184_sprint66_database_lifecycle_scheduler_binding_readiness.sql`
adds `database_lifecycle_report_snapshot_scheduler_bindings` and
`v_database_lifecycle_scheduler_binding_readiness`.

The default binding is inserted as `planned_disabled` with
`approval_status = pending`. It names the intended runner command, scheduler
surface, confirmation gate, readback gate, and executor policy. It does not
enable a scheduler.

`http-generic-api/scripts/database-lifecycle-scheduler-binding-readiness.mjs`
reports whether binding metadata is ready:

```powershell
node scripts/database-lifecycle-scheduler-binding-readiness.mjs
node scripts/database-lifecycle-scheduler-binding-readiness.mjs `
  --binding-key database_lifecycle_retention_plan_weekly_binding
```

Binding readiness remains dry-run and `will_execute = false`. Actual recurring
execution still requires a separate approved scheduler integration.

## Scheduler approval metadata

Migration `185_sprint66_database_lifecycle_scheduler_approval_metadata.sql`
adds `database_lifecycle_scheduler_approval_events` and a confirmation-gated
metadata update surface.

The route and CLI can approve, reject, or revoke schedule/binding metadata.
Approval requires:

- typed confirmation `APPROVE_DATABASE_LIFECYCLE_SCHEDULER_METADATA`;
- `notification_target`;
- `executor_policy_key`.

```powershell
node scripts/database-lifecycle-scheduler-approval-metadata.mjs `
  --target-type schedule `
  --target-key database_lifecycle_retention_plan_weekly `
  --decision approve `
  --notification-target admin_ops `
  --executor-policy-key database_lifecycle_report_snapshot_schedule_policy_v1
```

Apply mode writes metadata only. It does not enable a scheduler, write snapshots,
archive, delete, drop, truncate, compact, or read secrets.

## Scheduler approval readback

Migration `186_sprint66_database_lifecycle_scheduler_approval_readback.sql`
registers a read-only verification surface for approval metadata.

The route and CLI verify that:

- the target schedule or binding exists;
- the latest or requested approval event exists;
- target status and approval status match the event;
- notification and executor-policy metadata match when present;
- executable/destructive/secret flags remain blocked.

```powershell
node scripts/database-lifecycle-scheduler-approval-metadata.mjs `
  --readback-only `
  --target-type schedule `
  --target-key database_lifecycle_retention_plan_weekly
```

Approval readback is evidence-only. It does not enable scheduler jobs, write
snapshots, archive, delete, drop, truncate, compact, or read secrets.

## Scheduler approval proof runner

`http-generic-api/scripts/database-lifecycle-scheduler-approval-proof.mjs`
combines schedule and binding approval planning, optional metadata apply, and
post-apply readback verification.

Dry-run:

```powershell
node scripts/database-lifecycle-scheduler-approval-proof.mjs `
  --notification-target admin_ops `
  --executor-policy-key database_lifecycle_report_snapshot_schedule_policy_v1 `
  --actor-id admin
```

Apply metadata and verify readback:

```powershell
node scripts/database-lifecycle-scheduler-approval-proof.mjs `
  --notification-target admin_ops `
  --executor-policy-key database_lifecycle_report_snapshot_schedule_policy_v1 `
  --actor-id admin `
  --apply `
  --confirm APPROVE_DATABASE_LIFECYCLE_SCHEDULER_METADATA
```

The proof runner exits non-zero if planning is blocked or post-apply readback is
not verified. It still does not enable scheduler jobs or execute snapshots.

Governed `admin_control` shell aliases keep live proof calls short and bounded:

```powershell
admin_control shell database_lifecycle_scheduler_approval_proof_dry_run `
  --notification-target admin_ops `
  --executor-policy-key database_lifecycle_report_snapshot_schedule_policy_v1 `
  --actor-id admin

admin_control shell database_lifecycle_scheduler_approval_proof_apply `
  --notification-target admin_ops `
  --executor-policy-key database_lifecycle_report_snapshot_schedule_policy_v1 `
  --actor-id admin `
  --confirm APPROVE_DATABASE_LIFECYCLE_SCHEDULER_METADATA
```

The dry-run alias rejects `--apply` in extra arguments, and the apply alias
rejects `--dry-run`.

## Scheduler snapshot runner

`http-generic-api/scripts/database-lifecycle-scheduler-snapshot-runner.mjs`
is the bounded integration runner for the approved lifecycle report schedule.
It checks schedule readiness, binding readiness, and approval metadata readback
before creating a report snapshot. It does not enable cron or background
scheduler jobs.

Dry-run:

```powershell
node scripts/database-lifecycle-scheduler-snapshot-runner.mjs `
  --schedule-key database_lifecycle_retention_plan_weekly `
  --binding-key database_lifecycle_retention_plan_weekly_binding
```

Apply a snapshot only after readiness is ready and approval readback is verified:

```powershell
node scripts/database-lifecycle-scheduler-snapshot-runner.mjs `
  --schedule-key database_lifecycle_retention_plan_weekly `
  --binding-key database_lifecycle_retention_plan_weekly_binding `
  --actor-id scheduler_runner `
  --apply `
  --confirm APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT
```

The runner exits non-zero when schedule readiness, binding readiness, or approval
readback is not verified. Apply mode writes an evidence snapshot only; it does
not archive, delete, drop, truncate, compact, or read secrets.

Governed `admin_control` shell aliases keep live snapshot calls short and
bounded:

```powershell
admin_control shell database_lifecycle_scheduler_snapshot_dry_run `
  --schedule-key database_lifecycle_retention_plan_weekly `
  --binding-key database_lifecycle_retention_plan_weekly_binding

admin_control shell database_lifecycle_scheduler_snapshot_apply `
  --schedule-key database_lifecycle_retention_plan_weekly `
  --binding-key database_lifecycle_retention_plan_weekly_binding `
  --actor-id scheduler_runner `
  --confirm APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT
```

The dry-run alias rejects `--apply` in extra arguments, and the apply alias
rejects `--dry-run`.

## Operating rules

- Treat all reports as decision support, not automatic action.
- Archive or deletion proposals require separate approval-gated workflows.
- Credential-related rows must never expose secret values.
- Placeholder tables should become either owned runtime tables, roadmap-linked placeholders, or explicitly reviewed archive candidates.

## Related surfaces

- `database_table_lifecycle_registry`
- `database_table_lifecycle_engine`
- `database_table_lifecycle_decision_brief`
- `database_table_lifecycle_register_plan`
