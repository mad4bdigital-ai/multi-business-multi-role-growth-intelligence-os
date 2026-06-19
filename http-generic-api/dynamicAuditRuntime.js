import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getPool } from "./db.js";
import {
  DATABASE_LIFECYCLE_DAILY_SNAPSHOT_CONFIRMATION,
  runDatabaseLifecycleDailySnapshotCycle,
} from "./databaseLifecycleDailyRuntime.js";
import { runGovernedMigrationReconciliationRuntime } from "./governedMigrationReconciliationRuntime.js";
import {
  AUDIT_BRIDGE_CONFIRMATION,
  runAuditLogEventBusBridge,
} from "./scripts/audit-log-event-bus-bridge.mjs";
import {
  AUDIT_ROLLUP_CONFIRMATION,
  runAuditEventRollupBuilder,
} from "./scripts/audit-event-rollup-builder.mjs";

const CYCLE_LOCK = "dynamic_audit.runtime_cycle.v1";
const DEFAULT_SCOPE = Object.freeze({
  scope_key: "brand:growth_intelligence_platform|tenant:00000000-0000-4000-a000-000000000010",
  tenant_id: "00000000-0000-4000-a000-000000000010",
  user_id: "f242960c-2857-4b4d-a504-ee50f8a278b4",
  brand_key: "growth_intelligence_platform",
});
const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  cadence_minutes: 5,
  batch_limit: 1000,
  source_limit: 500,
  checkpoint_batch_limit: 1000,
  checkpoint_min_events: 100,
  checkpoint_max_age_minutes: 30,
  migration_reconciliation_enabled: false,
  migration_reconciliation_apply: false,
  migration_reconciliation_limit: 2000,
  run_on_startup: true,
});

let schedulerHandle = null;
let startupHandle = null;

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function safeJson(value) {
  try { return JSON.stringify(value ?? {}); }
  catch { return JSON.stringify({ serialization_error: true, secrets_included: false }); }
}

function boundedText(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema=DATABASE() AND table_name=?`,
    [tableName]
  );
  return Number(rows?.[0]?.count || 0) > 0;
}

async function loadRuntimeConfig(connection) {
  const keys = [
    "dynamic_audit_scheduler",
    "dynamic_audit_checkpoint_scope",
    "audit_log_event_bus_bridge_schedule",
    "audit_event_rollup_builder_schedule",
    "governed_migration_reconciliation_scheduler",
  ];
  const [rows] = await connection.query(
    `SELECT config_key,config_json,status,note,updated_at
       FROM platform_runtime_config
      WHERE config_key IN (?)`,
    [keys]
  );
  const byKey = new Map(rows.map((row) => [row.config_key, row]));
  const schedulerRow = byKey.get("dynamic_audit_scheduler");
  const bridgeRow = byKey.get("audit_log_event_bus_bridge_schedule");
  const rollupRow = byKey.get("audit_event_rollup_builder_schedule");
  const schedulerConfig = safeJsonParse(schedulerRow?.config_json, {});
  return {
    ...DEFAULT_CONFIG,
    ...safeJsonParse(bridgeRow?.config_json, {}),
    ...safeJsonParse(rollupRow?.config_json, {}),
    ...schedulerConfig,
    enabled:
      schedulerRow?.status !== "disabled" &&
      schedulerConfig.enabled !== false &&
      bridgeRow?.status !== "disabled" &&
      rollupRow?.status !== "disabled",
    scope: {
      ...DEFAULT_SCOPE,
      ...safeJsonParse(byKey.get("dynamic_audit_checkpoint_scope")?.config_json, {}),
    },
  };
}

async function currentCommitSha() {
  const candidates = [
    process.env.DEPLOYMENT_COMMIT_SHA,
    process.env.GIT_COMMIT_SHA,
    process.env.COMMIT_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
  ];
  for (const candidate of candidates) {
    if (/^[0-9a-f]{40}$/i.test(String(candidate || ""))) return String(candidate).toLowerCase();
  }
  try {
    const manifest = safeJsonParse(
      await readFile(new URL("./deployment-manifest.json", import.meta.url), "utf8"),
      {}
    );
    for (const key of ["commit_sha", "commitSha", "git_commit_sha", "head_sha"]) {
      if (/^[0-9a-f]{40}$/i.test(String(manifest[key] || ""))) return String(manifest[key]).toLowerCase();
    }
  } catch {
    // Runtime provenance remains unknown when no manifest exists.
  }
  return null;
}

function parseRepoResource(resourceId = "") {
  const raw = String(resourceId || "");
  const separator = raw.indexOf(":");
  if (separator < 1) return null;
  const repoRef = raw.slice(0, separator);
  const filePath = raw.slice(separator + 1);
  const slash = repoRef.indexOf("/");
  if (slash < 1 || !filePath) return null;
  return {
    owner: repoRef.slice(0, slash),
    repo: repoRef.slice(slash + 1),
    file_path: filePath.slice(0, 768),
  };
}

async function produceDriveEvents(connection, limit) {
  let eventBusInserted = 0;
  let assetInserted = 0;
  const sources = [
    {
      source: "offsite_drive_upload_records",
      query: `SELECT record_id AS source_id,drive_file_id AS asset_id,file_name AS asset_path,
                     status,sha256,size_bytes,created_at
                FROM offsite_drive_upload_records r
               WHERE r.drive_file_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM asset_audit_events a
                    WHERE a.source_event_key COLLATE utf8mb4_unicode_ci =
                          CONCAT('google_drive.offsite:',r.record_id) COLLATE utf8mb4_unicode_ci
                 )
               ORDER BY r.created_at ASC
               LIMIT ?`,
      eventPrefix: "google_drive.offsite",
      eventType: "google_drive.offsite_upload",
      resourceKind: "drive_file",
      verified: (row) => row.status === "verified",
    },
    {
      source: "session_drive_artifacts",
      query: `SELECT artifact_id AS source_id,drive_file_id AS asset_id,
                     drive_file_name AS asset_path,'verified' AS status,
                     sha256,byte_size AS size_bytes,created_at
                FROM session_drive_artifacts r
               WHERE r.drive_file_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM asset_audit_events a
                    WHERE a.source_event_key COLLATE utf8mb4_unicode_ci =
                          CONCAT('google_drive.session_artifact:',r.artifact_id)
                          COLLATE utf8mb4_unicode_ci
                 )
               ORDER BY r.created_at ASC
               LIMIT ?`,
      eventPrefix: "google_drive.session_artifact",
      eventType: "google_drive.session_artifact_written",
      resourceKind: "drive_file",
      verified: () => true,
    },
    {
      source: "workspace_assets",
      query: `SELECT asset_id AS source_id,asset_ref AS asset_id,
                     display_name AS asset_path,lifecycle_status AS status,
                     NULL AS sha256,NULL AS size_bytes,created_at
                FROM workspace_assets r
               WHERE r.asset_type IN ('drive_file','drive_folder','drive_shortcut','doc','sheet')
                 AND r.asset_ref IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM asset_audit_events a
                    WHERE a.source_event_key COLLATE utf8mb4_unicode_ci =
                          CONCAT('google_drive.workspace_asset:',r.asset_id)
                          COLLATE utf8mb4_unicode_ci
                 )
               ORDER BY r.created_at ASC
               LIMIT ?`,
      eventPrefix: "google_drive.workspace_asset",
      eventType: "google_drive.workspace_asset_registered",
      resourceKind: "drive_asset",
      verified: (row) => ["approved", "published", "active"].includes(String(row.status || "")),
    },
  ];

  for (const source of sources) {
    if (!(await tableExists(connection, source.source))) continue;
    const [rows] = await connection.query(source.query, [limit]);
    for (const row of rows) {
      const eventKey = `${source.eventPrefix}:${row.source_id}`;
      const readbackVerified = source.verified(row);
      const evidence = {
        source: source.source,
        source_id: row.source_id,
        asset_id_present: Boolean(row.asset_id),
        sha256_present: Boolean(row.sha256),
        size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
        readback_verified: readbackVerified,
        raw_payload_stored: false,
        secrets_included: false,
      };
      const [eventResult] = await connection.query(
        `INSERT IGNORE INTO platform_audit_event_bus
          (event_key,source_family,source_key,event_type,resource_kind,resource_key,
           event_status,evidence_json,notes,created_at,updated_at)
         VALUES (?,'google_drive',?,?,?,?, 'rolled_up',?,
                 'Drive evidence mirrored from SQL-primary platform records.',
                 COALESCE(?,UTC_TIMESTAMP()),UTC_TIMESTAMP())`,
        [eventKey, String(row.source_id).slice(0, 191), source.eventType, source.resourceKind,
          String(row.asset_id || row.source_id).slice(0, 255), safeJson(evidence), row.created_at || null]
      );
      eventBusInserted += Number(eventResult?.affectedRows || 0);
      const [assetResult] = await connection.query(
        `INSERT INTO asset_audit_events
          (provider_key,asset_id,asset_path,source_event_key,event_type,
           change_status,evidence_json,created_at)
         SELECT 'google_drive',?,?,?,?,?,?,COALESCE(?,UTC_TIMESTAMP())
          WHERE NOT EXISTS (
            SELECT 1 FROM asset_audit_events
             WHERE source_event_key COLLATE utf8mb4_unicode_ci =
                   ? COLLATE utf8mb4_unicode_ci
          )`,
        [String(row.asset_id || row.source_id).slice(0, 255),
          String(row.asset_path || row.asset_id || row.source_id).slice(0, 768),
          eventKey, source.eventType, readbackVerified ? "readback_verified" : "observed",
          safeJson(evidence), row.created_at || null, eventKey]
      );
      assetInserted += Number(assetResult?.affectedRows || 0);
    }
  }
  return { event_bus_inserted: eventBusInserted, asset_inserted: assetInserted };
}

async function produceReleaseReadinessEvent(connection) {
  if (!(await tableExists(connection, "release_readiness_log"))) return { inserted: 0, reason: "release_readiness_log_missing" };
  const [rows] = await connection.query(
    `SELECT run_id,MAX(checked_at) AS checked_at,
            SUM(status='pass') AS pass_count,SUM(status='warn') AS warn_count,
            SUM(status='fail') AS fail_count,SUM(status='skip') AS skip_count
       FROM release_readiness_log
      GROUP BY run_id
      ORDER BY checked_at DESC
      LIMIT 1`
  );
  const row = rows?.[0];
  if (!row?.run_id) return { inserted: 0, reason: "no_release_readiness_run" };
  const status = Number(row.fail_count || 0) > 0 ? "fail" : Number(row.warn_count || 0) > 0 ? "warn" : "pass";
  const eventKey = `release_readiness:${row.run_id}`;
  const [result] = await connection.query(
    `INSERT IGNORE INTO platform_audit_event_bus
      (event_key,source_family,source_key,event_type,resource_kind,resource_key,
       event_status,evidence_json,notes,created_at,updated_at)
     VALUES (?,'release_readiness',?,'release_readiness.completed',
             'release_readiness_run',?,'pending_rollup',?,
             'Summary-only release readiness evidence.',
             COALESCE(?,UTC_TIMESTAMP()),UTC_TIMESTAMP())`,
    [eventKey, row.run_id, row.run_id,
      safeJson({ run_id: row.run_id, status, pass_count: Number(row.pass_count || 0),
        warn_count: Number(row.warn_count || 0), fail_count: Number(row.fail_count || 0),
        skip_count: Number(row.skip_count || 0), raw_payload_stored: false, secrets_included: false }),
      row.checked_at || null]
  );
  return { inserted: Number(result?.affectedRows || 0), run_id: row.run_id, status };
}

async function produceRepoFileAudit(connection, commitSha, limit) {
  if (!commitSha) return { run_inserted: 0, findings_inserted: 0, reason: "commit_sha_unknown" };
  const runId = `repo-main-${commitSha}`.slice(0, 64);
  const [existing] = await connection.query("SELECT run_id FROM repo_file_audit_runs WHERE run_id=? LIMIT 1", [runId]);
  if (existing.length) return { run_inserted: 0, findings_inserted: 0, run_id: runId, reason: "run_exists" };

  const [rows] = await connection.query(
    `SELECT resource_id,MAX(occurred_at) AS last_observed_at,COUNT(*) AS observation_count
       FROM audit_log
      WHERE action='repo_patch_apply' AND resource_type='repo'
        AND occurred_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY
      GROUP BY resource_id
      ORDER BY last_observed_at DESC
      LIMIT ?`,
    [limit]
  );
  const files = rows.map((row) => ({
    ...parseRepoResource(row.resource_id),
    last_observed_at: row.last_observed_at,
    observation_count: Number(row.observation_count || 0),
  })).filter((row) => row?.file_path);

  const repoOwner = files[0]?.owner || "mad4bdigital-ai";
  const repoName = files[0]?.repo || "multi-business-multi-role-growth-intelligence-os";
  await connection.query(
    `INSERT INTO repo_file_audit_runs
      (run_id,repo_owner,repo_name,branch_name,commit_sha,audit_scope,
       source_event_key,run_status,summary_json,evidence_json,
       started_at,completed_at,created_at,updated_at)
     VALUES (?,?,?,?,?,'repo_current_main',?,'completed',?,?,UTC_TIMESTAMP(),
             UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
    [runId, repoOwner, repoName, "main", commitSha, `repo_file_audit:${runId}`,
      safeJson({ changed_file_observation_count: files.length,
        audit_depth: "changed_files_from_governed_patch_evidence",
        full_repo_exhaustive: false, secrets_included: false }),
      safeJson({ source: "audit_log.repo_patch_apply", commit_sha: commitSha,
        raw_patch_content_stored: false, secrets_included: false })]
  );

  let findingsInserted = 0;
  for (const file of files) {
    const [result] = await connection.query(
      `INSERT INTO repo_file_audit_findings
        (run_id,file_path,file_status,finding_type,risk_level,next_action,
         evidence_json,created_at)
       VALUES (?,?,'manual_review','changed_file_observed','low',
               'CI and targeted file audit evidence remain authoritative for completion.',
               ?,UTC_TIMESTAMP())`,
      [runId, file.file_path, safeJson({ last_observed_at: file.last_observed_at,
        observation_count: file.observation_count, source: "repo_patch_apply",
        raw_file_content_stored: false, secrets_included: false })]
    );
    findingsInserted += Number(result?.affectedRows || 0);
  }

  await connection.query(
    `INSERT IGNORE INTO platform_audit_event_bus
      (event_key,source_family,source_key,event_type,resource_kind,resource_key,
       event_status,evidence_json,notes,created_at,updated_at)
     VALUES (?,'repo_file_audit',?,'repo_file_audit.completed','repo',?,
             'rolled_up',?,'Changed-file audit inventory persisted.',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
    [`repo_file_audit:${runId}`, runId, `${repoOwner}/${repoName}`,
      safeJson({ run_id: runId, commit_sha: commitSha, findings_count: findingsInserted,
        audit_depth: "changed_files_from_governed_patch_evidence", exhaustive: false,
        secrets_included: false })]
  );
  return { run_inserted: 1, findings_inserted: findingsInserted, run_id: runId };
}

async function readDynamicReadiness(connection) {
  const [rows] = await connection.query(
    `SELECT
       COALESCE((SELECT MAX(id) FROM audit_log),0) AS audit_log_max_id,
       COALESCE((
         SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.last_audit_log_id')) AS UNSIGNED)
           FROM platform_runtime_config
          WHERE config_key='audit_log_event_bus_bridge_schedule'
          LIMIT 1
       ),0) AS audit_log_cursor_id,
       (SELECT COUNT(*) FROM platform_audit_event_bus
         WHERE event_status IN ('observed','pending_rollup')) AS event_bus_unrolled_total,
       (SELECT COUNT(*) FROM repo_file_audit_runs
         WHERE run_status='completed') AS repo_file_audit_run_total,
       (SELECT COUNT(*) FROM asset_audit_events
         WHERE provider_key='google_drive') AS drive_asset_event_total,
       (SELECT COUNT(*) FROM checkpoint_auto_rollups
         WHERE rollup_status='planned') AS checkpoint_rollup_planned_total,
       (SELECT COUNT(*) FROM checkpoint_auto_rollups
         WHERE rollup_status='written') AS checkpoint_rollup_written_total,
       (SELECT COUNT(*) FROM db_change_audit_events) AS db_change_rollup_total,
       (SELECT COUNT(*) FROM db_change_audit_events
         WHERE mutation_class='unknown'
            OR table_name IN ('db','unresolved_admin_control_db')) AS db_change_semantics_unknown_total,
       (SELECT MAX(completed_at) FROM dynamic_audit_scheduler_runs
         WHERE run_status='succeeded') AS scheduler_last_success_at`
  );
  const row = rows?.[0] || {};
  const auditGap = Math.max(
    0,
    Number(row.audit_log_max_id || 0) - Number(row.audit_log_cursor_id || 0)
  );
  const schedulerLastSuccess = row.scheduler_last_success_at
    ? new Date(row.scheduler_last_success_at).getTime()
    : 0;
  const schedulerStale = !schedulerLastSuccess || Date.now() - schedulerLastSuccess > 15 * 60_000;
  let readinessStatus = "pass";
  let readinessReason = "runtime_fast_ready";
  if (auditGap > 1000) {
    readinessStatus = "warn";
    readinessReason = "audit_log_to_event_bus_gap_high";
  } else if (Number(row.event_bus_unrolled_total || 0) > 5000) {
    readinessStatus = "warn";
    readinessReason = "event_bus_rollup_lag_high";
  } else if (Number(row.repo_file_audit_run_total || 0) === 0) {
    readinessStatus = "warn";
    readinessReason = "repo_file_audit_missing";
  } else if (Number(row.drive_asset_event_total || 0) === 0) {
    readinessStatus = "warn";
    readinessReason = "google_drive_audit_missing";
  } else if (
    Number(row.db_change_rollup_total || 0) > 0 &&
    Number(row.db_change_semantics_unknown_total || 0) * 2 > Number(row.db_change_rollup_total || 0)
  ) {
    readinessStatus = "warn";
    readinessReason = "db_change_semantics_incomplete";
  } else if (schedulerStale) {
    readinessStatus = "warn";
    readinessReason = "scheduler_success_pending_or_stale";
  }
  return {
    readiness_key: "dynamic_audit_runtime_fast",
    readiness_status: readinessStatus,
    readiness_reason: readinessReason,
    ...row,
    audit_log_to_event_bus_gap: auditGap,
    full_quality_scan_deferred: true,
    raw_payload_stored: false,
    secrets_included: false,
  };
}

async function writeCheckpoint(connection, config, commitSha) {
  const [rows] = await connection.query(
    `SELECT rollup_id,source_event_key,trigger_family,created_at
       FROM checkpoint_auto_rollups
      WHERE rollup_status='planned'
      ORDER BY rollup_id ASC
      LIMIT ?`,
    [Math.max(1, Math.min(Number(config.checkpoint_batch_limit || 1000), 5000))]
  );
  if (!rows.length) return { written: 0, reason: "no_planned_rollups" };

  const minEvents = Math.max(1, Number(config.checkpoint_min_events || 100));
  const maxAgeMinutes = Math.max(1, Number(config.checkpoint_max_age_minutes || 30));
  const oldestAt = new Date(rows[0].created_at).getTime();
  const oldEnough = Number.isFinite(oldestAt) && Date.now() - oldestAt >= maxAgeMinutes * 60_000;
  if (rows.length < minEvents && !oldEnough) return { written: 0, planned_count: rows.length, reason: "checkpoint_threshold_not_met" };

  const scope = config.scope || DEFAULT_SCOPE;
  const checkpointId = randomUUID();
  const readiness = await readDynamicReadiness(connection);
  const triggerCounts = rows.reduce((accumulator, row) => {
    const key = String(row.trigger_family || "unknown");
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const [releaseRows] = await connection.query(
    `SELECT run_id,
            CASE WHEN SUM(status='fail')>0 THEN 'fail'
                 WHEN SUM(status='warn')>0 THEN 'warn' ELSE 'pass' END AS status,
            MAX(checked_at) AS checked_at
       FROM release_readiness_log
      GROUP BY run_id
      ORDER BY checked_at DESC
      LIMIT 1`
  );
  const release = releaseRows?.[0] || null;

  await connection.beginTransaction();
  try {
    await connection.query(
      `INSERT INTO platform_evolution_checkpoints
        (checkpoint_id,scope_key,tenant_id,user_id,brand_key,checkpoint_type,
         activation_session_id,main_commit_sha,deployed_commit_sha,
         activation_status,release_readiness_status,summary_text,
         thread_snapshot_json,delta_json,evidence_json,next_actions_json,
         created_by,created_at)
       VALUES (?,?,?,?,?,'rollup',NULL,?,NULL,NULL,?,
               ?,?,?,?,?,'dynamic_audit_scheduler',UTC_TIMESTAMP())`,
      [checkpointId, scope.scope_key || DEFAULT_SCOPE.scope_key,
        scope.tenant_id || DEFAULT_SCOPE.tenant_id,
        scope.user_id || DEFAULT_SCOPE.user_id,
        scope.brand_key || DEFAULT_SCOPE.brand_key,
        commitSha, release?.status || readiness?.readiness_status || "unknown",
        `Dynamic audit rollup checkpoint for ${rows.length} planned events.`,
        safeJson({ trigger_counts: triggerCounts }),
        safeJson({ rolled_up_event_count: rows.length, commit_sha_known: Boolean(commitSha),
          deployed_commit_sha_intentionally_unset: true }),
        safeJson({ dynamic_audit_readiness: readiness, latest_release_readiness: release,
          source_event_sample: rows.slice(0, 25).map((row) => row.source_event_key),
          raw_payload_stored: false, secrets_included: false }),
        safeJson(["Keep the internal scheduler healthy.",
          "Resolve remaining repo, Drive readback, DB semantic, and deployment parity gaps."])]
    );
    await connection.query(
      `UPDATE checkpoint_auto_rollups
          SET checkpoint_id=?,commit_sha=?,rollup_status='written',updated_at=UTC_TIMESTAMP()
        WHERE rollup_id IN (?) AND rollup_status='planned'`,
      [checkpointId, commitSha, rows.map((row) => row.rollup_id)]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  return { written: rows.length, checkpoint_id: checkpointId };
}

async function recordSchedulerStart(connection, runId, mode) {
  if (!(await tableExists(connection, "dynamic_audit_scheduler_runs"))) return false;
  await connection.query(
    `INSERT INTO dynamic_audit_scheduler_runs
      (run_id,mode,run_status,started_at,secrets_included)
     VALUES (?,?,'running',UTC_TIMESTAMP(),0)`,
    [runId, mode]
  );
  return true;
}

async function recordSchedulerFinish(connection, runId, status, result, error = null) {
  if (!(await tableExists(connection, "dynamic_audit_scheduler_runs"))) return;
  await connection.query(
    `UPDATE dynamic_audit_scheduler_runs
        SET run_status=?,stage_summary_json=?,error_code=?,error_message=?,
            completed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
      WHERE run_id=?`,
    [status, safeJson(result), error?.code || null,
      boundedText(error?.message || "", 1000) || null, runId]
  );
}

export async function runDynamicAuditCycle(options = {}, dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const connection = await pool.getConnection();
  const runId = randomUUID();
  let lockAcquired = false;
  let runRecorded = false;
  let result = null;
  try {
    const config = { ...(await loadRuntimeConfig(connection)), ...options };
    if (config.enabled === false && options.force !== true) {
      return {
        ok: true,
        run_id: runId,
        skipped: true,
        reason: "runtime_config_disabled",
        secrets_included: false,
      };
    }
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [CYCLE_LOCK]);
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) return { ok: true, run_id: runId, skipped: true, reason: "cycle_lock_busy", secrets_included: false };

    runRecorded = await recordSchedulerStart(connection, runId, options.mode || "scheduled");
    const commitSha = await currentCommitSha();
    const bridge = await runAuditLogEventBusBridge(
      { apply: true, confirm: AUDIT_BRIDGE_CONFIRMATION, limit: config.batch_limit },
      { pool }
    );
    const drive = await produceDriveEvents(connection, config.source_limit);
    const release = await produceReleaseReadinessEvent(connection);
    const repo = await produceRepoFileAudit(connection, commitSha, config.source_limit);
    const rollup = await runAuditEventRollupBuilder(
      { apply: true, confirm: AUDIT_ROLLUP_CONFIRMATION, limit: config.batch_limit },
      { pool }
    );
    const checkpoint = await writeCheckpoint(connection, config, commitSha);
    const lifecycleSnapshot = await runDatabaseLifecycleDailySnapshotCycle({
      actor_id: "dynamic_audit_scheduler",
      apply: true,
      confirm: DATABASE_LIFECYCLE_DAILY_SNAPSHOT_CONFIRMATION,
      notes: "Internal runtime daily lifecycle evidence snapshot only.",
      trace_id: runId,
    }, { pool });
    const readiness = await readDynamicReadiness(connection);
    result = {
      ok: Boolean(bridge.ok && rollup.ok && lifecycleSnapshot.ok),
      run_id: runId,
      mode: options.mode || "scheduled",
      commit_sha: commitSha,
      stages: { bridge, drive, release, repo, rollup, checkpoint, lifecycle_snapshot: lifecycleSnapshot },
      readiness,
      raw_payload_stored: false,
      secrets_included: false,
    };
    if (runRecorded) await recordSchedulerFinish(connection, runId, result.ok ? "succeeded" : "failed", result);
    return result;
  } catch (error) {
    result = {
      ok: false,
      run_id: runId,
      mode: options.mode || "scheduled",
      error: { code: error.code || "dynamic_audit_cycle_failed", message: boundedText(error.message, 1000) },
      secrets_included: false,
    };
    if (runRecorded) await recordSchedulerFinish(connection, runId, "failed", result, error).catch(() => {});
    throw Object.assign(error, { dynamic_audit_result: result });
  } finally {
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?) AS released", [CYCLE_LOCK]).catch(() => {});
    connection.release();
  }
}

export async function startDynamicAuditScheduler(options = {}) {
  if (process.env.NODE_ENV === "test" || schedulerHandle || startupHandle) {
    return { started: false, reason: "disabled_or_already_started", secrets_included: false };
  }
  const pool = options.pool || getPool();
  const connection = await pool.getConnection();
  let config;
  try { config = await loadRuntimeConfig(connection); }
  finally { connection.release(); }
  if (!config.enabled) return { started: false, reason: "runtime_config_disabled", secrets_included: false };

  const cadenceMs = Math.max(1, Number(config.cadence_minutes || 5)) * 60_000;
  const run = async (mode) => {
    try {
      const cycle = await runDynamicAuditCycle({ ...config, mode }, { pool });
      console.log(JSON.stringify({
        event: "dynamic_audit_cycle_completed",
        run_id: cycle.run_id,
        ok: cycle.ok,
        skipped: cycle.skipped === true,
        readiness_status: cycle.readiness?.readiness_status || null,
        secrets_included: false,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "dynamic_audit_cycle_failed",
        code: error.code || "dynamic_audit_cycle_failed",
        message: boundedText(error.message, 500),
        secrets_included: false,
      }));
    }
  };

  if (config.run_on_startup !== false) {
    startupHandle = setTimeout(() => {
      startupHandle = null;
      run("startup");
    }, Math.max(1_000, Number(options.startup_delay_ms || 10_000)));
    startupHandle.unref?.();
  }
  schedulerHandle = setInterval(() => run("scheduled"), cadenceMs);
  schedulerHandle.unref?.();
  return {
    started: true,
    cadence_minutes: cadenceMs / 60_000,
    scheduler_mode: "internal_runtime_interval_with_mysql_advisory_lock",
    secrets_included: false,
  };
}

export function stopDynamicAuditScheduler() {
  if (startupHandle) clearTimeout(startupHandle);
  if (schedulerHandle) clearInterval(schedulerHandle);
  startupHandle = null;
  schedulerHandle = null;
}
