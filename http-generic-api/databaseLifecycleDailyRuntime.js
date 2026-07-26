import { getPool } from "./db.js";
import {
  DATABASE_LIFECYCLE_DAILY_SNAPSHOT_BINDING_KEY,
  DATABASE_LIFECYCLE_DAILY_SNAPSHOT_SCHEDULE_KEY,
  DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION,
  runDatabaseLifecycleSchedulerSnapshot,
} from "./databaseTableLifecycle.js";

export const DATABASE_LIFECYCLE_DAILY_SNAPSHOT_CONFIRMATION = "APPLY_DATABASE_LIFECYCLE_DAILY_SNAPSHOT_TICK";
const DAILY_SNAPSHOT_LOCK = "database_lifecycle.daily_snapshot.v1";

function text(value = "") {
  return String(value || "").trim();
}

function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

export function parseDatabaseLifecycleDailyCron(cronExpression = "0 3 * * *", timezone = "UTC") {
  if (text(timezone).toUpperCase() !== "UTC") return null;
  const parts = text(cronExpression).split(/\s+/).filter(Boolean);
  if (parts.length !== 5 || parts[2] !== "*" || parts[3] !== "*" || parts[4] !== "*") return null;
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { minute, hour, timezone: "UTC" };
}

export function databaseLifecycleDailyWindowStart({
  now = new Date(),
  cron_expression = "0 3 * * *",
  timezone = "UTC",
} = {}) {
  const current = parseDate(now);
  const cron = parseDatabaseLifecycleDailyCron(cron_expression, timezone);
  if (!current || !cron) return null;
  const scheduled = new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
    cron.hour,
    cron.minute,
    0,
    0,
  ));
  if (current.getTime() < scheduled.getTime()) scheduled.setUTCDate(scheduled.getUTCDate() - 1);
  return scheduled;
}

export function isDatabaseLifecycleDailySnapshotDue({
  now = new Date(),
  last_readiness_at = null,
  cron_expression = "0 3 * * *",
  timezone = "UTC",
} = {}) {
  const windowStart = databaseLifecycleDailyWindowStart({ now, cron_expression, timezone });
  if (!windowStart) {
    return { due: false, reason: "unsupported_daily_schedule", window_start: null };
  }
  const lastReadiness = parseDate(last_readiness_at);
  const due = !lastReadiness || lastReadiness.getTime() < windowStart.getTime();
  return {
    due,
    reason: due ? "daily_window_due" : "daily_window_already_completed",
    window_start: windowStart.toISOString(),
    last_readiness_at: lastReadiness?.toISOString() || null,
  };
}

export async function runDatabaseLifecycleDailySnapshotCycle(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?,0) AS acquired", [DAILY_SNAPSHOT_LOCK]);
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      return { ok: true, skipped: true, reason: "daily_snapshot_lock_busy", secrets_included: false };
    }

    const [rows] = await connection.query(
      `SELECT schedule_key,cron_expression,timezone,report_limit,approval_status,status,
              last_readiness_at,last_snapshot_id
         FROM database_lifecycle_report_snapshot_schedules
        WHERE schedule_key=?
        LIMIT 1`,
      [DATABASE_LIFECYCLE_DAILY_SNAPSHOT_SCHEDULE_KEY]
    );
    const schedule = rows?.[0] || null;
    if (!schedule) {
      return { ok: true, skipped: true, reason: "daily_snapshot_schedule_missing", secrets_included: false };
    }
    if (schedule.status !== "active" || schedule.approval_status !== "approved") {
      return {
        ok: true,
        skipped: true,
        reason: "daily_snapshot_schedule_not_approved_active",
        schedule_status: schedule.status,
        approval_status: schedule.approval_status,
        secrets_included: false,
      };
    }

    const due = isDatabaseLifecycleDailySnapshotDue({
      now: input.now || new Date(),
      last_readiness_at: schedule.last_readiness_at,
      cron_expression: schedule.cron_expression,
      timezone: schedule.timezone,
    });
    if (!due.due) {
      return {
        ok: true,
        skipped: true,
        reason: due.reason,
        schedule_key: schedule.schedule_key,
        last_snapshot_id: schedule.last_snapshot_id || null,
        ...due,
        secrets_included: false,
      };
    }

    if (input.apply !== true) {
      return {
        ok: true,
        mode: "dry_run",
        due: true,
        will_write: false,
        schedule_key: schedule.schedule_key,
        binding_key: DATABASE_LIFECYCLE_DAILY_SNAPSHOT_BINDING_KEY,
        ...due,
        secrets_included: false,
      };
    }
    if (text(input.confirm) !== DATABASE_LIFECYCLE_DAILY_SNAPSHOT_CONFIRMATION) {
      const error = new Error(`Apply requires --confirm=${DATABASE_LIFECYCLE_DAILY_SNAPSHOT_CONFIRMATION}`);
      error.code = "DATABASE_LIFECYCLE_DAILY_SNAPSHOT_CONFIRMATION_REQUIRED";
      throw error;
    }

    const snapshot = await runDatabaseLifecycleSchedulerSnapshot({
      actor_id: text(input.actor_id || input.actorId) || "database_lifecycle_daily_runtime",
      apply: true,
      binding_key: DATABASE_LIFECYCLE_DAILY_SNAPSHOT_BINDING_KEY,
      confirm: DATABASE_LIFECYCLE_REPORT_SNAPSHOT_CONFIRMATION,
      limit: Number(schedule.report_limit || 1000),
      notes: text(input.notes) || `daily_window:${due.window_start}`,
      schedule_key: DATABASE_LIFECYCLE_DAILY_SNAPSHOT_SCHEDULE_KEY,
      summary_only: true,
      tenant_id: text(input.tenant_id || input.tenantId),
      trace_id: text(input.trace_id || input.traceId),
    }, { pool });
    return {
      ok: snapshot.ok === true,
      mode: "apply",
      due: true,
      schedule_key: schedule.schedule_key,
      binding_key: DATABASE_LIFECYCLE_DAILY_SNAPSHOT_BINDING_KEY,
      window_start: due.window_start,
      snapshot,
      no_drop: true,
      no_delete: true,
      no_archive_execution: true,
      no_compaction_execution: true,
      secrets_included: false,
    };
  } finally {
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?) AS released", [DAILY_SNAPSHOT_LOCK]).catch(() => {});
    connection.release();
  }
}
