import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { approveCapabilityResolutionEnvelope } from "./scripts/capability-resolution-envelope-approve.mjs";

const REQUIRED_TYPED_CONFIRM = "APPROVE_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION";

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function boundedInt(value, fallback, min = 5, max = 1440) {
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

function approvalDecisionId() {
  return `capability_approval_decision_${randomUUID()}`;
}

function assertTypedConfirm(input = {}) {
  const typedConfirm = cleanString(input.typed_confirm || input.typedConfirm);
  if (typedConfirm !== REQUIRED_TYPED_CONFIRM) {
    const err = new Error(`typed_confirm must equal ${REQUIRED_TYPED_CONFIRM}.`);
    err.status = 400;
    err.code = "capability_envelope_approval_typed_confirm_required";
    throw err;
  }
  return typedConfirm;
}

function assertActualRequestId(input = {}) {
  const value = cleanString(input.actual_request_id || input.actualRequestId);
  if (!value) {
    const err = new Error("actual_request_id is required.");
    err.status = 400;
    err.code = "actual_request_id_required";
    throw err;
  }
  return value;
}

function sanitizeApprovalDecision(row = {}) {
  return {
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
    approval_decision_status: row.approval_decision_status,
    approval_policy_status: row.approval_policy_status,
    approval_hold_created: boolValue(row.approval_hold_created),
    approval_hold_id: row.approval_hold_id || null,
    envelope_status_after_approval: row.envelope_status_after_approval || null,
    envelope_decision_after_approval: row.envelope_decision_after_approval || null,
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    adapter_apply_executed: boolValue(row.adapter_apply_executed),
    approval_result_json: parseMaybeJson(row.approval_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    typed_confirm: row.typed_confirm,
    approved_by: row.approved_by || null,
    approval_notes: row.approval_notes || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readActualRequestContext(pool, actualRequestId) {
  const [rows] = await pool.query(
    `SELECT r.*,
            e.envelope_status AS ledger_envelope_status,
            e.decision AS ledger_decision,
            e.dispatch_allowed AS ledger_dispatch_allowed,
            e.apply_allowed AS ledger_apply_allowed,
            e.approval_required AS ledger_approval_required,
            e.blocking_gap_count AS ledger_blocking_gap_count,
            e.secrets_included AS ledger_secrets_included
       FROM session_insight_capability_envelope_actual_requests r
       LEFT JOIN capability_resolution_envelope_ledger e
         ON e.envelope_id = r.actual_capability_envelope_id
      WHERE r.actual_request_id = ?
      LIMIT 1`,
    [actualRequestId]
  );
  return rows[0] || null;
}

async function countExistingApprovalDecision(pool, actualRequestId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM session_insight_capability_envelope_approval_decisions
      WHERE actual_request_id = ?
        AND secrets_included = 0
        AND approval_decision_status = 'actual_envelope_approved'`,
    [actualRequestId]
  );
  return Number(rows?.[0]?.count || 0);
}

function validateApprovalContext(ctx = {}) {
  const checks = {
    actual_request_envelope_requested: ctx.actual_request_status === "actual_envelope_requested" && ctx.actual_request_policy_status === "actual_envelope_requested_but_not_approved",
    actual_request_has_envelope: boolValue(ctx.actual_capability_envelope_requested) && Boolean(ctx.actual_capability_envelope_id),
    actual_request_no_execution: !boolValue(ctx.approval_hold_created) && !boolValue(ctx.execution_allowed) && !boolValue(ctx.target_write_allowed),
    envelope_ready_requires_approval: ctx.ledger_envelope_status === "ready_requires_approval" && ctx.ledger_decision === "ready_requires_approval",
    envelope_dispatch_allowed: boolValue(ctx.ledger_dispatch_allowed),
    envelope_approval_required: boolValue(ctx.ledger_approval_required),
    envelope_no_blocking_gaps: Number(ctx.ledger_blocking_gap_count || 0) === 0,
    no_secrets: !boolValue(ctx.secrets_included) && !boolValue(ctx.ledger_secrets_included),
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_for_capability_envelope_approval: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    source_actual_request_sha256: sha256Text(ctx.request_result_json),
    secrets_included: false,
  };
}

async function insertApprovalDecision(pool, { ctx, approvalResult, safety, typedConfirm, approvedBy, approvalNotes }) {
  const id = approvalDecisionId();
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_approval_decisions
       (approval_decision_id, actual_request_id, actual_request_preflight_id, dispatch_dry_run_id,
        request_gate_id, capability_plan_id, promotion_id, insight_id, capability_key, operation_intent,
        runtime_surface, actual_capability_envelope_id, approval_decision_status, approval_policy_status,
        approval_hold_created, approval_hold_id, envelope_status_after_approval, envelope_decision_after_approval,
        execution_allowed, target_write_allowed, adapter_apply_executed, source_actual_request_sha256,
        approval_result_json, safety_contract_json, typed_confirm, approved_by, approval_notes, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'actual_envelope_approved', 'approved_but_not_executed',
             1, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
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
      approvalResult.approval_hold_id || null,
      approvalResult.envelope_status,
      approvalResult.decision,
      sha256Text(ctx.request_result_json),
      JSON.stringify(approvalResult),
      JSON.stringify(safety),
      typedConfirm,
      approvedBy,
      approvalNotes || null,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_approval_decisions WHERE approval_decision_id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function decideSessionInsightCapabilityEnvelopeApproval({
  pool = getPool(),
  input = {},
  approvalTool = approveCapabilityResolutionEnvelope,
} = {}) {
  const body = input && typeof input === "object" ? input : {};
  const typedConfirm = assertTypedConfirm(body);
  const actualRequestId = assertActualRequestId(body);
  const approvedBy = cleanString(body.approved_by || body.approvedBy, "session_insight_capability_envelope_approval_tool");
  const approvalNotes = cleanString(body.approval_notes || body.approvalNotes || body.decision_notes || body.decisionNotes);
  const ttlMinutes = boundedInt(body.ttl_minutes || body.ttlMinutes, 120, 5, 1440);
  const ctx = await readActualRequestContext(pool, actualRequestId);
  if (!ctx) {
    const err = new Error("actual capability envelope request was not found.");
    err.status = 404;
    err.code = "actual_request_not_found";
    throw err;
  }
  const existing = await countExistingApprovalDecision(pool, actualRequestId);
  if (existing > 0) {
    const err = new Error("capability envelope approval decision already exists for this actual request.");
    err.status = 409;
    err.code = "capability_envelope_approval_decision_already_exists";
    err.details = { actual_request_id: actualRequestId, existing_count: existing, secrets_included: false };
    throw err;
  }
  const validation = validateApprovalContext(ctx);
  if (!validation.valid_for_capability_envelope_approval) {
    const err = new Error("capability envelope approval validation failed.");
    err.status = 409;
    err.code = "capability_envelope_approval_validation_failed";
    err.details = validation;
    throw err;
  }
  const approvalResult = await approvalTool({
    envelopeId: ctx.actual_capability_envelope_id,
    approvedBy,
    decisionNote: approvalNotes || "Approved through session insight capability envelope approval gate.",
    ttlMinutes,
  });
  const acceptableApproval = approvalResult?.ok === true
    && approvalResult.envelope_id === ctx.actual_capability_envelope_id
    && approvalResult.envelope_status === "ready_for_dispatch"
    && approvalResult.decision === "ready_for_dispatch"
    && approvalResult.approval_hold_id
    && approvalResult.secrets_included === false;
  if (!acceptableApproval) {
    const err = new Error("capability envelope approval did not produce a ready_for_dispatch envelope.");
    err.status = 409;
    err.code = "capability_envelope_approval_not_dispatch_ready";
    err.details = { approval_result: approvalResult, secrets_included: false };
    throw err;
  }
  const safety = {
    approval_gate_only: true,
    actual_request_id: actualRequestId,
    actual_capability_envelope_id: ctx.actual_capability_envelope_id,
    approval_hold_created: true,
    approval_hold_id: approvalResult.approval_hold_id,
    envelope_status_after_approval: approvalResult.envelope_status,
    envelope_decision_after_approval: approvalResult.decision,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_approval: false,
    backlog_policy_canonical_write_executed: false,
    provider_runtime_execution_allowed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const row = await insertApprovalDecision(pool, { ctx, approvalResult, safety, typedConfirm, approvedBy, approvalNotes });
  return {
    ok: true,
    approval_decision: sanitizeApprovalDecision(row || {
      approval_decision_id: "",
      ...ctx,
      approval_decision_status: "actual_envelope_approved",
      approval_policy_status: "approved_but_not_executed",
      approval_hold_created: 1,
      approval_hold_id: approvalResult.approval_hold_id,
      envelope_status_after_approval: approvalResult.envelope_status,
      envelope_decision_after_approval: approvalResult.decision,
      execution_allowed: 0,
      target_write_allowed: 0,
      adapter_apply_executed: 0,
      approval_result_json: JSON.stringify(approvalResult),
      safety_contract_json: JSON.stringify(safety),
      typed_confirm: typedConfirm,
      approved_by: approvedBy,
      approval_notes: approvalNotes,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightCapabilityEnvelopeApprovals({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["d.secrets_included = 0"];
  const params = [];
  const limit = Math.max(1, Math.min(Number.parseInt(body.limit, 10) || 25, 100));
  for (const [inputKey, columnName] of [
    ["approval_decision_id", "d.approval_decision_id"],
    ["actual_request_id", "d.actual_request_id"],
    ["actual_capability_envelope_id", "d.actual_capability_envelope_id"],
    ["promotion_id", "d.promotion_id"],
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
    `SELECT d.*
       FROM session_insight_capability_envelope_approval_decisions d
      WHERE ${where.join(" AND ")}
      ORDER BY d.created_at DESC, d.approval_decision_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT approval_decision_status, approval_policy_status, approval_hold_created, execution_allowed, target_write_allowed, adapter_apply_executed, COUNT(*) AS count
       FROM session_insight_capability_envelope_approval_decisions
      WHERE secrets_included = 0
      GROUP BY approval_decision_status, approval_policy_status, approval_hold_created, execution_allowed, target_write_allowed, adapter_apply_executed
      ORDER BY approval_decision_status, approval_policy_status`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_capability_envelope_approval_decision_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    approval_decisions: rows.map(sanitizeApprovalDecision),
    summary: summaryRows.map((row) => ({
      approval_decision_status: row.approval_decision_status,
      approval_policy_status: row.approval_policy_status,
      approval_hold_created: boolValue(row.approval_hold_created),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      adapter_apply_executed: boolValue(row.adapter_apply_executed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    approval_policy: {
      requires_typed_confirm: REQUIRED_TYPED_CONFIRM,
      may_create_approval_hold: true,
      adapter_apply_executed: false,
      execution_allowed: false,
      target_write_allowed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
