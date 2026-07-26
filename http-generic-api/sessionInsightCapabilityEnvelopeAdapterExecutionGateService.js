import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const REQUIRED_TYPED_CONFIRM = "OPEN_ADAPTER_EXECUTION_GATE_NO_APPLY";

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

function adapterExecutionGateId() {
  return `adapter_execution_gate_${randomUUID()}`;
}

function assertTypedConfirm(input = {}) {
  const typedConfirm = cleanString(input.typed_confirm || input.typedConfirm);
  if (typedConfirm !== REQUIRED_TYPED_CONFIRM) {
    const err = new Error(`typed_confirm must equal ${REQUIRED_TYPED_CONFIRM}.`);
    err.status = 400;
    err.code = "adapter_execution_gate_typed_confirm_required";
    throw err;
  }
  return typedConfirm;
}

function assertDispatchReadbackId(input = {}) {
  const value = cleanString(input.dispatch_readback_id || input.dispatchReadbackId);
  if (!value) {
    const err = new Error("dispatch_readback_id is required.");
    err.status = 400;
    err.code = "dispatch_readback_id_required";
    throw err;
  }
  return value;
}

function sanitizeAdapterExecutionGate(row = {}) {
  return {
    adapter_execution_gate_id: row.adapter_execution_gate_id,
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
    adapter_execution_gate_status: row.adapter_execution_gate_status,
    adapter_execution_policy_status: row.adapter_execution_policy_status,
    typed_confirm: row.typed_confirm,
    adapter_apply_requested: boolValue(row.adapter_apply_requested),
    adapter_apply_executed: boolValue(row.adapter_apply_executed),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    promotion_allowed: boolValue(row.promotion_allowed),
    gate_result_json: parseMaybeJson(row.gate_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readDispatchReadbackContext(pool, dispatchReadbackId) {
  const [rows] = await pool.query(
    `SELECT r.*,
            e.envelope_status AS ledger_envelope_status,
            e.decision AS ledger_decision,
            e.dispatch_allowed AS ledger_dispatch_allowed,
            e.blocking_gap_count AS ledger_blocking_gap_count,
            e.secrets_included AS ledger_secrets_included
       FROM session_insight_capability_envelope_dispatch_readbacks r
       LEFT JOIN capability_resolution_envelope_ledger e
         ON e.envelope_id = r.actual_capability_envelope_id
      WHERE r.dispatch_readback_id = ?
      LIMIT 1`,
    [dispatchReadbackId]
  );
  return rows[0] || null;
}

async function countExistingAdapterExecutionGate(pool, dispatchReadbackId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM session_insight_capability_envelope_adapter_execution_gates
      WHERE dispatch_readback_id = ?
        AND secrets_included = 0
        AND adapter_execution_gate_status = 'adapter_execution_gate_ready'`,
    [dispatchReadbackId]
  );
  return Number(rows?.[0]?.count || 0);
}

function validateAdapterExecutionGateContext(ctx = {}) {
  const checks = {
    dispatch_readback_passed: ctx.dispatch_readback_status === "dispatch_readback_passed",
    dispatch_readback_policy_ready: ctx.dispatch_readback_policy_status === "ready_for_adapter_execution_gate",
    readback_no_apply_or_execution: !boolValue(ctx.adapter_apply_executed) && !boolValue(ctx.execution_allowed) && !boolValue(ctx.target_write_allowed),
    envelope_ready_for_dispatch: ctx.envelope_status === "ready_for_dispatch" && ctx.envelope_decision === "ready_for_dispatch",
    ledger_ready_for_dispatch: ctx.ledger_envelope_status === "ready_for_dispatch" && ctx.ledger_decision === "ready_for_dispatch",
    ledger_dispatch_allowed: boolValue(ctx.ledger_dispatch_allowed),
    ledger_no_blocking_gaps: Number(ctx.ledger_blocking_gap_count || 0) === 0,
    no_secrets: !boolValue(ctx.secrets_included) && !boolValue(ctx.ledger_secrets_included),
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_for_adapter_execution_gate: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    source_dispatch_readback_sha256: sha256Text(ctx.readback_result_json),
    adapter_execution_gate_only: true,
    adapter_apply_requested: false,
    adapter_apply_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed: false,
    secrets_included: false,
  };
}

async function insertAdapterExecutionGate(pool, { ctx, gateResult, safety, typedConfirm, createdBy }) {
  const id = adapterExecutionGateId();
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_adapter_execution_gates
       (adapter_execution_gate_id, dispatch_readback_id, approval_decision_id, actual_request_id,
        actual_request_preflight_id, dispatch_dry_run_id, request_gate_id, capability_plan_id,
        promotion_id, insight_id, capability_key, operation_intent, runtime_surface,
        actual_capability_envelope_id, adapter_execution_gate_status, adapter_execution_policy_status,
        typed_confirm, adapter_apply_requested, adapter_apply_executed, execution_allowed,
        target_write_allowed, promotion_allowed, source_dispatch_readback_sha256,
        gate_result_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'adapter_execution_gate_ready', 'ready_for_adapter_apply_dispatch',
             ?, 0, 0, 0, 0, 0, ?, ?, ?, ?, 0)`,
    [
      id,
      ctx.dispatch_readback_id,
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
      typedConfirm,
      sha256Text(ctx.readback_result_json),
      JSON.stringify(gateResult),
      JSON.stringify(safety),
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_adapter_execution_gates WHERE adapter_execution_gate_id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function createSessionInsightCapabilityEnvelopeAdapterExecutionGate({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const typedConfirm = assertTypedConfirm(body);
  const dispatchReadbackId = assertDispatchReadbackId(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_capability_adapter_execution_gate_tool");
  const ctx = await readDispatchReadbackContext(pool, dispatchReadbackId);
  if (!ctx) {
    const err = new Error("capability envelope dispatch readback was not found.");
    err.status = 404;
    err.code = "capability_envelope_dispatch_readback_not_found";
    throw err;
  }
  const existing = await countExistingAdapterExecutionGate(pool, dispatchReadbackId);
  if (existing > 0) {
    const err = new Error("adapter execution gate already exists for this dispatch readback.");
    err.status = 409;
    err.code = "adapter_execution_gate_already_exists";
    err.details = { dispatch_readback_id: dispatchReadbackId, existing_count: existing, secrets_included: false };
    throw err;
  }
  const gateResult = validateAdapterExecutionGateContext(ctx);
  if (!gateResult.valid_for_adapter_execution_gate) {
    const err = new Error("adapter execution gate validation failed.");
    err.status = 409;
    err.code = "adapter_execution_gate_validation_failed";
    err.details = gateResult;
    throw err;
  }
  const safety = {
    adapter_execution_gate_only: true,
    dispatch_readback_id: dispatchReadbackId,
    actual_capability_envelope_id: ctx.actual_capability_envelope_id,
    ready_for_adapter_apply_dispatch: true,
    adapter_apply_dispatch_not_implemented: true,
    adapter_apply_requested: false,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_gate: false,
    backlog_policy_canonical_write_executed: false,
    provider_runtime_execution_allowed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const row = await insertAdapterExecutionGate(pool, { ctx, gateResult, safety, typedConfirm, createdBy });
  return {
    ok: true,
    adapter_execution_gate: sanitizeAdapterExecutionGate(row || {
      adapter_execution_gate_id: "",
      ...ctx,
      adapter_execution_gate_status: "adapter_execution_gate_ready",
      adapter_execution_policy_status: "ready_for_adapter_apply_dispatch",
      typed_confirm: typedConfirm,
      adapter_apply_requested: 0,
      adapter_apply_executed: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      promotion_allowed: 0,
      gate_result_json: JSON.stringify(gateResult),
      safety_contract_json: JSON.stringify(safety),
      created_by: createdBy,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightCapabilityEnvelopeAdapterExecutionGates({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["g.secrets_included = 0"];
  const params = [];
  const limit = Math.max(1, Math.min(Number.parseInt(body.limit, 10) || 25, 100));
  for (const [inputKey, columnName] of [
    ["adapter_execution_gate_id", "g.adapter_execution_gate_id"],
    ["dispatch_readback_id", "g.dispatch_readback_id"],
    ["actual_request_id", "g.actual_request_id"],
    ["actual_capability_envelope_id", "g.actual_capability_envelope_id"],
    ["promotion_id", "g.promotion_id"],
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
    `SELECT g.*
       FROM session_insight_capability_envelope_adapter_execution_gates g
      WHERE ${where.join(" AND ")}
      ORDER BY g.created_at DESC, g.adapter_execution_gate_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT adapter_execution_gate_status, adapter_execution_policy_status, adapter_apply_requested, adapter_apply_executed, execution_allowed, target_write_allowed, promotion_allowed, COUNT(*) AS count
       FROM session_insight_capability_envelope_adapter_execution_gates
      WHERE secrets_included = 0
      GROUP BY adapter_execution_gate_status, adapter_execution_policy_status, adapter_apply_requested, adapter_apply_executed, execution_allowed, target_write_allowed, promotion_allowed
      ORDER BY adapter_execution_gate_status, adapter_execution_policy_status`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_adapter_gate_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    adapter_execution_gates: rows.map(sanitizeAdapterExecutionGate),
    summary: summaryRows.map((row) => ({
      adapter_execution_gate_status: row.adapter_execution_gate_status,
      adapter_execution_policy_status: row.adapter_execution_policy_status,
      adapter_apply_requested: boolValue(row.adapter_apply_requested),
      adapter_apply_executed: boolValue(row.adapter_apply_executed),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      promotion_allowed: boolValue(row.promotion_allowed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    adapter_execution_gate_policy: {
      requires_typed_confirm: REQUIRED_TYPED_CONFIRM,
      adapter_execution_gate_only: true,
      adapter_apply_dispatch_not_implemented: true,
      adapter_apply_requested: false,
      adapter_apply_executed: false,
      execution_allowed: false,
      target_write_allowed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
