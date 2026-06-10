import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const REVIEW_STATUSES = new Set(["request_review_required", "request_approved", "request_rejected"]);

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

function requestGateId() {
  return `capability_request_gate_${randomUUID()}`;
}

function assertCapabilityPlanId(input = {}) {
  const value = cleanString(input.capability_plan_id || input.capabilityPlanId);
  if (!value) {
    const err = new Error("capability_plan_id is required.");
    err.status = 400;
    err.code = "capability_plan_id_required";
    throw err;
  }
  return value;
}

function sanitizeRequestGate(row = {}) {
  return {
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
    request_gate_status: row.request_gate_status,
    request_review_status: row.request_review_status,
    request_policy_status: row.request_policy_status,
    actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
    actual_capability_envelope_id: row.actual_capability_envelope_id || null,
    approval_hold_created: boolValue(row.approval_hold_created),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    request_payload_json: parseMaybeJson(row.request_payload_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readCapabilityPlan(pool, capabilityPlanId) {
  const [rows] = await pool.query(
    `SELECT p.*
       FROM session_insight_capability_envelope_plans p
      WHERE p.capability_plan_id = ?
        AND p.secrets_included = 0
      LIMIT 1`,
    [capabilityPlanId]
  );
  return rows[0] || null;
}

function buildRequestPayload(plan = {}, requestedBy = "session_insight_capability_envelope_request_gate_tool") {
  const planJson = parseMaybeJson(plan.plan_json, {});
  return {
    mode: "platform_managed_fallback",
    source: "session_insight_capability_envelope_plan",
    requested_by: requestedBy,
    app_key: planJson.app_key || "session_insight",
    capability_key: plan.capability_key,
    operation_intent: plan.operation_intent,
    runtime_surface: plan.runtime_surface,
    workspace_key: planJson.workspace_key || "session_insight_apply_readiness",
    payload_preview_id: plan.payload_preview_id,
    apply_request_id: plan.apply_request_id,
    promotion_id: plan.promotion_id,
    insight_id: plan.insight_id,
    target_surface: plan.target_surface,
    promotion_type: plan.promotion_type,
    adapter_key: plan.adapter_key,
    contract_key: plan.contract_key,
    request_gate_review_required: true,
    actual_capability_envelope_requested: false,
    actual_capability_envelope_approved: false,
    approval_hold_created: false,
    execution_allowed: false,
    target_write_allowed: false,
    secrets_included: false,
  };
}

export async function createSessionInsightCapabilityEnvelopeRequestGate({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const capabilityPlanId = assertCapabilityPlanId(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_capability_envelope_request_gate_tool");
  const plan = await readCapabilityPlan(pool, capabilityPlanId);
  if (!plan) {
    const err = new Error("capability envelope plan was not found.");
    err.status = 404;
    err.code = "capability_plan_not_found";
    throw err;
  }
  if (plan.plan_status !== "planned_not_requested") {
    const err = new Error("capability envelope plan is not in planned_not_requested state.");
    err.status = 409;
    err.code = "capability_plan_not_request_gate_ready";
    err.details = { plan_status: plan.plan_status };
    throw err;
  }
  if (plan.gate_status !== "ready_but_blocked_requires_capability_envelope_and_apply_adapter") {
    const err = new Error("capability envelope plan source gate is not ready-but-blocked.");
    err.status = 409;
    err.code = "capability_plan_source_gate_not_ready";
    err.details = { gate_status: plan.gate_status };
    throw err;
  }
  if (boolValue(plan.actual_capability_envelope_requested) || plan.actual_capability_envelope_id || boolValue(plan.execution_allowed) || boolValue(plan.target_write_allowed)) {
    const err = new Error("capability plan claims envelope request or execution and cannot be gated.");
    err.status = 409;
    err.code = "capability_plan_claims_execution_or_envelope";
    throw err;
  }

  const requestPayload = buildRequestPayload(plan, createdBy);
  const safety = {
    request_gate_only: true,
    request_review_required: true,
    actual_capability_envelope_requested: false,
    actual_capability_envelope_approved: false,
    approval_hold_created: false,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_gate: false,
    backlog_policy_canonical_write_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const id = requestGateId();
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_request_gates
       (request_gate_id, capability_plan_id, payload_preview_id, apply_request_id, promotion_id, insight_id,
        target_surface, promotion_type, capability_key, operation_intent, runtime_surface,
        request_gate_status, request_review_status, request_policy_status,
        actual_capability_envelope_requested, actual_capability_envelope_id, approval_hold_created,
        execution_allowed, target_write_allowed, request_payload_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'request_gate_created_requires_review', 'request_review_required', 'blocked_until_request_gate_approved',
             0, NULL, 0, 0, 0, ?, ?, ?, 0)`,
    [
      id,
      plan.capability_plan_id,
      plan.payload_preview_id,
      plan.apply_request_id,
      plan.promotion_id,
      plan.insight_id,
      plan.target_surface,
      plan.promotion_type,
      plan.capability_key,
      plan.operation_intent,
      plan.runtime_surface,
      JSON.stringify(requestPayload),
      JSON.stringify(safety),
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_request_gates WHERE request_gate_id = ? LIMIT 1`,
    [id]
  );
  return {
    ok: true,
    request_gate: sanitizeRequestGate(rows[0] || {
      request_gate_id: id,
      capability_plan_id: plan.capability_plan_id,
      payload_preview_id: plan.payload_preview_id,
      apply_request_id: plan.apply_request_id,
      promotion_id: plan.promotion_id,
      insight_id: plan.insight_id,
      target_surface: plan.target_surface,
      promotion_type: plan.promotion_type,
      capability_key: plan.capability_key,
      operation_intent: plan.operation_intent,
      runtime_surface: plan.runtime_surface,
      request_gate_status: "request_gate_created_requires_review",
      request_review_status: "request_review_required",
      request_policy_status: "blocked_until_request_gate_approved",
      actual_capability_envelope_requested: 0,
      approval_hold_created: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      request_payload_json: JSON.stringify(requestPayload),
      safety_contract_json: JSON.stringify(safety),
      created_by: createdBy,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightCapabilityEnvelopeRequestGates({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["g.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);
  for (const [inputKey, columnName] of [
    ["request_gate_id", "g.request_gate_id"],
    ["capability_plan_id", "g.capability_plan_id"],
    ["payload_preview_id", "g.payload_preview_id"],
    ["apply_request_id", "g.apply_request_id"],
    ["promotion_id", "g.promotion_id"],
    ["target_surface", "g.target_surface"],
    ["capability_key", "g.capability_key"],
    ["request_review_status", "g.request_review_status"],
  ]) {
    const camelKey = inputKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = cleanString(body[inputKey] || body[camelKey]);
    if (value) {
      if (inputKey === "request_review_status" && !REVIEW_STATUSES.has(value)) {
        const err = new Error("request_review_status is not allowed.");
        err.status = 400;
        err.code = "invalid_request_review_status";
        throw err;
      }
      where.push(`${columnName} = ?`);
      params.push(value);
    }
  }
  params.push(limit);
  const [rows] = await pool.query(
    `SELECT g.*
       FROM session_insight_capability_envelope_request_gates g
      WHERE ${where.join(" AND ")}
      ORDER BY FIELD(g.request_review_status,'request_review_required','request_approved','request_rejected'), g.created_at DESC, g.request_gate_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT request_gate_status, request_review_status, request_policy_status,
            actual_capability_envelope_requested, approval_hold_created, execution_allowed, target_write_allowed,
            COUNT(*) AS count
       FROM session_insight_capability_envelope_request_gates
      WHERE secrets_included = 0
      GROUP BY request_gate_status, request_review_status, request_policy_status,
               actual_capability_envelope_requested, approval_hold_created, execution_allowed, target_write_allowed
      ORDER BY request_review_status, request_gate_status`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_capability_envelope_request_gate_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    request_gates: rows.map(sanitizeRequestGate),
    summary: summaryRows.map((row) => ({
      request_gate_status: row.request_gate_status,
      request_review_status: row.request_review_status,
      request_policy_status: row.request_policy_status,
      actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
      approval_hold_created: boolValue(row.approval_hold_created),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    request_gate_policy: {
      request_gate_only: true,
      creates_actual_capability_envelope: false,
      creates_approval_hold: false,
      adapter_apply_executed: false,
      execution_allowed: false,
      target_write_allowed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
