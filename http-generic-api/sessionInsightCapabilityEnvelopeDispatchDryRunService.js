import { randomUUID } from "node:crypto";
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

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function boolValue(value) {
  return Number(value || 0) === 1 || value === true;
}

function dispatchDryRunId() {
  return `capability_dispatch_dry_run_${randomUUID()}`;
}

function assertRequestGateId(input = {}) {
  const value = cleanString(input.request_gate_id || input.requestGateId);
  if (!value) {
    const err = new Error("request_gate_id is required.");
    err.status = 400;
    err.code = "request_gate_id_required";
    throw err;
  }
  return value;
}

function sanitizeDispatch(row = {}) {
  return {
    dispatch_dry_run_id: row.dispatch_dry_run_id,
    request_gate_id: row.request_gate_id,
    capability_plan_id: row.capability_plan_id,
    payload_preview_id: row.payload_preview_id,
    apply_request_id: row.apply_request_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    target_surface: row.target_surface,
    promotion_type: row.promotion_type,
    capability_key: row.capability_key,
    operation_intent: row.operation_intent,
    runtime_surface: row.runtime_surface,
    dispatch_status: row.dispatch_status,
    dispatch_mode: row.dispatch_mode,
    actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
    actual_capability_envelope_id: row.actual_capability_envelope_id || null,
    approval_hold_created: boolValue(row.approval_hold_created),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    dispatch_payload_json: parseMaybeJson(row.dispatch_payload_json, null),
    validation_result_json: parseMaybeJson(row.validation_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readRequestGate(pool, requestGateId) {
  const [rows] = await pool.query(
    `SELECT *
       FROM session_insight_capability_envelope_request_gates
      WHERE request_gate_id = ?
        AND secrets_included = 0
      LIMIT 1`,
    [requestGateId]
  );
  return rows[0] || null;
}

function buildDryRunPayload(gate = {}, createdBy = "session_insight_capability_envelope_dispatch_dry_run_tool") {
  const requestPayload = parseMaybeJson(gate.request_payload_json, {});
  return {
    dry_run_only: true,
    dispatch_surface: "capability_resolution_envelope_create",
    dispatch_not_called: true,
    requested_by: createdBy,
    mode: requestPayload.mode || "platform_managed_fallback",
    app_key: requestPayload.app_key || "session_insight",
    capability_key: gate.capability_key,
    operation_intent: gate.operation_intent,
    runtime_surface: gate.runtime_surface,
    workspace_key: requestPayload.workspace_key || "session_insight_apply_readiness",
    request_gate_id: gate.request_gate_id,
    capability_plan_id: gate.capability_plan_id,
    payload_preview_id: gate.payload_preview_id,
    apply_request_id: gate.apply_request_id,
    promotion_id: gate.promotion_id,
    insight_id: gate.insight_id,
    target_surface: gate.target_surface,
    promotion_type: gate.promotion_type,
    actual_capability_envelope_requested: false,
    actual_capability_envelope_approved: false,
    actual_capability_envelope_id: null,
    approval_hold_created: false,
    adapter_apply_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    secrets_included: false,
  };
}

function validateDryRun(gate = {}, payload = {}) {
  const checks = {
    request_gate_approved: gate.request_review_status === "request_approved",
    request_gate_not_dispatched_policy: gate.request_policy_status === "request_approved_but_not_dispatched",
    no_actual_envelope_request: !boolValue(gate.actual_capability_envelope_requested) && !gate.actual_capability_envelope_id,
    no_approval_hold_created: !boolValue(gate.approval_hold_created),
    execution_disabled: !boolValue(gate.execution_allowed) && !boolValue(payload.execution_allowed),
    target_write_disabled: !boolValue(gate.target_write_allowed) && !boolValue(payload.target_write_allowed),
    dispatch_not_called: payload.dispatch_not_called === true,
    no_secrets: !boolValue(gate.secrets_included) && payload.secrets_included === false,
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_for_dispatch_dry_run: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    secrets_included: false,
  };
}

export async function createSessionInsightCapabilityEnvelopeDispatchDryRun({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const requestGateId = assertRequestGateId(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_capability_envelope_dispatch_dry_run_tool");
  const gate = await readRequestGate(pool, requestGateId);
  if (!gate) {
    const err = new Error("capability envelope request gate was not found.");
    err.status = 404;
    err.code = "capability_request_gate_not_found";
    throw err;
  }
  if (gate.request_review_status !== "request_approved" || gate.request_policy_status !== "request_approved_but_not_dispatched") {
    const err = new Error("request gate is not approved for dispatch dry-run.");
    err.status = 409;
    err.code = "capability_request_gate_not_dispatch_dry_run_ready";
    err.details = { request_review_status: gate.request_review_status, request_policy_status: gate.request_policy_status };
    throw err;
  }
  if (boolValue(gate.actual_capability_envelope_requested) || gate.actual_capability_envelope_id || boolValue(gate.approval_hold_created) || boolValue(gate.execution_allowed) || boolValue(gate.target_write_allowed)) {
    const err = new Error("request gate already claims dispatch, approval hold, execution, or target write.");
    err.status = 409;
    err.code = "capability_request_gate_claims_runtime_effect";
    throw err;
  }
  const payload = buildDryRunPayload(gate, createdBy);
  const validation = validateDryRun(gate, payload);
  if (!validation.valid_for_dispatch_dry_run) {
    const err = new Error("dispatch dry-run validation failed.");
    err.status = 409;
    err.code = "dispatch_dry_run_validation_failed";
    err.details = validation;
    throw err;
  }
  const safety = {
    dispatch_dry_run_only: true,
    actual_capability_envelope_requested: false,
    actual_capability_envelope_approved: false,
    actual_capability_envelope_id: null,
    approval_hold_created: false,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_dry_run: false,
    backlog_policy_canonical_write_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const id = dispatchDryRunId();
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_dispatch_dry_runs
       (dispatch_dry_run_id, request_gate_id, capability_plan_id, payload_preview_id, apply_request_id,
        promotion_id, insight_id, target_surface, promotion_type, capability_key, operation_intent, runtime_surface,
        dispatch_status, dispatch_mode, actual_capability_envelope_requested, actual_capability_envelope_id,
        approval_hold_created, execution_allowed, target_write_allowed,
        dispatch_payload_json, validation_result_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'dispatch_dry_run_generated', 'dry_run_no_dispatch', 0, NULL, 0, 0, 0, ?, ?, ?, ?, 0)`,
    [
      id,
      gate.request_gate_id,
      gate.capability_plan_id,
      gate.payload_preview_id,
      gate.apply_request_id,
      gate.promotion_id,
      gate.insight_id,
      gate.target_surface,
      gate.promotion_type,
      gate.capability_key,
      gate.operation_intent,
      gate.runtime_surface,
      JSON.stringify(payload),
      JSON.stringify(validation),
      JSON.stringify(safety),
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_dispatch_dry_runs WHERE dispatch_dry_run_id = ? LIMIT 1`,
    [id]
  );
  return {
    ok: true,
    dispatch_dry_run: sanitizeDispatch(rows[0] || {
      dispatch_dry_run_id: id,
      request_gate_id: gate.request_gate_id,
      capability_plan_id: gate.capability_plan_id,
      payload_preview_id: gate.payload_preview_id,
      apply_request_id: gate.apply_request_id,
      promotion_id: gate.promotion_id,
      insight_id: gate.insight_id,
      target_surface: gate.target_surface,
      promotion_type: gate.promotion_type,
      capability_key: gate.capability_key,
      operation_intent: gate.operation_intent,
      runtime_surface: gate.runtime_surface,
      dispatch_status: "dispatch_dry_run_generated",
      dispatch_mode: "dry_run_no_dispatch",
      actual_capability_envelope_requested: 0,
      approval_hold_created: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      dispatch_payload_json: JSON.stringify(payload),
      validation_result_json: JSON.stringify(validation),
      safety_contract_json: JSON.stringify(safety),
      created_by: createdBy,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightCapabilityEnvelopeDispatchDryRuns({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["d.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);
  for (const [inputKey, columnName] of [
    ["dispatch_dry_run_id", "d.dispatch_dry_run_id"],
    ["request_gate_id", "d.request_gate_id"],
    ["capability_plan_id", "d.capability_plan_id"],
    ["payload_preview_id", "d.payload_preview_id"],
    ["apply_request_id", "d.apply_request_id"],
    ["promotion_id", "d.promotion_id"],
    ["target_surface", "d.target_surface"],
    ["capability_key", "d.capability_key"],
    ["dispatch_status", "d.dispatch_status"],
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
       FROM session_insight_capability_envelope_dispatch_dry_runs d
      WHERE ${where.join(" AND ")}
      ORDER BY d.created_at DESC, d.dispatch_dry_run_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT dispatch_status, dispatch_mode, actual_capability_envelope_requested, approval_hold_created, execution_allowed, target_write_allowed, COUNT(*) AS count
       FROM session_insight_capability_envelope_dispatch_dry_runs
      WHERE secrets_included = 0
      GROUP BY dispatch_status, dispatch_mode, actual_capability_envelope_requested, approval_hold_created, execution_allowed, target_write_allowed
      ORDER BY dispatch_status, dispatch_mode`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_capability_envelope_dispatch_dry_run_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    dispatch_dry_runs: rows.map(sanitizeDispatch),
    summary: summaryRows.map((row) => ({
      dispatch_status: row.dispatch_status,
      dispatch_mode: row.dispatch_mode,
      actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
      approval_hold_created: boolValue(row.approval_hold_created),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    dispatch_dry_run_policy: {
      dry_run_only: true,
      actual_capability_envelope_requested: false,
      approval_hold_created: false,
      adapter_apply_executed: false,
      execution_allowed: false,
      target_write_allowed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
