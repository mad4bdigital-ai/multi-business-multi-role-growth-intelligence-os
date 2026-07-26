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

function planId() {
  return `capability_plan_${randomUUID()}`;
}

function assertGateRef(input = {}) {
  const payloadPreviewId = cleanString(input.payload_preview_id || input.payloadPreviewId);
  const applyRequestId = cleanString(input.apply_request_id || input.applyRequestId);
  if (!payloadPreviewId && !applyRequestId) {
    const err = new Error("payload_preview_id or apply_request_id is required.");
    err.status = 400;
    err.code = "capability_plan_gate_reference_required";
    throw err;
  }
  return { payloadPreviewId, applyRequestId };
}

function capabilityKeyForGate(gate = {}) {
  if (gate.target_surface === "development_backlog") return "session_insight_development_backlog_apply";
  if (gate.target_surface === "integration_backlog") return "session_insight_integration_backlog_apply";
  if (gate.target_surface === "runtime_repair_backlog") return "session_insight_runtime_repair_backlog_apply";
  return `session_insight_${String(gate.target_surface || "unknown").replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}_apply`;
}

function operationIntentForGate(gate = {}) {
  return cleanString(gate.promotion_type, "session_insight_apply");
}

function runtimeSurfaceForGate(gate = {}) {
  return cleanString(gate.target_surface, "session_insight_target_surface");
}

function workspaceKeyForGate(gate = {}) {
  const evidence = parseMaybeJson(gate.readiness_evidence_json, {});
  return cleanString(evidence?.workspace_key || evidence?.workspaceKey || "session_insight_apply_readiness");
}

function buildPlanPayload(gate = {}, requestedBy = "session_insight_capability_envelope_plan_tool") {
  const capabilityKey = capabilityKeyForGate(gate);
  const operationIntent = operationIntentForGate(gate);
  const runtimeSurface = runtimeSurfaceForGate(gate);
  return {
    suggested_source_tier: "platform_managed_fallback",
    requested_by: requestedBy,
    app_key: "session_insight",
    capability_key: capabilityKey,
    operation_intent: operationIntent,
    runtime_surface: runtimeSurface,
    workspace_key: workspaceKeyForGate(gate),
    payload_preview_id: gate.payload_preview_id,
    apply_request_id: gate.apply_request_id,
    promotion_id: gate.promotion_id,
    insight_id: gate.insight_id,
    target_surface: gate.target_surface,
    promotion_type: gate.promotion_type,
    adapter_key: gate.adapter_key,
    contract_key: gate.contract_key,
    required_before_any_apply: true,
    actual_capability_envelope_requested: false,
    actual_capability_envelope_approved: false,
    execution_allowed: false,
    target_write_allowed: false,
    secrets_included: false,
  };
}

function sanitizePlan(row = {}) {
  return {
    capability_plan_id: row.capability_plan_id,
    payload_preview_id: row.payload_preview_id,
    apply_request_id: row.apply_request_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    target_surface: row.target_surface,
    promotion_type: row.promotion_type,
    adapter_key: row.adapter_key || null,
    contract_key: row.contract_key || null,
    plan_status: row.plan_status,
    gate_status: row.gate_status,
    capability_key: row.capability_key,
    operation_intent: row.operation_intent,
    runtime_surface: row.runtime_surface,
    actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
    actual_capability_envelope_id: row.actual_capability_envelope_id || null,
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    plan_json: parseMaybeJson(row.plan_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readGateRow(pool, { payloadPreviewId, applyRequestId }) {
  const where = payloadPreviewId ? "payload_preview_id = ?" : "apply_request_id = ?";
  const param = payloadPreviewId || applyRequestId;
  const [rows] = await pool.query(
    `SELECT *
       FROM v_session_insight_adapter_apply_readiness_gate
      WHERE ${where}
        AND secrets_included = 0
      LIMIT 1`,
    [param]
  );
  return rows[0] || null;
}

export async function createSessionInsightCapabilityEnvelopePlan({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const ref = assertGateRef(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_capability_envelope_plan_tool");
  const gate = await readGateRow(pool, ref);
  if (!gate) {
    const err = new Error("adapter apply readiness gate row was not found.");
    err.status = 404;
    err.code = "adapter_apply_readiness_gate_not_found";
    throw err;
  }
  if (gate.gate_status !== "ready_but_blocked_requires_capability_envelope_and_apply_adapter") {
    const err = new Error("gate is not ready for capability envelope planning.");
    err.status = 409;
    err.code = "gate_not_ready_for_capability_plan";
    err.details = { gate_status: gate.gate_status };
    throw err;
  }
  if (boolValue(gate.execution_allowed) || boolValue(gate.target_write_allowed) || boolValue(gate.promotion_allowed)) {
    const err = new Error("gate source claims execution or target write and cannot be planned.");
    err.status = 409;
    err.code = "capability_plan_source_execution_claim";
    throw err;
  }

  const plan = buildPlanPayload(gate, createdBy);
  const safety = {
    capability_plan_only: true,
    actual_capability_envelope_requested: false,
    actual_capability_envelope_approved: false,
    approval_hold_created: false,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_plan: false,
    backlog_policy_canonical_write_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const id = planId();
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_plans
       (capability_plan_id, payload_preview_id, apply_request_id, promotion_id, insight_id,
        target_surface, promotion_type, adapter_key, contract_key, plan_status, gate_status,
        capability_key, operation_intent, runtime_surface,
        actual_capability_envelope_requested, actual_capability_envelope_id,
        execution_allowed, target_write_allowed, plan_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned_not_requested', ?, ?, ?, ?, 0, NULL, 0, 0, ?, ?, ?, 0)`,
    [
      id,
      gate.payload_preview_id,
      gate.apply_request_id,
      gate.promotion_id,
      gate.insight_id,
      gate.target_surface,
      gate.promotion_type,
      gate.adapter_key,
      gate.contract_key,
      gate.gate_status,
      plan.capability_key,
      plan.operation_intent,
      plan.runtime_surface,
      JSON.stringify(plan),
      JSON.stringify(safety),
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_plans WHERE capability_plan_id = ? LIMIT 1`,
    [id]
  );
  return {
    ok: true,
    capability_plan: sanitizePlan(rows[0] || {
      capability_plan_id: id,
      payload_preview_id: gate.payload_preview_id,
      apply_request_id: gate.apply_request_id,
      promotion_id: gate.promotion_id,
      insight_id: gate.insight_id,
      target_surface: gate.target_surface,
      promotion_type: gate.promotion_type,
      adapter_key: gate.adapter_key,
      contract_key: gate.contract_key,
      plan_status: "planned_not_requested",
      gate_status: gate.gate_status,
      capability_key: plan.capability_key,
      operation_intent: plan.operation_intent,
      runtime_surface: plan.runtime_surface,
      actual_capability_envelope_requested: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      plan_json: JSON.stringify(plan),
      safety_contract_json: JSON.stringify(safety),
      created_by: createdBy,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightCapabilityEnvelopePlans({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["p.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);
  for (const [inputKey, columnName] of [
    ["capability_plan_id", "p.capability_plan_id"],
    ["payload_preview_id", "p.payload_preview_id"],
    ["apply_request_id", "p.apply_request_id"],
    ["promotion_id", "p.promotion_id"],
    ["target_surface", "p.target_surface"],
    ["capability_key", "p.capability_key"],
    ["plan_status", "p.plan_status"],
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
    `SELECT p.*
       FROM session_insight_capability_envelope_plans p
      WHERE ${where.join(" AND ")}
      ORDER BY p.created_at DESC, p.capability_plan_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT plan_status, target_surface, actual_capability_envelope_requested, execution_allowed, target_write_allowed, COUNT(*) AS count
       FROM session_insight_capability_envelope_plans
      WHERE secrets_included = 0
      GROUP BY plan_status, target_surface, actual_capability_envelope_requested, execution_allowed, target_write_allowed
      ORDER BY plan_status, target_surface`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_capability_envelope_plan_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    capability_plans: rows.map(sanitizePlan),
    summary: summaryRows.map((row) => ({
      plan_status: row.plan_status,
      target_surface: row.target_surface,
      actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    plan_policy: {
      plan_only: true,
      actual_capability_envelope_requested: false,
      adapter_apply_executed: false,
      execution_allowed: false,
      target_write_allowed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
