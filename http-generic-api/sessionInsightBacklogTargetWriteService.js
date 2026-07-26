import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const EXECUTE_CONFIRM = "EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE";
const ROLLBACK_CONFIRM = "ROLLBACK_SESSION_INSIGHT_BACKLOG_TARGET_WRITE";
const ALLOWED_SURFACES = new Set(["development_backlog", "integration_backlog", "runtime_repair_backlog"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
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

function targetWriteId() {
  return `session_insight_target_write_${randomUUID()}`;
}

function targetItemId() {
  return `session_insight_backlog_item_${randomUUID()}`;
}

function assertTypedConfirm(input = {}, expected, code) {
  const typedConfirm = cleanString(input.typed_confirm || input.typedConfirm);
  if (typedConfirm !== expected) {
    const err = new Error(`typed_confirm must equal ${expected}.`);
    err.status = 400;
    err.code = code;
    throw err;
  }
  return typedConfirm;
}

function normalizePayload(payload = {}, ctx = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const title = cleanString(source.title || source.name || source.summary, `Session insight ${ctx.target_surface || "backlog"} item`).slice(0, 255);
  const description = cleanString(source.description || source.body || source.proposal_text || source.details, JSON.stringify(source).slice(0, 4000)).slice(0, 12000);
  const rawCriteria = Array.isArray(source.acceptance_criteria) ? source.acceptance_criteria : Array.isArray(source.acceptanceCriteria) ? source.acceptanceCriteria : [];
  const acceptanceCriteria = rawCriteria.map((item) => cleanString(item)).filter(Boolean).slice(0, 25);
  const priority = ALLOWED_PRIORITIES.has(String(source.priority || "").toLowerCase()) ? String(source.priority).toLowerCase() : "medium";
  return { title, description, acceptance_criteria: acceptanceCriteria, priority };
}

function sanitizeWrite(row = {}) {
  return {
    target_write_id: row.target_write_id,
    remaining_scope_completion_id: row.remaining_scope_completion_id,
    adapter_execution_gate_id: row.adapter_execution_gate_id,
    actual_request_id: row.actual_request_id,
    actual_capability_envelope_id: row.actual_capability_envelope_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    target_surface: row.target_surface,
    promotion_type: row.promotion_type,
    target_item_id: row.target_item_id,
    target_write_status: row.target_write_status,
    target_write_allowed: boolValue(row.target_write_allowed),
    target_write_executed: boolValue(row.target_write_executed),
    promotion_allowed: boolValue(row.promotion_allowed),
    provider_call_executed: boolValue(row.provider_call_executed),
    credential_payload_read: boolValue(row.credential_payload_read),
    external_write_executed: boolValue(row.external_write_executed),
    raw_transcript_included: boolValue(row.raw_transcript_included),
    write_payload: parseMaybeJson(row.write_payload_json, null),
    write_result: parseMaybeJson(row.write_result_json, null),
    rollback_plan: parseMaybeJson(row.rollback_plan_json, null),
    rollback_result: parseMaybeJson(row.rollback_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    rolled_back_by: row.rolled_back_by || null,
    rolled_back_at: row.rolled_back_at || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

function sanitizeItem(row = {}) {
  return {
    target_item_id: row.target_item_id,
    source_target_write_id: row.source_target_write_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    target_surface: row.target_surface,
    promotion_type: row.promotion_type,
    title: row.title,
    description: row.description || null,
    acceptance_criteria: parseMaybeJson(row.acceptance_criteria_json, []),
    priority: row.priority,
    target_item_status: row.target_item_status,
    metadata: parseMaybeJson(row.metadata_json, null),
    created_by: row.created_by || null,
    rolled_back_at: row.rolled_back_at || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readTargetWriteContext(pool, remainingScopeCompletionId) {
  const [rows] = await pool.query(
    `SELECT c.*, g.capability_plan_id, g.adapter_execution_gate_status, g.adapter_execution_policy_status,
            p.payload_preview_id, p.apply_request_id, p.target_surface, p.promotion_type, p.adapter_key, p.contract_key,
            pp.payload_status, pp.payload_mode, pp.payload_json, pp.validation_result_json,
            pp.execution_allowed AS payload_execution_allowed,
            pp.target_write_allowed AS payload_target_write_allowed,
            pp.secrets_included AS payload_secrets_included,
            latest.target_write_id AS existing_target_write_id
       FROM session_insight_capability_envelope_remaining_scope_completions c
       JOIN session_insight_capability_envelope_adapter_execution_gates g
         ON g.adapter_execution_gate_id = c.adapter_execution_gate_id
       JOIN session_insight_capability_envelope_plans p
         ON p.capability_plan_id = g.capability_plan_id
       JOIN session_insight_promotion_payload_previews pp
         ON pp.payload_preview_id = p.payload_preview_id
       LEFT JOIN session_insight_backlog_target_writes latest
         ON latest.remaining_scope_completion_id = c.remaining_scope_completion_id
      WHERE c.remaining_scope_completion_id = ?
      LIMIT 1`,
    [remainingScopeCompletionId]
  );
  return rows[0] || null;
}

function validateWriteContext(ctx = {}) {
  const validation = parseMaybeJson(ctx.validation_result_json, {});
  const checks = {
    remaining_scope_completed: ctx.completion_status === "remaining_scope_completed_as_gated_no_execution",
    remaining_scope_policy_ready: ctx.completion_policy_status === "all_remaining_stages_gated_no_execution",
    adapter_gate_ready: ctx.adapter_execution_gate_status === "adapter_execution_gate_ready" && ctx.adapter_execution_policy_status === "ready_for_adapter_apply_dispatch",
    target_surface_supported: ALLOWED_SURFACES.has(ctx.target_surface),
    payload_ready: ctx.payload_status === "payload_preview_generated" && ctx.payload_mode === "dry_run_payload_preview",
    payload_contract_valid: validation?.valid_for_dry_run_contract === true,
    source_no_previous_write: !ctx.existing_target_write_id,
    source_no_secret_or_external: !boolValue(ctx.secrets_included) && !boolValue(ctx.payload_secrets_included) && !boolValue(ctx.adapter_apply_executed) && !boolValue(ctx.target_write_executed),
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_for_internal_backlog_target_write: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    secrets_included: false,
  };
}

async function insertTargetWrite(pool, { ctx, payload, normalized, typedConfirm, createdBy, validation }) {
  const writeId = targetWriteId();
  const itemId = targetItemId();
  const payloadJson = JSON.stringify(payload || {});
  const payloadSha = sha256Text(payloadJson);
  const completionSha = sha256Text(ctx.completion_result_json || ctx.safety_contract_json || ctx.remaining_scope_completion_id);
  const metadata = {
    source: "session_insight_backlog_target_write_executor",
    payload_preview_id: ctx.payload_preview_id,
    apply_request_id: ctx.apply_request_id,
    capability_plan_id: ctx.capability_plan_id,
    adapter_execution_gate_id: ctx.adapter_execution_gate_id,
    actual_capability_envelope_id: ctx.actual_capability_envelope_id,
    secrets_included: false,
  };
  const writePayload = {
    target_item_id: itemId,
    target_surface: ctx.target_surface,
    promotion_type: ctx.promotion_type,
    title: normalized.title,
    description: normalized.description,
    acceptance_criteria: normalized.acceptance_criteria,
    priority: normalized.priority,
    source_payload_sha256: payloadSha,
    secrets_included: false,
  };
  const writeResult = {
    target_write_executed: true,
    target_item_id: itemId,
    target_table: "session_insight_backlog_target_items",
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const rollbackPlan = {
    rollback_supported: true,
    rollback_action: "mark_target_item_rolled_back",
    rollback_tool_key: "session_insight_backlog_target_write_rollback",
    deletes_data: false,
    provider_call_required: false,
    secrets_included: false,
  };
  const safety = {
    actual_internal_sql_target_write: true,
    target_write_allowed: true,
    target_write_executed: true,
    promotion_allowed: true,
    target_surface: ctx.target_surface,
    target_item_id: itemId,
    rollback_available: true,
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  await pool.query(
    `INSERT INTO session_insight_backlog_target_items
       (target_item_id, source_target_write_id, promotion_id, insight_id, target_surface, promotion_type,
        title, description, acceptance_criteria_json, priority, target_item_status,
        source_payload_sha256, metadata_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 0)`,
    [itemId, writeId, ctx.promotion_id, ctx.insight_id, ctx.target_surface, ctx.promotion_type,
      normalized.title, normalized.description, JSON.stringify(normalized.acceptance_criteria), normalized.priority,
      payloadSha, JSON.stringify(metadata), createdBy]
  );
  await pool.query(
    `INSERT INTO session_insight_backlog_target_writes
       (target_write_id, remaining_scope_completion_id, adapter_execution_gate_id, actual_request_id,
        actual_capability_envelope_id, promotion_id, insight_id, target_surface, promotion_type,
        target_item_id, typed_confirm, target_write_status, target_write_allowed, target_write_executed,
        promotion_allowed, provider_call_executed, credential_payload_read, external_write_executed,
        raw_transcript_included, source_remaining_scope_sha256, source_payload_sha256, write_payload_json,
        write_result_json, rollback_plan_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'target_write_executed', 1, 1, 1, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [writeId, ctx.remaining_scope_completion_id, ctx.adapter_execution_gate_id, ctx.actual_request_id,
      ctx.actual_capability_envelope_id, ctx.promotion_id, ctx.insight_id, ctx.target_surface, ctx.promotion_type,
      itemId, typedConfirm, completionSha, payloadSha, JSON.stringify(writePayload), JSON.stringify({ ...writeResult, validation }),
      JSON.stringify(rollbackPlan), JSON.stringify(safety), createdBy]
  );
  const [writeRows] = await pool.query(`SELECT * FROM session_insight_backlog_target_writes WHERE target_write_id = ? LIMIT 1`, [writeId]);
  const [itemRows] = await pool.query(`SELECT * FROM session_insight_backlog_target_items WHERE target_item_id = ? LIMIT 1`, [itemId]);
  return { write: writeRows[0] || null, item: itemRows[0] || null, safety };
}

export async function executeSessionInsightBacklogTargetWrite({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const typedConfirm = assertTypedConfirm(body, EXECUTE_CONFIRM, "session_insight_backlog_target_write_typed_confirm_required");
  const remainingScopeCompletionId = cleanString(body.remaining_scope_completion_id || body.remainingScopeCompletionId);
  if (!remainingScopeCompletionId) {
    const err = new Error("remaining_scope_completion_id is required.");
    err.status = 400;
    err.code = "remaining_scope_completion_id_required";
    throw err;
  }
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_backlog_target_write_tool");
  const ctx = await readTargetWriteContext(pool, remainingScopeCompletionId);
  if (!ctx) {
    const err = new Error("remaining scope completion context was not found.");
    err.status = 404;
    err.code = "remaining_scope_completion_context_not_found";
    throw err;
  }
  const validation = validateWriteContext(ctx);
  if (!validation.valid_for_internal_backlog_target_write) {
    const err = new Error("target write validation failed.");
    err.status = 409;
    err.code = "session_insight_backlog_target_write_validation_failed";
    err.details = validation;
    throw err;
  }
  const payload = parseMaybeJson(ctx.payload_json, {});
  const normalized = normalizePayload(payload, ctx);
  const result = await insertTargetWrite(pool, { ctx, payload, normalized, typedConfirm, createdBy, validation });
  return {
    ok: true,
    target_write: sanitizeWrite(result.write),
    target_item: sanitizeItem(result.item),
    safety_contract: result.safety,
    secrets_included: false,
  };
}

export async function rollbackSessionInsightBacklogTargetWrite({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  assertTypedConfirm(body, ROLLBACK_CONFIRM, "session_insight_backlog_target_write_rollback_confirm_required");
  const targetWriteId = cleanString(body.target_write_id || body.targetWriteId);
  if (!targetWriteId) {
    const err = new Error("target_write_id is required.");
    err.status = 400;
    err.code = "target_write_id_required";
    throw err;
  }
  const rolledBackBy = cleanString(body.rolled_back_by || body.rolledBackBy, "session_insight_backlog_target_write_rollback_tool");
  const rollbackReason = cleanString(body.rollback_reason || body.rollbackReason, "operator_requested_rollback");
  const [rows] = await pool.query(`SELECT * FROM session_insight_backlog_target_writes WHERE target_write_id = ? AND secrets_included = 0 LIMIT 1`, [targetWriteId]);
  const write = rows[0];
  if (!write) {
    const err = new Error("target write was not found.");
    err.status = 404;
    err.code = "target_write_not_found";
    throw err;
  }
  if (write.target_write_status === "rolled_back") {
    const err = new Error("target write is already rolled back.");
    err.status = 409;
    err.code = "target_write_already_rolled_back";
    throw err;
  }
  const rollbackResult = {
    rollback_executed: true,
    rollback_action: "mark_target_item_rolled_back",
    rollback_reason: rollbackReason,
    deletes_data: false,
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };
  await pool.query(`UPDATE session_insight_backlog_target_items SET target_item_status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP WHERE target_item_id = ? AND secrets_included = 0`, [write.target_item_id]);
  await pool.query(
    `UPDATE session_insight_backlog_target_writes
        SET target_write_status = 'rolled_back', rollback_result_json = ?, rolled_back_by = ?, rolled_back_at = CURRENT_TIMESTAMP
      WHERE target_write_id = ? AND secrets_included = 0`,
    [JSON.stringify(rollbackResult), rolledBackBy, targetWriteId]
  );
  const [writeRows] = await pool.query(`SELECT * FROM session_insight_backlog_target_writes WHERE target_write_id = ? LIMIT 1`, [targetWriteId]);
  const [itemRows] = await pool.query(`SELECT * FROM session_insight_backlog_target_items WHERE target_item_id = ? LIMIT 1`, [write.target_item_id]);
  return {
    ok: true,
    target_write: sanitizeWrite(writeRows[0] || write),
    target_item: sanitizeItem(itemRows[0] || {}),
    rollback_result: rollbackResult,
    secrets_included: false,
  };
}

export async function listSessionInsightBacklogTargetWrites({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["w.secrets_included = 0"];
  const params = [];
  const limit = Math.max(1, Math.min(Number.parseInt(body.limit, 10) || 25, 100));
  for (const [inputKey, columnName] of [
    ["target_write_id", "w.target_write_id"],
    ["remaining_scope_completion_id", "w.remaining_scope_completion_id"],
    ["target_item_id", "w.target_item_id"],
    ["promotion_id", "w.promotion_id"],
    ["target_surface", "w.target_surface"],
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
    `SELECT w.*
       FROM session_insight_backlog_target_writes w
      WHERE ${where.join(" AND ")}
      ORDER BY w.created_at DESC, w.target_write_id DESC
      LIMIT ?`,
    params
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_backlog_target_write_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    target_writes: rows.map(sanitizeWrite),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    policy: {
      execute_typed_confirm: EXECUTE_CONFIRM,
      rollback_typed_confirm: ROLLBACK_CONFIRM,
      target_write_allowed: true,
      target_write_executed: true,
      internal_sql_only: true,
      provider_call_executed: false,
      credential_payload_read: false,
      external_write_executed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
