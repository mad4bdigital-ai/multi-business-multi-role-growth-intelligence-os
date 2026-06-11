import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

function s(v, f = "") { const t = String(v ?? "").trim(); return t || f; }
function b(v) { return Number(v || 0) === 1 || v === true; }
function j(v, f = null) { if (v == null || v === "") return f; if (typeof v === "object") return v; try { return JSON.parse(String(v)); } catch { return f; } }
function n(v, f = 0) { const x = Number(v); return Number.isFinite(x) ? x : f; }
function id() { return `session_insight_target_write_readback_${randomUUID()}`; }

function sanitize(row = {}) {
  return {
    readback_id: row.readback_id,
    target_write_id: row.target_write_id,
    target_item_id: row.target_item_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    target_surface: row.target_surface,
    promotion_type: row.promotion_type,
    readback_status: row.readback_status,
    readback_mode: row.readback_mode,
    target_item_exists: b(row.target_item_exists),
    target_link_matches: b(row.target_link_matches),
    source_payload_matches: b(row.source_payload_matches),
    target_write_status_matches: b(row.target_write_status_matches),
    duplicate_target_write_count: n(row.duplicate_target_write_count),
    duplicate_target_item_count: n(row.duplicate_target_item_count),
    provider_call_executed: b(row.provider_call_executed),
    credential_payload_read: b(row.credential_payload_read),
    external_write_executed: b(row.external_write_executed),
    raw_transcript_included: b(row.raw_transcript_included),
    target_modified_by_readback: b(row.target_modified_by_readback),
    readback_result: j(row.readback_result_json, null),
    safety_contract: j(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readContext(pool, targetWriteId) {
  const [rows] = await pool.query(
    `SELECT w.*, i.target_item_id AS item_target_item_id, i.source_target_write_id,
            i.promotion_id AS item_promotion_id, i.insight_id AS item_insight_id,
            i.target_surface AS item_target_surface, i.promotion_type AS item_promotion_type,
            i.source_payload_sha256 AS item_source_payload_sha256,
            i.secrets_included AS item_secrets_included,
            dw.duplicate_target_write_count, di.duplicate_target_item_count
       FROM session_insight_backlog_target_writes w
       LEFT JOIN session_insight_backlog_target_items i ON i.target_item_id = w.target_item_id
       LEFT JOIN (
         SELECT target_item_id, COUNT(*) duplicate_target_write_count
           FROM session_insight_backlog_target_writes WHERE secrets_included = 0 GROUP BY target_item_id
       ) dw ON dw.target_item_id = w.target_item_id
       LEFT JOIN (
         SELECT source_target_write_id, COUNT(*) duplicate_target_item_count
           FROM session_insight_backlog_target_items WHERE secrets_included = 0 GROUP BY source_target_write_id
       ) di ON di.source_target_write_id = w.target_write_id
      WHERE w.target_write_id = ? AND w.secrets_included = 0
      LIMIT 1`,
    [targetWriteId]
  );
  return rows[0] || null;
}

function validate(ctx) {
  const writePayload = j(ctx.write_payload_json, {});
  const writeResult = j(ctx.write_result_json, {});
  const checks = {
    target_write_executed: ctx.target_write_status === "target_write_executed" && b(ctx.target_write_executed),
    target_item_exists: Boolean(ctx.item_target_item_id),
    target_link_matches: ctx.item_target_item_id === ctx.target_item_id && ctx.source_target_write_id === ctx.target_write_id && ctx.item_promotion_id === ctx.promotion_id && ctx.item_insight_id === ctx.insight_id && ctx.item_target_surface === ctx.target_surface && ctx.item_promotion_type === ctx.promotion_type,
    source_payload_matches: ctx.item_source_payload_sha256 === ctx.source_payload_sha256,
    write_payload_target_matches: writePayload?.target_item_id === ctx.target_item_id && writePayload?.target_surface === ctx.target_surface && writePayload?.promotion_type === ctx.promotion_type,
    write_result_target_matches: writeResult?.target_item_id === ctx.target_item_id && writeResult?.target_write_executed === true,
    no_duplicate_target_write: n(ctx.duplicate_target_write_count) === 1,
    no_duplicate_target_item: n(ctx.duplicate_target_item_count) === 1,
    no_provider_or_external: !b(ctx.provider_call_executed) && !b(ctx.credential_payload_read) && !b(ctx.external_write_executed) && !b(ctx.raw_transcript_included),
    no_secrets: !b(ctx.secrets_included) && !b(ctx.item_secrets_included),
  };
  const ok = Object.values(checks).every(Boolean);
  return { valid_target_write_readback: ok, checks, blockers: ok ? [] : Object.entries(checks).filter(([, v]) => !v).map(([k]) => k), secrets_included: false };
}

export async function createSessionInsightTargetWriteReadback({ pool = getPool(), input = {} } = {}) {
  const targetWriteId = s(input.target_write_id || input.targetWriteId);
  if (!targetWriteId) { const err = new Error("target_write_id is required."); err.status = 400; err.code = "target_write_id_required"; throw err; }
  const ctx = await readContext(pool, targetWriteId);
  if (!ctx) { const err = new Error("target write was not found."); err.status = 404; err.code = "target_write_not_found"; throw err; }
  const result = validate(ctx);
  const safety = { readback_only: true, target_write_created_by_readback: false, target_item_modified_by_readback: false, rollback_executed: false, provider_call_executed: false, credential_payload_read: false, external_write_executed: false, raw_transcript_included: false, secrets_included: false };
  const readbackId = id();
  await pool.query(
    `INSERT INTO session_insight_target_write_readbacks
       (readback_id,target_write_id,target_item_id,remaining_scope_completion_id,actual_request_id,actual_capability_envelope_id,promotion_id,insight_id,target_surface,promotion_type,readback_status,readback_mode,target_item_exists,target_link_matches,source_payload_matches,target_write_status_matches,duplicate_target_write_count,duplicate_target_item_count,provider_call_executed,credential_payload_read,external_write_executed,raw_transcript_included,target_modified_by_readback,readback_result_json,safety_contract_json,created_by,secrets_included)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'read_only_validation',?,?,?,?,?,?,0,0,0,0,0,?,?,?,0)`,
    [readbackId, ctx.target_write_id, ctx.target_item_id, ctx.remaining_scope_completion_id, ctx.actual_request_id, ctx.actual_capability_envelope_id, ctx.promotion_id, ctx.insight_id, ctx.target_surface, ctx.promotion_type, result.valid_target_write_readback ? "target_write_readback_passed" : "target_write_readback_failed", result.checks.target_item_exists ? 1 : 0, result.checks.target_link_matches ? 1 : 0, result.checks.source_payload_matches ? 1 : 0, result.checks.target_write_executed ? 1 : 0, n(ctx.duplicate_target_write_count), n(ctx.duplicate_target_item_count), JSON.stringify(result), JSON.stringify(safety), s(input.created_by || input.createdBy, "session_insight_target_write_readback_tool")]
  );
  const [rows] = await pool.query(`SELECT * FROM session_insight_target_write_readbacks WHERE readback_id = ? LIMIT 1`, [readbackId]);
  return { ok: true, readback: sanitize(rows[0] || {}), validation: result, safety_contract: safety, secrets_included: false };
}

export async function listSessionInsightTargetWriteReadbacks({ pool = getPool(), filters = {} } = {}) {
  const where = ["r.secrets_included = 0"];
  const params = [];
  const limit = Math.max(1, Math.min(Number.parseInt(filters.limit, 10) || 25, 100));
  for (const [key, col] of [["readback_id","r.readback_id"],["target_write_id","r.target_write_id"],["target_item_id","r.target_item_id"],["promotion_id","r.promotion_id"],["target_surface","r.target_surface"],["readback_status","r.readback_status"]]) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = s(filters[key] || filters[camel]);
    if (value) { where.push(`${col} = ?`); params.push(value); }
  }
  params.push(limit);
  const [rows] = await pool.query(`SELECT r.* FROM session_insight_target_write_readbacks r WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC, r.readback_id DESC LIMIT ?`, params);
  const [issues] = await pool.query(`SELECT issue_code, severity, COUNT(*) count FROM v_session_insight_target_write_readback_issues GROUP BY issue_code, severity ORDER BY severity, issue_code`);
  return { ok: true, count: rows.length, readbacks: rows.map(sanitize), issues: issues.map((r) => ({ issue_code: r.issue_code, severity: r.severity, count: n(r.count) })), policy: { readback_only: true, target_item_modified_by_readback: false, rollback_executed: false, provider_call_executed: false, credential_payload_read: false, external_write_executed: false, raw_transcript_included: false, secrets_included: false }, secrets_included: false };
}
