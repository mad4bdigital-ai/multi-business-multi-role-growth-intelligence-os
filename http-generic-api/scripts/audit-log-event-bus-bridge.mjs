#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";

export const AUDIT_BRIDGE_CONFIRMATION = "APPLY_AUDIT_LOG_EVENT_BUS_BRIDGE";
const LOCK_NAME = "dynamic_audit.audit_log_event_bus_bridge.v1";
const CONFIG_KEY = "audit_log_event_bus_bridge_schedule";

function parseArgs(argv = process.argv.slice(2)) {
  const out = { apply: false, confirm: "", limit: 500, sinceId: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = String(argv[i] || "");
    const value = item.includes("=") ? item.split(/=(.*)/s)[1] : argv[i + 1];
    const consume = !item.includes("=");
    if (item === "--apply") out.apply = true;
    else if (item.startsWith("--confirm")) { out.confirm = String(value || ""); if (consume) i += 1; }
    else if (item.startsWith("--limit")) { out.limit = Math.max(1, Math.min(Number(value || 500), 5000)); if (consume) i += 1; }
    else if (item.startsWith("--since-id")) { out.sinceId = Math.max(0, Number(value || 0)); if (consume) i += 1; }
    else throw new Error(`Unsupported argument: ${item}`);
  }
  return out;
}

function text(value, fallback = null, max = 255) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, max) : fallback;
}

function eventType(action) {
  return text(action, "audit_log_event", 80).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function safeJson(value) {
  try { return JSON.stringify(value); }
  catch { return JSON.stringify({ serialization_error: true, secrets_included: false }); }
}

function buildEvidence(row) {
  return {
    source: "audit_log_event_bus_bridge",
    audit_id: row.audit_id,
    audit_log_id: row.id,
    action: row.action,
    resource_type: row.resource_type || null,
    actor_type: row.actor_type || null,
    tenant_id_present: Boolean(row.tenant_id),
    resource_id_present: Boolean(row.resource_id),
    correlation_id_present: Boolean(row.correlation_id),
    session_id_present: Boolean(row.session_id),
    conversation_id_present: Boolean(row.conversation_id),
    before_json_present: Boolean(row.before_json),
    after_json_present: Boolean(row.after_json),
    execution_context_present: Boolean(row.execution_context_json),
    occurred_at: row.occurred_at || null,
    raw_payload_stored: false,
    raw_before_after_stored: false,
    secrets_included: false,
  };
}

async function readCursor(connection, requestedSinceId = 0) {
  const explicit = Math.max(0, Number(requestedSinceId || 0));
  if (explicit > 0) return explicit;
  const [rows] = await connection.query(
    `SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.last_audit_log_id')) AS UNSIGNED) AS cursor_id
       FROM platform_runtime_config
      WHERE config_key=?
      LIMIT 1`,
    [CONFIG_KEY]
  );
  return Math.max(0, Number(rows?.[0]?.cursor_id || 0));
}

async function writeCursor(connection, cursorId) {
  await connection.query(
    `UPDATE platform_runtime_config
        SET config_json=JSON_SET(
              config_json,
              '$.last_audit_log_id',CAST(? AS UNSIGNED),
              '$.last_cursor_at',DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ'),
              '$.secrets_included',FALSE
            ),
            updated_at=UTC_TIMESTAMP()
      WHERE config_key=?`,
    [Math.max(0, Number(cursorId || 0)), CONFIG_KEY]
  );
}

async function loadRows(connection, options) {
  const [rows] = await connection.query(
    `SELECT id,audit_id,tenant_id,actor_type,session_id,conversation_id,correlation_id,
            execution_context_json,action,resource_type,resource_id,before_json,after_json,occurred_at
       FROM audit_log
      WHERE id > ?
      ORDER BY id ASC
      LIMIT ?`,
    [options.sinceId, options.limit]
  );
  return rows;
}

async function insertRows(connection, rows) {
  let inserted = 0;
  for (const row of rows) {
    const [result] = await connection.query(
      `INSERT IGNORE INTO platform_audit_event_bus
       (event_key,source_family,source_key,event_type,resource_kind,resource_key,
        event_status,evidence_json,notes,created_at,updated_at)
       VALUES (?, 'audit_log', ?, ?, ?, ?, 'pending_rollup', ?,
               'Mirrored from audit_log; summary-only and no raw payloads.',
               COALESCE(?, UTC_TIMESTAMP()), UTC_TIMESTAMP())`,
      [
        `audit_log:${row.audit_id}`,
        row.audit_id,
        eventType(row.action),
        text(row.resource_type, "unknown", 80),
        text(row.resource_id, "unknown", 255),
        safeJson(buildEvidence(row)),
        row.occurred_at || null,
      ]
    );
    inserted += Number(result?.affectedRows || 0);
  }
  return inserted;
}

async function countRemaining(connection, cursorId) {
  const [rows] = await connection.query(
    `SELECT GREATEST(COALESCE(MAX(id),0)-?,0) AS count
       FROM audit_log`,
    [Math.max(0, Number(cursorId || 0))]
  );
  return Number(rows?.[0]?.count || 0);
}

export async function runAuditLogEventBusBridge(options = {}, dependencies = {}) {
  const normalized = {
    apply: options.apply === true,
    confirm: String(options.confirm || ""),
    limit: Math.max(1, Math.min(Number(options.limit || 500), 5000)),
    sinceId: Math.max(0, Number(options.sinceId || 0)),
  };
  const pool = dependencies.pool || getPool();
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [LOCK_NAME]);
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) return { ok: true, mode: normalized.apply ? "apply" : "dry_run", skipped: true, reason: "bridge_lock_busy", inserted_count: 0, remaining_count: null, secrets_included: false };

    const cursorId = await readCursor(connection, normalized.sinceId);
    const rows = await loadRows(connection, { ...normalized, sinceId: cursorId });
    const base = {
      ok: true,
      mode: normalized.apply ? "apply" : "dry_run",
      candidate_count: rows.length,
      limit: normalized.limit,
      since_id: cursorId,
      sample: rows.slice(0, 10).map((row) => ({
        audit_log_id: row.id,
        event_key: `audit_log:${row.audit_id}`,
        action: row.action,
        event_type: eventType(row.action),
        resource_kind: row.resource_type || null,
      })),
      confirm_required: AUDIT_BRIDGE_CONFIRMATION,
      raw_payload_stored: false,
      raw_before_after_stored: false,
      secrets_included: false,
    };

    if (!normalized.apply) return { ...base, inserted_count: 0, remaining_count: await countRemaining(connection), reason: "dry_run_only" };
    if (normalized.confirm !== AUDIT_BRIDGE_CONFIRMATION) {
      const error = new Error(`--confirm=${AUDIT_BRIDGE_CONFIRMATION} required`);
      error.code = "missing_audit_bridge_confirmation";
      throw error;
    }

    const inserted = await insertRows(connection, rows);
    return { ...base, inserted_count: inserted, remaining_count: await countRemaining(connection), reason: "audit_log_events_mirrored" };
  } finally {
    if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_NAME]).catch(() => {});
    connection.release();
  }
}

async function main() {
  process.stdout.write(`${JSON.stringify(await runAuditLogEventBusBridge(parseArgs()), null, 2)}\n`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  main().then(() => process.exit(0)).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: { code: error.code || "audit_log_event_bus_bridge_failed", message: error.message },
      raw_payload_stored: false,
      raw_before_after_stored: false,
      secrets_included: false,
    }, null, 2)}\n`);
    process.exit(1);
  });
}
