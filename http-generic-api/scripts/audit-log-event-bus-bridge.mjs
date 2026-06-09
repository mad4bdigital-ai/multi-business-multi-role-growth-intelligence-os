#!/usr/bin/env node
import { getPool } from "../db.js";

const CONFIRM = "APPLY_AUDIT_LOG_EVENT_BUS_BRIDGE";

function args(argv = process.argv.slice(2)) {
  const out = { apply: false, confirm: "", limit: 500, sinceId: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = String(argv[i] || "");
    const v = k.includes("=") ? k.split(/=(.*)/s)[1] : argv[i + 1];
    const take = !k.includes("=");
    if (k === "--apply") out.apply = true;
    else if (k.startsWith("--confirm")) { out.confirm = String(v || ""); if (take) i++; }
    else if (k.startsWith("--limit")) { out.limit = Math.max(1, Math.min(Number(v || 500), 5000)); if (take) i++; }
    else if (k.startsWith("--since-id")) { out.sinceId = Math.max(0, Number(v || 0)); if (take) i++; }
    else throw new Error(`Unsupported argument: ${k}`);
  }
  return out;
}

function txt(v, fallback = null, max = 255) {
  const s = String(v || "").trim();
  return s ? s.slice(0, max) : fallback;
}
function eventType(action) { return txt(action, "audit_log_event", 80).replace(/[^a-zA-Z0-9_.:-]/g, "_"); }
function json(v) { try { return JSON.stringify(v); } catch { return JSON.stringify({ serialization_error: true, secrets_included: false }); } }
function evidence(row) {
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

async function load(pool, opts) {
  const [rows] = await pool.query(
    `SELECT id,audit_id,tenant_id,actor_type,session_id,conversation_id,correlation_id,
            execution_context_json,action,resource_type,resource_id,before_json,after_json,occurred_at
       FROM audit_log a
      WHERE a.id > ?
        AND NOT EXISTS (SELECT 1 FROM platform_audit_event_bus b WHERE b.event_key = CONCAT('audit_log:', a.audit_id))
      ORDER BY a.id ASC LIMIT ?`, [opts.sinceId, opts.limit]
  );
  return rows;
}

async function insert(pool, rows) {
  let inserted = 0;
  for (const r of rows) {
    const [res] = await pool.query(
      `INSERT IGNORE INTO platform_audit_event_bus
       (event_key,source_family,source_key,event_type,resource_kind,resource_key,event_status,evidence_json,notes,created_at,updated_at)
       VALUES (?, 'audit_log', ?, ?, ?, ?, 'observed', ?, 'Mirrored from audit_log; summary-only no raw payloads.', COALESCE(?, UTC_TIMESTAMP()), UTC_TIMESTAMP())`,
      [`audit_log:${r.audit_id}`, r.audit_id, eventType(r.action), txt(r.resource_type, null, 80), txt(r.resource_id, null, 255), json(evidence(r)), r.occurred_at || null]
    );
    inserted += Number(res?.affectedRows || 0);
  }
  return inserted;
}

async function main() {
  const opt = args();
  const pool = getPool();
  const rows = await load(pool, opt);
  const base = {
    ok: true,
    mode: opt.apply ? "apply" : "dry_run",
    candidate_count: rows.length,
    limit: opt.limit,
    since_id: opt.sinceId,
    sample: rows.slice(0, 10).map(r => ({ audit_log_id: r.id, event_key: `audit_log:${r.audit_id}`, action: r.action, event_type: eventType(r.action), resource_kind: r.resource_type || null })),
    confirm_required: CONFIRM,
    raw_payload_stored: false,
    secrets_included: false,
  };
  if (!opt.apply) return console.log(JSON.stringify({ ...base, inserted_count: 0, reason: "dry_run_only" }, null, 2));
  if (opt.confirm !== CONFIRM) { const e = new Error(`--confirm=${CONFIRM} required`); e.code = "missing_audit_bridge_confirmation"; throw e; }
  const inserted = await insert(pool, rows);
  console.log(JSON.stringify({ ...base, inserted_count: inserted, reason: "audit_log_events_mirrored" }, null, 2));
}

main()
  .then(() => { process.exit(0); })
  .catch(e => {
    console.error(JSON.stringify({ ok: false, error: { code: e.code || "audit_log_event_bus_bridge_failed", message: e.message }, raw_payload_stored: false, secrets_included: false }, null, 2));
    process.exit(1);
  });
