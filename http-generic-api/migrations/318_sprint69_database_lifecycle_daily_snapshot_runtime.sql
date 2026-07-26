-- Migration execution safety: no_provider_call true; no_credential_payload_read true; no_raw_secrets true;
-- no_external_send true; no_external_write true; secrets_included=false.
-- Adds evidence-only daily lifecycle snapshot metadata and converts the existing
-- weekly surface to review-only. No retention action, archive, delete, drop,
-- truncate, compaction, provider call, external write, or secret read is enabled.

INSERT INTO database_lifecycle_report_snapshot_schedules
  (schedule_key, report_type, engine_key, cron_expression, timezone, report_limit,
   snapshot_retention_days, notification_target, approval_status, status,
   executor_policy_key, notes)
VALUES
  (
    'database_lifecycle_snapshot_daily',
    'retention_plan',
    'database_table_lifecycle_engine',
    '0 3 * * *',
    'UTC',
    1000,
    180,
    'admin_ops',
    'pending',
    'planned_disabled',
    'database_lifecycle_report_snapshot_schedule_policy_v1',
    'Daily evidence-only snapshot. Runtime may write snapshot/readiness metadata only after explicit schedule and binding approval. Retention actions remain disabled.'
  )
ON DUPLICATE KEY UPDATE
  report_type = VALUES(report_type),
  engine_key = VALUES(engine_key),
  cron_expression = VALUES(cron_expression),
  timezone = VALUES(timezone),
  report_limit = VALUES(report_limit),
  snapshot_retention_days = VALUES(snapshot_retention_days),
  notification_target = VALUES(notification_target),
  executor_policy_key = VALUES(executor_policy_key),
  notes = VALUES(notes),
  updated_at = UTC_TIMESTAMP();

INSERT INTO database_lifecycle_report_snapshot_scheduler_bindings
  (binding_key, schedule_key, runner_key, runner_command, scheduler_surface,
   executor_policy_key, notification_target, approval_status, status,
   dry_run_required, confirmation_required, readback_required, will_execute,
   no_drop, no_delete, no_archive_execution, no_compaction_execution,
   secrets_included, notes)
VALUES
  (
    'database_lifecycle_snapshot_daily_binding',
    'database_lifecycle_snapshot_daily',
    'database_lifecycle_report_snapshot_runner',
    'internal runtime: runDatabaseLifecycleDailySnapshotCycle; apply requires APPLY_DATABASE_LIFECYCLE_DAILY_SNAPSHOT_TICK and snapshot confirmation',
    'internal_runtime_interval',
    'database_lifecycle_report_snapshot_schedule_policy_v1',
    'admin_ops',
    'pending',
    'planned_disabled',
    1,
    1,
    1,
    0,
    1,
    1,
    1,
    1,
    0,
    'Daily evidence-only runtime binding. will_execute=0 means no retention action execution; snapshot metadata writes remain separately confirmation/readback gated.'
  )
ON DUPLICATE KEY UPDATE
  schedule_key = VALUES(schedule_key),
  runner_key = VALUES(runner_key),
  runner_command = VALUES(runner_command),
  scheduler_surface = VALUES(scheduler_surface),
  executor_policy_key = VALUES(executor_policy_key),
  notification_target = VALUES(notification_target),
  dry_run_required = VALUES(dry_run_required),
  confirmation_required = VALUES(confirmation_required),
  readback_required = VALUES(readback_required),
  will_execute = VALUES(will_execute),
  no_drop = VALUES(no_drop),
  no_delete = VALUES(no_delete),
  no_archive_execution = VALUES(no_archive_execution),
  no_compaction_execution = VALUES(no_compaction_execution),
  secrets_included = VALUES(secrets_included),
  notes = VALUES(notes),
  updated_at = UTC_TIMESTAMP();

UPDATE database_lifecycle_report_snapshot_schedules
   SET cron_expression='0 3 * * 1',
       timezone='UTC',
       report_limit=1000,
       notes='Weekly human retention review schedule. Review evidence only; no automatic retention actions.',
       updated_at=UTC_TIMESTAMP()
 WHERE schedule_key='database_lifecycle_retention_plan_weekly';

UPDATE database_lifecycle_report_snapshot_scheduler_bindings
   SET runner_command='node scripts/database-lifecycle-report-snapshot.mjs --report-type retention_plan --limit 1000 --dry-run',
       scheduler_surface='manual_review',
       will_execute=0,
       notes='Weekly human review binding only. No snapshot action, archive, delete, drop, truncate, or compaction executes automatically.',
       updated_at=UTC_TIMESTAMP()
 WHERE binding_key='database_lifecycle_retention_plan_weekly_binding';

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key,
   risk_tier, requires_preflight, requires_confirmation,
   allow_record_only, allow_apply, notes, metadata_json)
VALUES
  (
    '318_sprint69_database_lifecycle_daily_snapshot_runtime.sql',
    'authorized',
    'migration_seed',
    'governed_migration_runner_authorization_v1',
    'medium',
    1,
    1,
    1,
    1,
    'Authorize additive daily lifecycle snapshot schedule metadata and weekly review-only binding.',
    JSON_OBJECT(
      'scope','database_lifecycle_daily_snapshot_runtime',
      'daily_cron','0 3 * * *',
      'weekly_review_cron','0 3 * * 1',
      'snapshot_metadata_only',true,
      'retention_action_execution',false,
      'no_provider_call',true,
      'no_external_write',true,
      'secrets_included',false
    )
  )
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  risk_tier = VALUES(risk_tier),
  requires_preflight = VALUES(requires_preflight),
  requires_confirmation = VALUES(requires_confirmation),
  allow_record_only = VALUES(allow_record_only),
  allow_apply = VALUES(allow_apply),
  notes = VALUES(notes),
  metadata_json = VALUES(metadata_json),
  updated_at = UTC_TIMESTAMP();
