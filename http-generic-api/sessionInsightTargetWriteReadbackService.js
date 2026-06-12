import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const clean = (value, fallback = "") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};
const asBool = (value) => Number(value || 0) === 1 || value === true;
const asNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}
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
    target_item_exists: asBool(row.target_item_exists),
    target_link_matches: asBool(row.target_link_matches),
    source_payload_matches: asBool(row.source_payload_matches),
    target_write_status_matches: asBool(row.target_write_status_matches),
    duplicate_target_write_count: asNumber(row.duplicate_target_write_count),
    duplicate_target_item_count: asNumber(row.duplicate_target_item_count),
    provider_call_executed: asBool(row.provider_call_executed),
    credential_payload_read: asBool(row.credential_payload_read),
    external_write_executed: asBool(row.external_write_executed),
    raw_transcript_included: asBool(row.raw_transcript_included),
    target_modified_by_readback: asBool(row.target_modified_by_readback),
    readback_result: parseJson(row.readback_result_json, null),
    safety_contract: parseJson(row.safety_contract_json, null),
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
         SELECT target_item_id, COUNT(*) AS duplicate_target_write_count
           FROM session_insight_backlog_target_writes
          WHERE secrets_included = 0
          GROUP BY target_item_id
       ) dw ON dw.target_item_id = w.target_item_id
       LEFT JOIN (
         SELECT source_target_write_id, COUNT(*) AS duplicate_target_item_count
           FROM session_insight_backlog_target_items
          WHERE secrets_included = 0
          GROUP BY source_target_write_id
       ) di ON di.source_target_write_id = w.target_write_id
      WHERE w.target_write_id = ?
        AND w.secrets_included = 0
      LIMIT 1`,
    [targetWriteId]
  );
  return rows[0] || null;
}
function validate(ctx) {
  const writePayload = parseJson(ctx.write_payload_json, {});
  const writeResult = parseJson(ctx.write_result_json, {});
  const checks = {
    target_write_executed: ctx.target_write_status === "target_write_executed" && asBool(ctx.target_write_executed),
    target_item_exists: Boolean(ctx.item_target_item_id),
    target_link_matches:
      ctx.item_target_item_id === ctx.target_item_id &&
      ctx.source_target_write_id === ctx.target_write_id &&
      ctx.item_promotion_id === ctx.promotion_id &&
      ctx.item_insight_id === ctx.insight_id &&
      ctx.item_target_surface === ctx.target_surface &&
      ctx.item_promotion_type === ctx.promotion_type,
    source_payload_matches: ctx.item_source_payload_sha256 === ctx.source_payload_sha256,
    write_payload_target_matches:
      writePayload?.target_item_id === ctx.target_item_id &&
      writePayload?.target_surface === ctx.target_surface &&
      writePayload?.promotion_type === ctx.promotion_type,
    write_result_target_matches: writeResult?.target_item_id === ctx.target_item_id && writeResult?.target_write_executed === true,
    no_duplicate_target_write: asNumber(ctx.duplicate_target_write_count) === 1,
    no_duplicate_target_item: asNumber(ctx.duplicate_target_item_count) === 1,
    no_provider_or_external:
      !asBool(ctx.provider_call_executed) &&
      !asBool(ctx.credential_payload_read) &&
      !asBool(ctx.external_write_executed) &&
      !asBool(ctx.raw_transcript_included),
    no_secrets: !asBool(ctx.secrets_included) && !asBool(ctx.item_secrets_included),
  };
  const valid = Object.values(checks).every(Boolean);
  return { valid_target_write_readback: valid, checks, blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key), secrets_included: false };
}
export async function createSessionInsightTargetWriteReadback({ pool = getPool(), input = {} } = {}) {
  const targetWriteId = clean(input.target_write_id || input.targetWriteId);
  if (!targetWriteId) {
    const err = new Error("target_write_id is required.");
    err.status = 400;
    err.code = "target_write_id_required";
    throw err;
  }
  const ctx = await readContext(pool, targetWriteId);
  if (!ctx) {
    const err = new Error("target write was not found.");
    err.status = 404;
    err.code = "target_write_not_found";
    throw err;
  }
  const result = validate(ctx);
  const safety = { readback_only: true, target_write_created_by_readback: false, target_item_modified_by_readback: false, rollback_executed: false, provider_call_executed: false, credential_payload_read: false, external_write_executed: false, raw_transcript_included: false, secrets_included: false };
  const readbackId = `session_insight_target_write_readback_${randomUUID()}`;
  await pool.query(
    `INSERT INTO session_insight_target_write_readbacks
       (readback_id,target_write_id,target_item_id,remaining_scope_completion_id,actual_request_id,actual_capability_envelope_id,promotion_id,insight_id,target_surface,promotion_type,readback_status,readback_mode,target_item_exists,target_link_matches,source_payload_matches,target_write_status_matches,duplicate_target_write_count,duplicate_target_item_count,provider_call_executed,credential_payload_read,external_write_executed,raw_transcript_included,target_modified_by_readback,readback_result_json,safety_contract_json,created_by,secrets_included)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'read_only_validation',?,?,?,?,?,?,0,0,0,0,0,?,?,?,0)`,
    [readbackId, ctx.target_write_id, ctx.target_item_id, ctx.remaining_scope_completion_id, ctx.actual_request_id, ctx.actual_capability_envelope_id, ctx.promotion_id, ctx.insight_id, ctx.target_surface, ctx.promotion_type, result.valid_target_write_readback ? "target_write_readback_passed" : "target_write_readback_failed", result.checks.target_item_exists ? 1 : 0, result.checks.target_link_matches ? 1 : 0, result.checks.source_payload_matches ? 1 : 0, result.checks.target_write_executed ? 1 : 0, asNumber(ctx.duplicate_target_write_count), asNumber(ctx.duplicate_target_item_count), JSON.stringify(result), JSON.stringify(safety), clean(input.created_by || input.createdBy, "session_insight_target_write_readback_tool")]
  );
  const [rows] = await pool.query(`SELECT * FROM session_insight_target_write_readbacks WHERE readback_id = ? LIMIT 1`, [readbackId]);
  return { ok: true, readback: sanitize(rows[0] || {}), validation: result, safety_contract: safety, secrets_included: false };
}
export async function listSessionInsightTargetWriteReadbacks({ pool = getPool(), filters = {} } = {}) {
  const where = ["r.secrets_included = 0"];
  const params = [];
  const limit = Math.max(1, Math.min(Number.parseInt(filters.limit, 10) || 25, 100));
  for (const [key, column] of [["readback_id", "r.readback_id"], ["target_write_id", "r.target_write_id"], ["target_item_id", "r.target_item_id"], ["promotion_id", "r.promotion_id"], ["target_surface", "r.target_surface"], ["readback_status", "r.readback_status"]]) {
    const camel = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = clean(filters[key] || filters[camel]);
    if (value) { where.push(`${column} = ?`); params.push(value); }
  }
  params.push(limit);
  const [rows] = await pool.query(`SELECT r.* FROM session_insight_target_write_readbacks r WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC, r.readback_id DESC LIMIT ?`, params);
  const [issues] = await pool.query(`SELECT issue_code, severity, COUNT(*) AS count FROM v_session_insight_target_write_readback_issues GROUP BY issue_code, severity ORDER BY severity, issue_code`);
  return { ok: true, count: rows.length, readbacks: rows.map(sanitize), issues: issues.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: asNumber(row.count) })), policy: { readback_only: true, target_item_modified_by_readback: false, rollback_executed: false, provider_call_executed: false, credential_payload_read: false, external_write_executed: false, raw_transcript_included: false, secrets_included: false }, secrets_included: false };
}
