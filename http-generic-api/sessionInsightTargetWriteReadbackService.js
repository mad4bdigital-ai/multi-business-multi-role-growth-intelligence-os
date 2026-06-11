import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function boundedInt(value, fallback, min = 1, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function boolValue(value) {
  return Number(value || 0) === 1 || value === true;
}

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function sha256Text(value = "") {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function readbackId() {
  return `session_insight_target_write_readback_${randomUUID()}`;
}

function assertTargetWriteId(input = {}) {
  const targetWriteId = cleanString(input.target_write_id || input.targetWriteId);
  if (!targetWriteId) {
    const err = new Error("target_write_id is required.");
    err.status = 400;
    err.code = "target_write_id_required";
    throw err;
  }
  return targetWriteId;
}

function sanitizeReadback(row = {}) {
  return {
    readback_id: row.readback_id,
    target_write_id: row.target_write_id,
    target_item_id: row.target_item_id,
    remaining_scope_completion_id: row.remaining_scope_completion_id,
    actual_request_id: row.actual_request_id,
    actual_capability_envelope_id: row.actual_capability_envelope_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    target_surface: row.target_surface,
    promotion_type: row.promotion_type,
    readback_status: row.readback_status,
    readback_mode: row.readback_mode,
    target_item_exists: boolValue(row.target_item_exists),
    target_link_matches: boolValue(row.target_link_matches),
    source_payload_matches: boolValue(row.source_payload_matches),
    target_write_status_matches: boolValue(row.target_write_status_matches),
    duplicate_target_write_count: Number(row.duplicate_target_write_count || 0),
    duplicate_target_item_count: Number(row.duplicate_target_item_count || 0),
    provider_call_executed: boolValue(row.provider_call_executed),
    credential_payload_read: boolValue(row.credential_payload_read),
    external_write_executed: boolValue(row.external_write_executed),
    raw_transcript_included: boolValue(row.raw_transcript_included),
    target_modified_by_readback: boolValue(row.target_modified_by_readback),
    readback_result: parseMaybeJson(row.readback_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
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
            i.title, i.description, i.acceptance_criteria_json, i.priority,
            i.target_item_status, i.source_payload_sha256 AS item_source_payload_sha256,
            i.metadata_json AS item_metadata_json,
            i.secrets_included AS item_secrets_included,
            dup_w.duplicate_target_write_count,
            dup_i.duplicate_target_item_count
       FROM session_insight_backlog_target_writes w
       LEFT JOIN session_insight_backlog_target_items i
         ON i.target_item_id = w.target_item_id
       LEFT JOIN (
         SELECT target_item_id, COUNT(*) AS duplicate_target_write_count
           FROM session_insight_backlog_target_writes
          WHERE secrets_included = 0
          GROUP BY target_item_id
       ) dup_w ON dup_w.target_item_id = w.target_item_id
       LEFT JOIN (
         SELECT source_target_write_id, COUNT(*) AS duplicate_target_item_count
           FROM session_insight_backlog_target_items
          WHERE secrets_included = 0
          GROUP BY source_target_write_id
       ) dup_i ON dup_i.source_target_write_id = w.target_write_id
      WHERE w.target_write_id = ?
        AND w.secrets_included = 0
      LIMIT 1`,
    [targetWriteId]
  );
  return rows[0] || null;
}

function validateReadback(ctx = {}) {
  const writePayload = parseMaybeJson(ctx.write_payload_json, {});
  const writeResult = parseMaybeJson(ctx.write_result_json, {});
  const checks = {
    target_write_executed: ctx.target_write_status === "target_write_executed" && boolValue(ctx.target_write_executed),
    target_item_exists: Boolean(ctx.item_target_item_id),
    target_link_matches: ctx.item_target_item_id === ctx.target_item_id
      && ctx.source_target_write_id === ctx.target_write_id
      && ctx.item_promotion_id === ctx.promotion_id
      && ctx.item_insight_id === ctx.insight_id
      && ctx.item_target_surface === ctx.target_surface
      && ctx.item_promotion_type === ctx.promotion_type,
    source_payload_matches: ctx.item_source_payload_sha256 === ctx.source_payload_sha256,
    write_payload_target_matches: writePayload?.target_item_id === ctx.target_item_id
      && writePayload?.target_surface === ctx.target_surface
      && writePayload?.promotion_type === ctx.promotion_type,
    write_result_target_matches: writeResult?.target_item_id === ctx.target_item_id
      && writeResult?.target_write_executed === true,
    no_duplicate_target_write: Number(ctx.duplicate_target_write_count || 0) === 1,
    no_duplicate_target_item: Number(ctx.duplicate_target_item_count || 0) === 1,
    no_provider_or_external: !boolValue(ctx.provider_call_executed)
      && !boolValue(ctx.credential_payload_read)
      && !boolValue(ctx.external_write_executed)
      && !boolValue(ctx.raw_transcript_included),
    no_secrets: !boolValue(ctx.secrets_included) && !boolValue(ctx.item_secrets_included),
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_target_write_readback: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    target_item_status: ctx.target_item_status || null,
    target_item_hash_sha256: sha256Text(JSON.stringify({
      target_item_id: ctx.item_target_item_id || null,
      source_target_write_id: ctx.source_target_write_id || null,
      promotion_id: ctx.item_promotion_id || null,
      insight_id: ctx.item_insight_id || null,
      target_surface: ctx.item_target_surface || null,
      promotion_type: ctx.item_promotion_type || null,
      title: ctx.title || null,
      description: ctx.description || null,
      acceptance_criteria_json: ctx.acceptance_criteria_json || null,
      priority: ctx.priority || null,
      target_item_status: ctx.target_item_status || null,
      source_payload_sha256: ctx.item_source_payload_sha256 || null,
    })),
    secrets_included: false,
  };
}

export async function createSessionInsightTargetWriteReadback({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const targetWriteId = assertTargetWriteId(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_target_write_readback_tool");
  const ctx = await readContext(pool, targetWriteId);
  if (!ctx) {
    const err = new Error("target write was not found.");
    err.status = 404;
    err.code = "target_write_not_found";
    throw err;
  }
  const validation = validateReadback(ctx);
  const safety = {
    readback_only: true,
    target_write_created_by_readback: false,
    target_item_modified_by_readback: false,
    rollback_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const id = readbackId();
  await pool.query(
    `INSERT INTO session_insight_target_write_readbacks
       (readback_id, target_write_id, target_item_id, remaining_scope_completion_id, actual_request_id,
        actual_capability_envelope_id, promotion_id, insight_id, target_surface, promotion_type,
        readback_status, readback_mode, target_item_exists, target_link_matches, source_payload_matches,
        target_write_status_matches, duplicate_target_write_count, duplicate_target_item_count,
        provider_call_executed, credential_payload_read, external_write_executed, raw_transcript_included,
        target_modified_by_readback, readback_result_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'read_only_validation', ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?, 0)`,
    [
      id,
      ctx.target_write_id,
      ctx.target_item_id,
      ctx.remaining_scope_completion_id,
      ctx.actual_request_id,
      ctx.actual_capability_envelope_id,
      ctx.promotion_id,
      ctx.insight_id,
      ctx.target_surface,
      ctx.promotion_type,
      validation.valid_target_write_readback ? "target_write_readback_passed" : "target_write_readback_failed",
      validation.checks.target_item_exists ? 1 : 0,
      validation.checks.target_link_matches ? 1 : 0,
      validation.checks.source_payload_matches ? 1 : 0,
      validation.checks.target_write_executed ? 1 : 0,
      Number(ctx.duplicate_target_write_count || 0),
      Number(ctx.duplicate_target_item_count || 0),
      JSON.stringify(validation),
      JSON.stringify(safety),
      createdBy,
    ]
  );
  const [rows] = await pool.query(`SELECT * FROM session_insight_target_write_readbacks WHERE readback_id = ? LIMIT 1`, [id]);
  return {
    ok: true,
    readback: sanitizeReadback(rows[0] || {}),
    validation,
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightTargetWriteReadbacks({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["r.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);
  for (const [inputKey, columnName] of [
    ["readback_id", "r.readback_id"],
    ["target_write_id", "r.target_write_id"],
    ["target_item_id", "r.target_item_id"],
    ["promotion_id", "r.promotion_id"],
    ["target_surface", "r.target_surface"],
    ["readback_status", "r.readback_status"],
  ]) {
    const camelKey = inputKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = cleanString(body[inputKey] || body[camelKey]);
    if (value) {
      where.push(`${columnName} = ?`);
      params.push(value);
    }
  }
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT r.*
       FROM session_insight_target_write_readbacks r
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at DESC, r.readback_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT readback_status, target_surface, COUNT(*) AS count
       FROM session_insight_target_write_readbacks
      WHERE secrets_included = 0
      GROUP BY readback_status, target_surface
      ORDER BY readback_status, target_surface`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_target_write_readback_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    readbacks: rows.map(sanitizeReadback),
    summary: summaryRows.map((row) => ({ readback_status: row.readback_status, target_surface: row.target_surface, count: Number(row.count || 0) })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    policy: {
      readback_only: true,
      target_write_created_by_readback: false,
      target_item_modified_by_readback: false,
      rollback_executed: false,
      provider_call_executed: false,
      credential_payload_read: false,
      external_write_executed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
