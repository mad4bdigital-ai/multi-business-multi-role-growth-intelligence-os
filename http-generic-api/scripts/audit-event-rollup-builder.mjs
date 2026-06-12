#!/usr/bin/env node
import { getPool } from "../db.js";

const CONFIRM = "APPLY_AUDIT_EVENT_ROLLUP_BUILDER";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { apply: false, confirm: "", limit: 500 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item === "--apply") args.apply = true;
    else if (item.startsWith("--confirm")) { args.confirm = String(value || ""); if (consume) i += 1; }
    else if (item.startsWith("--limit")) { args.limit = Math.max(1, Math.min(Number(value || 500), 5000)); if (consume) i += 1; }
    else throw new Error(`Unsupported argument: ${item}`);
  }
  return args;
}

function eventClass(row) {
  const eventType = String(row.event_type || "");
  const resourceKind = String(row.resource_kind || "");
  if (eventType === "admin_control.db" || row.source_family === "governed_migration_reconciliation" || resourceKind === "database_migration") return "db_change";
  if (eventType === "repo_patch_apply" || resourceKind === "repo" || eventType === "admin_control.github" || resourceKind === "github_rest_fallback") return "asset_change";
  return "checkpoint_candidate";
}

function mutationClass(eventType = "") {
  if (eventType.includes(".db")) return "unknown";
  if (eventType.includes("insert") || eventType.includes("create")) return "insert";
  if (eventType.includes("update") || eventType.includes("patch")) return "update";
  if (eventType.includes("delete") || eventType.includes("remove")) return "delete";
  return "unknown";
}

function providerKey(row) {
  const eventType = String(row.event_type || "");
  const resourceKind = String(row.resource_kind || "");
  if (eventType.includes("github") || eventType === "repo_patch_apply" || resourceKind === "repo" || resourceKind === "github_rest_fallback") return "github";
  if (resourceKind === "admin_control") return "admin_control";
  return "platform";
}

function safeJson(value) {
  try { return JSON.stringify(value ?? {}); } catch { return JSON.stringify({ serialization_error: true, secrets_included: false }); }
}

async function loadRows(pool, limit) {
  const [rows] = await pool.query(
    `SELECT event_id, event_key, source_family, event_type, resource_kind, resource_key, event_status, created_at
       FROM platform_audit_event_bus e
      WHERE e.source_family IN ('audit_log','governed_migration_reconciliation')
        AND e.event_status IN ('observed','pending_rollup')
        AND NOT EXISTS (SELECT 1 FROM db_change_audit_events d WHERE d.source_event_key COLLATE utf8mb4_unicode_ci = e.event_key COLLATE utf8mb4_unicode_ci)
        AND NOT EXISTS (SELECT 1 FROM asset_audit_events a WHERE a.source_event_key COLLATE utf8mb4_unicode_ci = e.event_key COLLATE utf8mb4_unicode_ci)
        AND NOT EXISTS (SELECT 1 FROM checkpoint_auto_rollups c WHERE c.source_event_key COLLATE utf8mb4_unicode_ci = e.event_key COLLATE utf8mb4_unicode_ci)
      ORDER BY e.event_id ASC
      LIMIT ?`,
    [limit]
  );
  return rows;
}

async function insertRollups(pool, rows) {
  let dbInserted = 0;
  let assetInserted = 0;
  let checkpointInserted = 0;
  for (const row of rows) {
    const cls = eventClass(row);
    const evidence = {
      source: "audit_event_rollup_builder",
      source_event_key: row.event_key,
      source_family: row.source_family,
      event_type: row.event_type,
      resource_kind: row.resource_kind || null,
      resource_key_present: Boolean(row.resource_key),
      raw_payload_stored: false,
      raw_before_after_stored: false,
      secrets_included: false,
    };
    if (cls === "db_change") {
      const [res] = await pool.query(
        `INSERT INTO db_change_audit_events
          (source_family, database_name, table_name, mutation_class, governed, source_event_key, evidence_json, created_at)
         SELECT ?, DATABASE(), ?, ?, 1, ?, ?, UTC_TIMESTAMP()
          WHERE NOT EXISTS (SELECT 1 FROM db_change_audit_events WHERE source_event_key COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci)`,
        [row.source_family, String(row.resource_key || row.resource_kind || "unknown").slice(0, 191), row.source_family === "governed_migration_reconciliation" ? "migration_reconciliation" : mutationClass(row.event_type), row.event_key, safeJson(evidence), row.event_key]
      );
      dbInserted += Number(res?.affectedRows || 0);
    } else if (cls === "asset_change") {
      const [res] = await pool.query(
        `INSERT INTO asset_audit_events
          (provider_key, asset_id, asset_path, source_event_key, event_type, change_status, evidence_json, created_at)
         SELECT ?, ?, ?, ?, ?, 'observed', ?, UTC_TIMESTAMP()
          WHERE NOT EXISTS (SELECT 1 FROM asset_audit_events WHERE source_event_key COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci)`,
        [providerKey(row), row.resource_key || null, row.resource_key || null, row.event_key, String(row.event_type || "audit_event").slice(0, 80), safeJson(evidence), row.event_key]
      );
      assetInserted += Number(res?.affectedRows || 0);
    } else {
      const [res] = await pool.query(
        `INSERT INTO checkpoint_auto_rollups
          (source_event_key, checkpoint_id, trigger_family, commit_sha, rollup_status, evidence_json, created_at, updated_at)
         SELECT ?, NULL, ?, NULL, 'planned', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP()
          WHERE NOT EXISTS (SELECT 1 FROM checkpoint_auto_rollups WHERE source_event_key COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci)`,
        [row.event_key, String(row.event_type || "audit_event").slice(0, 80), safeJson(evidence), row.event_key]
      );
      checkpointInserted += Number(res?.affectedRows || 0);
    }
  }
  return { dbInserted, assetInserted, checkpointInserted };
}

async function main() {
  const args = parseArgs();
  const pool = getPool();
  const rows = await loadRows(pool, args.limit);
  const classes = rows.reduce((acc, row) => { const key = eventClass(row); acc[key] = (acc[key] || 0) + 1; return acc; }, {});
  const base = {
    ok: true,
    mode: args.apply ? "apply" : "dry_run",
    candidate_count: rows.length,
    class_counts: classes,
    sample: rows.slice(0, 10).map((row) => ({ event_key: row.event_key, event_type: row.event_type, resource_kind: row.resource_kind, rollup_class: eventClass(row) })),
    confirm_required: CONFIRM,
    raw_payload_stored: false,
    raw_before_after_stored: false,
    secrets_included: false,
  };
  if (!args.apply) {
    console.log(JSON.stringify({ ...base, inserted: { db: 0, asset: 0, checkpoint: 0 }, reason: "dry_run_only" }, null, 2));
    process.exit(0);
  }
  if (args.confirm !== CONFIRM) { const e = new Error(`--confirm=${CONFIRM} required`); e.code = "missing_audit_rollup_confirmation"; throw e; }
  const inserted = await insertRollups(pool, rows);
  console.log(JSON.stringify({ ...base, inserted: { db: inserted.dbInserted, asset: inserted.assetInserted, checkpoint: inserted.checkpointInserted }, reason: "audit_events_rolled_up" }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: error.code || "audit_event_rollup_builder_failed", message: error.message }, raw_payload_stored: false, secrets_included: false }, null, 2));
  process.exit(1);
});
