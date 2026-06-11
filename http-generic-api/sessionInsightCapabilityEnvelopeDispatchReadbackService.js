import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

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

function dispatchReadbackId() {
  return `capability_dispatch_readback_${randomUUID()}`;
}

function assertApprovalDecisionId(input = {}) {
  const value = cleanString(input.approval_decision_id || input.approvalDecisionId);
  if (!value) {
    const err = new Error("approval_decision_id is required.");
    err.status = 400;
    err.code = "approval_decision_id_required";
    throw err;
  }
  return value;
}

function sanitizeDispatchReadback(row = {}) {
  return {
    dispatch_readback_id: row.dispatch_readback_id,
    approval_decision_id: row.approval_decision_id,
    actual_request_id: row.actual_request_id,
    actual_request_preflight_id: row.actual_request_preflight_id,
    dispatch_dry_run_id: row.dispatch_dry_run_id,
    request_gate_id: row.request_gate_id,
    capability_plan_id: row.capability_plan_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    capability_key: row.capability_key,
    operation_intent: row.operation_intent,
    runtime_surface: row.runtime_surface,
    actual_capability_envelope_id: row.actual_capability_envelope_id,
    dispatch_readback_status: row.dispatch_readback_status,
    dispatch_readback_policy_status: row.dispatch_readback_policy_status,
    approval_hold_created: boolValue(row.approval_hold_created),
    approval_hold_id: row.approval_hold_id || null,
    envelope_status: row.envelope_status,
    envelope_decision: row.envelope_decision,
    envelope_dispatch_allowed: boolValue(row.envelope_dispatch_allowed),
    envelope_apply_allowed: boolValue(row.envelope_apply_allowed),
    envelope_approval_required: boolValue(row.envelope_approval_required),
    envelope_blocking_gap_count: Number(row.envelope_blocking_gap_count || 0),
    adapter_apply_executed: boolValue(row.adapter_apply_executed),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    readback_result_json: parseMaybeJson(row.readback_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readApprovalDecisionContext(pool, approvalDecisionId) {
  const [rows] = await pool.query(
    `SELECT d.*,
            e.envelope_status AS ledger_envelope_status,
            e.decision AS ledger_decision,
            e.dispatch_allowed AS ledger_dispatch_allowed,
            e.apply_allowed AS ledger_apply_allowed,
            e.approval_required AS ledger_approval_required,
            e.blocking_gap_count AS ledger_blocking_gap_count,
            e.secrets_included AS ledger_secrets_included
       FROM session_insight_capability_envelope_approval_decisions d
       LEFT JOIN capability_resolution_envelope_ledger e
         ON e.envelope_id = d.actual_capability_envelope_id
      WHERE d.approval_decision_id = ?
      LIMIT 1`,
    [approvalDecisionId]
  );
  return rows[0] || null;
}

async function countExistingDispatchReadback(pool, approvalDecisionId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM session_insight_capability_envelope_dispatch_readbacks
      WHERE approval_decision_id = ?
        AND secrets_included = 0
        AND dispatch_readback_status = 'dispatch_readback_passed'`,
    [approvalDecisionId]
  );
  return Number(rows?.[0]?.count || 0);
}

function validateDispatchReadbackContext(ctx = {}) {
  const checks = {
    approval_decision_approved: ctx.approval_decision_status === "actual_envelope_approved",
    approval_policy_no_execution: ctx.approval_policy_status === "approved_but_not_executed",
    approval_hold_created: boolValue(ctx.approval_hold_created) && Boolean(ctx.approval_hold_id),
    approval_decision_no_execution: !boolValue(ctx.execution_allowed) && !boolValue(ctx.target_write_allowed) && !boolValue(ctx.adapter_apply_executed),
    envelope_ready_for_dispatch: ctx.ledger_envelope_status === "ready_for_dispatch" && ctx.ledger_decision === "ready_for_dispatch",
    envelope_dispatch_allowed: boolValue(ctx.ledger_dispatch_allowed),
    envelope_no_blocking_gaps: Number(ctx.ledger_blocking_gap_count || 0) === 0,
    no_secrets: !boolValue(ctx.secrets_included) && !boolValue(ctx.ledger_secrets_included),
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_for_dispatch_readback: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    source_approval_decision_sha256: sha256Text(ctx.approval_result_json),
    readback_only: true,
    adapter_apply_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    secrets_included: false,
  };
}

async function insertDispatchReadback(pool, { ctx, readbackResult, safety, createdBy }) {
  const id = dispatchReadbackId();
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_dispatch_readbacks
       (dispatch_readback_id, approval_decision_id, actual_request_id, actual_request_preflight_id,
        dispatch_dry_run_id, request_gate_id, capability_plan_id, promotion_id, insight_id,
        capability_key, operation_intent, runtime_surface, actual_capability_envelope_id,
        dispatch_readback_status, dispatch_readback_policy_status, approval_hold_created, approval_hold_id,
        envelope_status, envelope_decision, envelope_dispatch_allowed, envelope_apply_allowed,
        envelope_approval_required, envelope_blocking_gap_count, adapter_apply_executed,
        execution_allowed, target_write_allowed, source_approval_decision_sha256,
        readback_result_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'dispatch_readback_passed', 'ready_for_adapter_execution_gate', 1, ?,
             ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 0)`,
    [
      id,
      ctx.approval_decision_id,
      ctx.actual_request_id,
      ctx.actual_request_preflight_id,
      ctx.dispatch_dry_run_id,
      ctx.request_gate_id,
      ctx.capability_plan_id,
      ctx.promotion_id,
      ctx.insight_id,
      ctx.capability_key,
      ctx.operation_intent,
      ctx.runtime_surface,
      ctx.actual_capability_envelope_id,
      ctx.approval_hold_id,
      ctx.ledger_envelope_status,
      ctx.ledger_decision,
      boolValue(ctx.ledger_dispatch_allowed) ? 1 : 0,
      boolValue(ctx.ledger_apply_allowed) ? 1 : 0,
      boolValue(ctx.ledger_approval_required) ? 1 : 0,
      Number(ctx.ledger_blocking_gap_count || 0),
      sha256Text(ctx.approval_result_json),
      JSON.stringify(readbackResult),
      JSON.stringify(safety),
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_dispatch_readbacks WHERE dispatch_readback_id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function createSessionInsightCapabilityEnvelopeDispatchReadback({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const approvalDecisionId = assertApprovalDecisionId(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_capability_dispatch_readback_tool");
  const ctx = await readApprovalDecisionContext(pool, approvalDecisionId);
  if (!ctx) {
    const err = new Error("capability envelope approval decision was not found.");
    err.status = 404;
    err.code = "capability_envelope_approval_decision_not_found";
    throw err;
  }
  const existing = await countExistingDispatchReadback(pool, approvalDecisionId);
  if (existing > 0) {
    const err = new Error("dispatch readback already exists for this approval decision.");
    err.status = 409;
    err.code = "capability_envelope_dispatch_readback_already_exists";
    err.details = { approval_decision_id: approvalDecisionId, existing_count: existing, secrets_included: false };
    throw err;
  }
  const readbackResult = validateDispatchReadbackContext(ctx);
  if (!readbackResult.valid_for_dispatch_readback) {
    const err = new Error("capability envelope dispatch readback validation failed.");
    err.status = 409;
    err.code = "capability_envelope_dispatch_readback_validation_failed";
    err.details = readbackResult;
    throw err;
  }
  const safety = {
    dispatch_readback_only: true,
    approval_decision_id: approvalDecisionId,
    actual_capability_envelope_id: ctx.actual_capability_envelope_id,
    envelope_status: ctx.ledger_envelope_status,
    envelope_decision: ctx.ledger_decision,
    ready_for_adapter_execution_gate: true,
    adapter_execution_gate_not_implemented: true,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_readback: false,
    backlog_policy_canonical_write_executed: false,
    provider_runtime_execution_allowed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const row = await insertDispatchReadback(pool, { ctx, readbackResult, safety, createdBy });
  return {
    ok: true,
    dispatch_readback: sanitizeDispatchReadback(row || {
      dispatch_readback_id: "",
      ...ctx,
      dispatch_readback_status: "dispatch_readback_passed",
      dispatch_readback_policy_status: "ready_for_adapter_execution_gate",
      envelope_status: ctx.ledger_envelope_status,
      envelope_decision: ctx.ledger_decision,
      envelope_dispatch_allowed: ctx.ledger_dispatch_allowed,
      envelope_apply_allowed: ctx.ledger_apply_allowed,
      envelope_approval_required: ctx.ledger_approval_required,
      envelope_blocking_gap_count: ctx.ledger_blocking_gap_count,
      adapter_apply_executed: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      readback_result_json: JSON.stringify(readbackResult),
      safety_contract_json: JSON.stringify(safety),
      created_by: createdBy,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightCapabilityEnvelopeDispatchReadbacks({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["r.secrets_included = 0"];
  const params = [];
  const limit = Math.max(1, Math.min(Number.parseInt(body.limit, 10) || 25, 100));
  for (const [inputKey, columnName] of [
    ["dispatch_readback_id", "r.dispatch_readback_id"],
    ["approval_decision_id", "r.approval_decision_id"],
    ["actual_request_id", "r.actual_request_id"],
    ["actual_capability_envelope_id", "r.actual_capability_envelope_id"],
    ["promotion_id", "r.promotion_id"],
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
       FROM session_insight_capability_envelope_dispatch_readbacks r
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at DESC, r.dispatch_readback_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT dispatch_readback_status, dispatch_readback_policy_status, adapter_apply_executed, execution_allowed, target_write_allowed, COUNT(*) AS count
       FROM session_insight_capability_envelope_dispatch_readbacks
      WHERE secrets_included = 0
      GROUP BY dispatch_readback_status, dispatch_readback_policy_status, adapter_apply_executed, execution_allowed, target_write_allowed
      ORDER BY dispatch_readback_status, dispatch_readback_policy_status`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_capability_envelope_dispatch_readback_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    dispatch_readbacks: rows.map(sanitizeDispatchReadback),
    summary: summaryRows.map((row) => ({
      dispatch_readback_status: row.dispatch_readback_status,
      dispatch_readback_policy_status: row.dispatch_readback_policy_status,
      adapter_apply_executed: boolValue(row.adapter_apply_executed),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    dispatch_readback_policy: {
      readback_only: true,
      ready_for_adapter_execution_gate: true,
      adapter_execution_gate_not_implemented: true,
      adapter_apply_executed: false,
      execution_allowed: false,
      target_write_allowed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
