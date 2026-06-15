#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";

export const AUDIT_ROLLUP_CONFIRMATION = "APPLY_AUDIT_EVENT_ROLLUP_BUILDER";
const LOCK_NAME = "dynamic_audit.audit_event_rollup_builder.v1";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { apply: false, confirm: "", limit: 500 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item === "--apply") args.apply = true;
    else if (item.startsWith("--confirm")) {
      args.confirm = String(value || "");
      if (consume) i += 1;
    } else if (item.startsWith("--limit")) {
      args.limit = Math.max(1, Math.min(Number(value || 500), 5000));
      if (consume) i += 1;
    } else {
      throw new Error(`Unsupported argument: ${item}`);
    }
  }
  return args;
}

function parseJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function eventClass(row) {
  const eventType = String(row.event_type || "");
  const sourceFamily = String(row.source_family || "");
  const resourceKind = String(row.resource_kind || "");

  if (
    eventType === "admin_control.db" ||
    sourceFamily === "governed_migration_reconciliation" ||
    resourceKind === "database_migration" ||
    sourceFamily === "governed_migration_runner"
  ) {
    return "db_change";
  }

  if (
    eventType === "repo_patch_apply" ||
    resourceKind === "repo" ||
    sourceFamily === "repo_file_audit" ||
    sourceFamily === "google_drive" ||
    resourceKind.startsWith("drive_")
  ) {
    return "asset_change";
  }

  // Provider diagnostics and GitHub REST fallback observations are operational
  // evidence. They are not asset mutations and must not inflate asset audit.
  return "checkpoint_candidate";
}

function resolveDbSemantics(row) {
  const evidence = parseJson(row.evidence_json);
  if (
    row.source_family === "governed_migration_reconciliation" ||
    row.resource_kind === "database_migration"
  ) {
    return {
      tableName: String(evidence.table_name || "governed_migration_reconciliation").slice(0, 191),
      mutationClass: "schema",
    };
  }
  const tableName = String(evidence.table_name || evidence.db_table_name || "").trim();
  const mutation = String(evidence.mutation_class || "").trim();
  const allowed = new Set(["schema", "insert", "update", "delete", "bulk", "unknown"]);
  return {
    tableName: (tableName || "unresolved_admin_control_db").slice(0, 191),
    mutationClass: allowed.has(mutation) ? mutation : "unknown",
  };
}

function providerKey(row) {
  const sourceFamily = String(row.source_family || "");
  const resourceKind = String(row.resource_kind || "");
  if (sourceFamily === "google_drive" || resourceKind.startsWith("drive_")) return "google_drive";
  if (row.event_type === "repo_patch_apply" || resourceKind === "repo" || sourceFamily === "repo_file_audit") {
    return "github";
  }
  return "platform";
}

function safeJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({ serialization_error: true, secrets_included: false });
  }
}

async function loadRows(connection, limit) {
  const [rows] = await connection.query(
    `SELECT event_id,event_key,source_family,event_type,resource_kind,resource_key,
            event_status,evidence_json,created_at
       FROM platform_audit_event_bus e
      WHERE e.event_status IN ('observed','pending_rollup')
        AND NOT EXISTS (
          SELECT 1 FROM db_change_audit_events d
           WHERE d.source_event_key COLLATE utf8mb4_unicode_ci =
                 e.event_key COLLATE utf8mb4_unicode_ci
        )
        AND NOT EXISTS (
          SELECT 1 FROM asset_audit_events a
           WHERE a.source_event_key COLLATE utf8mb4_unicode_ci =
                 e.event_key COLLATE utf8mb4_unicode_ci
        )
        AND NOT EXISTS (
          SELECT 1 FROM checkpoint_auto_rollups c
           WHERE c.source_event_key COLLATE utf8mb4_unicode_ci =
                 e.event_key COLLATE utf8mb4_unicode_ci
        )
      ORDER BY e.event_id ASC
      LIMIT ?`,
    [limit]
  );
  return rows;
}

async function insertRollups(connection, rows) {
  let dbInserted = 0;
  let assetInserted = 0;
  let checkpointInserted = 0;
  const processedEventIds = [];

  for (const row of rows) {
    const classification = eventClass(row);
    const sourceEvidence = parseJson(row.evidence_json);
    const evidence = {
      source: "audit_event_rollup_builder",
      source_event_key: row.event_key,
      source_family: row.source_family,
      event_type: row.event_type,
      resource_kind: row.resource_kind || null,
      resource_key_present: Boolean(row.resource_key),
      readback_verified: sourceEvidence.readback_verified === true,
      raw_payload_stored: false,
      raw_before_after_stored: false,
      secrets_included: false,
    };

    if (classification === "db_change") {
      const semantics = resolveDbSemantics(row);
      const [result] = await connection.query(
        `INSERT INTO db_change_audit_events
          (source_family,database_name,table_name,mutation_class,governed,
           source_event_key,evidence_json,created_at)
         SELECT ?,DATABASE(),?,?,1,?,?,UTC_TIMESTAMP()
          WHERE NOT EXISTS (
            SELECT 1 FROM db_change_audit_events
             WHERE source_event_key COLLATE utf8mb4_unicode_ci =
                   ? COLLATE utf8mb4_unicode_ci
          )`,
        [
          row.source_family,
          semantics.tableName,
          semantics.mutationClass,
          row.event_key,
          safeJson({ ...evidence, semantic_resolution: semantics }),
          row.event_key,
        ]
      );
      dbInserted += Number(result?.affectedRows || 0);
    } else if (classification === "asset_change") {
      const provider = providerKey(row);
      const status = evidence.readback_verified ? "readback_verified" : "observed";
      const [result] = await connection.query(
        `INSERT INTO asset_audit_events
          (provider_key,asset_id,asset_path,source_event_key,event_type,
           change_status,evidence_json,created_at)
         SELECT ?,?,?,?,?,?,?,UTC_TIMESTAMP()
          WHERE NOT EXISTS (
            SELECT 1 FROM asset_audit_events
             WHERE source_event_key COLLATE utf8mb4_unicode_ci =
                   ? COLLATE utf8mb4_unicode_ci
          )`,
        [
          provider,
          row.resource_key || null,
          row.resource_key || null,
          row.event_key,
          String(row.event_type || "audit_event").slice(0, 80),
          status,
          safeJson(evidence),
          row.event_key,
        ]
      );
      assetInserted += Number(result?.affectedRows || 0);
    } else {
      const [result] = await connection.query(
        `INSERT INTO checkpoint_auto_rollups
          (source_event_key,checkpoint_id,trigger_family,commit_sha,
           rollup_status,evidence_json,created_at,updated_at)
         SELECT ?,NULL,?,NULL,'planned',?,UTC_TIMESTAMP(),UTC_TIMESTAMP()
          WHERE NOT EXISTS (
            SELECT 1 FROM checkpoint_auto_rollups
             WHERE source_event_key COLLATE utf8mb4_unicode_ci =
                   ? COLLATE utf8mb4_unicode_ci
          )`,
        [
          row.event_key,
          String(row.event_type || "audit_event").slice(0, 80),
          safeJson(evidence),
          row.event_key,
        ]
      );
      checkpointInserted += Number(result?.affectedRows || 0);
    }

    processedEventIds.push(Number(row.event_id));
  }

  if (processedEventIds.length) {
    await connection.query(
      `UPDATE platform_audit_event_bus
          SET event_status='rolled_up',updated_at=UTC_TIMESTAMP()
        WHERE event_id IN (?)`,
      [processedEventIds]
    );
  }

  return { dbInserted, assetInserted, checkpointInserted, processedEventIds };
}

async function countRemaining(connection) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
       FROM platform_audit_event_bus e
      WHERE e.event_status IN ('observed','pending_rollup')
        AND NOT EXISTS (
          SELECT 1 FROM db_change_audit_events d
           WHERE d.source_event_key COLLATE utf8mb4_unicode_ci =
                 e.event_key COLLATE utf8mb4_unicode_ci
        )
        AND NOT EXISTS (
          SELECT 1 FROM asset_audit_events a
           WHERE a.source_event_key COLLATE utf8mb4_unicode_ci =
                 e.event_key COLLATE utf8mb4_unicode_ci
        )
        AND NOT EXISTS (
          SELECT 1 FROM checkpoint_auto_rollups c
           WHERE c.source_event_key COLLATE utf8mb4_unicode_ci =
                 e.event_key COLLATE utf8mb4_unicode_ci
        )`
  );
  return Number(rows?.[0]?.count || 0);
}

export async function runAuditEventRollupBuilder(options = {}, dependencies = {}) {
  const normalized = {
    apply: options.apply === true,
    confirm: String(options.confirm || ""),
    limit: Math.max(1, Math.min(Number(options.limit || 500), 5000)),
  };
  const pool = dependencies.pool || getPool();
  const connection = await pool.getConnection();
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      return {
        ok: true,
        mode: normalized.apply ? "apply" : "dry_run",
        skipped: true,
        reason: "rollup_lock_busy",
        inserted: { db: 0, asset: 0, checkpoint: 0 },
        remaining_count: null,
        secrets_included: false,
      };
    }

    const rows = await loadRows(connection, normalized.limit);
    const classes = rows.reduce((accumulator, row) => {
      const key = eventClass(row);
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});
    const base = {
      ok: true,
      mode: normalized.apply ? "apply" : "dry_run",
      candidate_count: rows.length,
      class_counts: classes,
      sample: rows.slice(0, 10).map((row) => ({
        event_key: row.event_key,
        source_family: row.source_family,
        event_type: row.event_type,
        resource_kind: row.resource_kind,
        rollup_class: eventClass(row),
      })),
      confirm_required: AUDIT_ROLLUP_CONFIRMATION,
      raw_payload_stored: false,
      raw_before_after_stored: false,
      secrets_included: false,
    };

    if (!normalized.apply) {
      return {
        ...base,
        inserted: { db: 0, asset: 0, checkpoint: 0 },
        remaining_count: await countRemaining(connection),
        reason: "dry_run_only",
      };
    }
    if (normalized.confirm !== AUDIT_ROLLUP_CONFIRMATION) {
      const error = new Error(`--confirm=${AUDIT_ROLLUP_CONFIRMATION} required`);
      error.code = "missing_audit_rollup_confirmation";
      throw error;
    }

    const inserted = await insertRollups(connection, rows);
    return {
      ...base,
      inserted: {
        db: inserted.dbInserted,
        asset: inserted.assetInserted,
        checkpoint: inserted.checkpointInserted,
      },
      processed_event_count: inserted.processedEventIds.length,
      remaining_count: await countRemaining(connection),
      reason: "audit_events_rolled_up",
    };
  } finally {
    if (lockAcquired) {
      await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_NAME]).catch(() => {});
    }
    connection.release();
  }
}

async function main() {
  const result = await runAuditEventRollupBuilder(parseArgs());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isCli = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({
        ok: false,
        error: {
          code: error.code || "audit_event_rollup_builder_failed",
          message: error.message,
        },
        raw_payload_stored: false,
        raw_before_after_stored: false,
        secrets_included: false,
      }, null, 2)}\n`);
      process.exit(1);
    });
}
