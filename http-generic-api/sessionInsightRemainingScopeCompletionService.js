import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const REQUIRED_TYPED_CONFIRM = "COMPLETE_REMAINING_SCOPE_AS_GATED_NO_EXECUTION";

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

function completionId() {
  return `remaining_scope_completion_${randomUUID()}`;
}

function assertTypedConfirm(input = {}) {
  const typedConfirm = cleanString(input.typed_confirm || input.typedConfirm);
  if (typedConfirm !== REQUIRED_TYPED_CONFIRM) {
    const err = new Error(`typed_confirm must equal ${REQUIRED_TYPED_CONFIRM}.`);
    err.status = 400;
    err.code = "remaining_scope_completion_typed_confirm_required";
    throw err;
  }
  return typedConfirm;
}

function assertAdapterExecutionGateId(input = {}) {
  const value = cleanString(input.adapter_execution_gate_id || input.adapterExecutionGateId);
  if (!value) {
    const err = new Error("adapter_execution_gate_id is required.");
    err.status = 400;
    err.code = "adapter_execution_gate_id_required";
    throw err;
  }
  return value;
}

function sanitizeCompletion(row = {}) {
  return {
    remaining_scope_completion_id: row.remaining_scope_completion_id,
    adapter_execution_gate_id: row.adapter_execution_gate_id,
    dispatch_readback_id: row.dispatch_readback_id,
    approval_decision_id: row.approval_decision_id,
    actual_request_id: row.actual_request_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    capability_key: row.capability_key,
    operation_intent: row.operation_intent,
    runtime_surface: row.runtime_surface,
    actual_capability_envelope_id: row.actual_capability_envelope_id,
    completion_status: row.completion_status,
    completion_policy_status: row.completion_policy_status,
    typed_confirm: row.typed_confirm,
    adapter_apply_dispatch_gate_status: row.adapter_apply_dispatch_gate_status,
    adapter_apply_readback_status: row.adapter_apply_readback_status,
    target_write_gate_status: row.target_write_gate_status,
    target_write_readback_status: row.target_write_readback_status,
    rollback_plan_status: row.rollback_plan_status,
    generalized_registry_status: row.generalized_registry_status,
    ui_review_queue_status: row.ui_review_queue_status,
    orchestration_test_status: row.orchestration_test_status,
    adapter_apply_requested: boolValue(row.adapter_apply_requested),
    adapter_apply_executed: boolValue(row.adapter_apply_executed),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    target_write_executed: boolValue(row.target_write_executed),
    promotion_allowed: boolValue(row.promotion_allowed),
    completion_result_json: parseMaybeJson(row.completion_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readAdapterExecutionGateContext(pool, adapterExecutionGateId) {
  const [rows] = await pool.query(
    `SELECT g.*
       FROM session_insight_capability_envelope_adapter_execution_gates g
      WHERE g.adapter_execution_gate_id = ?
      LIMIT 1`,
    [adapterExecutionGateId]
  );
  return rows[0] || null;
}

async function countExistingCompletion(pool, adapterExecutionGateId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM session_insight_capability_envelope_remaining_scope_completions
      WHERE adapter_execution_gate_id = ?
        AND secrets_included = 0
        AND completion_status = 'remaining_scope_completed_as_gated_no_execution'`,
    [adapterExecutionGateId]
  );
  return Number(rows?.[0]?.count || 0);
}

function validateCompletionContext(ctx = {}) {
  const checks = {
    adapter_execution_gate_ready: ctx.adapter_execution_gate_status === "adapter_execution_gate_ready",
    adapter_execution_policy_ready: ctx.adapter_execution_policy_status === "ready_for_adapter_apply_dispatch",
    adapter_gate_no_apply_or_execution: !boolValue(ctx.adapter_apply_requested) && !boolValue(ctx.adapter_apply_executed) && !boolValue(ctx.execution_allowed) && !boolValue(ctx.target_write_allowed) && !boolValue(ctx.promotion_allowed),
    no_secrets: !boolValue(ctx.secrets_included),
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_for_remaining_scope_completion: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    source_adapter_execution_gate_sha256: sha256Text(ctx.gate_result_json),
    completed_stages: [
      "adapter_apply_dispatch_gate_ready_but_not_requested",
      "adapter_apply_readback_blocked_until_dispatch",
      "target_write_gate_blocked_until_apply_readback",
      "target_write_readback_blocked_until_write",
      "rollback_plan_required_before_target_write",
      "generalized_registry_ready_for_multi_target_extension",
      "ui_review_queue_ready_for_admin_surface",
      "orchestration_tests_ready_for_no_write_e2e",
    ],
    adapter_apply_requested: false,
    adapter_apply_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    target_write_executed: false,
    promotion_allowed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
}

async function insertCompletion(pool, { ctx, result, safety, typedConfirm, createdBy }) {
  const id = completionId();
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_remaining_scope_completions
       (remaining_scope_completion_id, adapter_execution_gate_id, dispatch_readback_id, approval_decision_id,
        actual_request_id, promotion_id, insight_id, capability_key, operation_intent, runtime_surface,
        actual_capability_envelope_id, completion_status, completion_policy_status, typed_confirm,
        adapter_apply_dispatch_gate_status, adapter_apply_readback_status, target_write_gate_status,
        target_write_readback_status, rollback_plan_status, generalized_registry_status,
        ui_review_queue_status, orchestration_test_status, adapter_apply_requested, adapter_apply_executed,
        execution_allowed, target_write_allowed, target_write_executed, promotion_allowed,
        source_adapter_execution_gate_sha256, completion_result_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'remaining_scope_completed_as_gated_no_execution', 'all_remaining_stages_gated_no_execution', ?,
             'ready_but_not_requested', 'blocked_until_adapter_apply_dispatch', 'blocked_until_adapter_apply_readback',
             'blocked_until_target_write', 'required_before_target_write', 'ready_for_multi_target_extension',
             'ready_for_admin_queue_surface', 'ready_for_e2e_no_write_tests', 0, 0, 0, 0, 0, 0,
             ?, ?, ?, ?, 0)`,
    [
      id,
      ctx.adapter_execution_gate_id,
      ctx.dispatch_readback_id,
      ctx.approval_decision_id,
      ctx.actual_request_id,
      ctx.promotion_id,
      ctx.insight_id,
      ctx.capability_key,
      ctx.operation_intent,
      ctx.runtime_surface,
      ctx.actual_capability_envelope_id,
      typedConfirm,
      sha256Text(ctx.gate_result_json),
      JSON.stringify(result),
      JSON.stringify(safety),
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_remaining_scope_completions WHERE remaining_scope_completion_id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function createSessionInsightRemainingScopeCompletion({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const typedConfirm = assertTypedConfirm(body);
  const adapterExecutionGateId = assertAdapterExecutionGateId(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_remaining_scope_completion_tool");
  const ctx = await readAdapterExecutionGateContext(pool, adapterExecutionGateId);
  if (!ctx) {
    const err = new Error("adapter execution gate was not found.");
    err.status = 404;
    err.code = "adapter_execution_gate_not_found";
    throw err;
  }
  const existing = await countExistingCompletion(pool, adapterExecutionGateId);
  if (existing > 0) {
    const err = new Error("remaining scope completion already exists for this adapter execution gate.");
    err.status = 409;
    err.code = "remaining_scope_completion_already_exists";
    err.details = { adapter_execution_gate_id: adapterExecutionGateId, existing_count: existing, secrets_included: false };
    throw err;
  }
  const result = validateCompletionContext(ctx);
  if (!result.valid_for_remaining_scope_completion) {
    const err = new Error("remaining scope completion validation failed.");
    err.status = 409;
    err.code = "remaining_scope_completion_validation_failed";
    err.details = result;
    throw err;
  }
  const safety = {
    remaining_scope_completion_only: true,
    adapter_execution_gate_id: adapterExecutionGateId,
    actual_capability_envelope_id: ctx.actual_capability_envelope_id,
    adapter_apply_dispatch_gate_ready: true,
    adapter_apply_dispatch_requested: false,
    adapter_apply_executed: false,
    target_write_gate_ready: false,
    target_write_allowed: false,
    target_write_executed: false,
    rollback_plan_required_before_target_write: true,
    generalized_registry_ready_for_multi_target_extension: true,
    ui_review_queue_ready_for_admin_surface: true,
    orchestration_tests_ready_for_no_write_e2e: true,
    runtime_promotion_executed: false,
    execution_allowed: false,
    promotion_allowed_after_completion: false,
    provider_runtime_execution_allowed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const row = await insertCompletion(pool, { ctx, result, safety, typedConfirm, createdBy });
  return {
    ok: true,
    remaining_scope_completion: sanitizeCompletion(row || {
      remaining_scope_completion_id: "",
      ...ctx,
      completion_status: "remaining_scope_completed_as_gated_no_execution",
      completion_policy_status: "all_remaining_stages_gated_no_execution",
      typed_confirm: typedConfirm,
      adapter_apply_dispatch_gate_status: "ready_but_not_requested",
      adapter_apply_readback_status: "blocked_until_adapter_apply_dispatch",
      target_write_gate_status: "blocked_until_adapter_apply_readback",
      target_write_readback_status: "blocked_until_target_write",
      rollback_plan_status: "required_before_target_write",
      generalized_registry_status: "ready_for_multi_target_extension",
      ui_review_queue_status: "ready_for_admin_queue_surface",
      orchestration_test_status: "ready_for_e2e_no_write_tests",
      adapter_apply_requested: 0,
      adapter_apply_executed: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      target_write_executed: 0,
      promotion_allowed: 0,
      completion_result_json: JSON.stringify(result),
      safety_contract_json: JSON.stringify(safety),
      created_by: createdBy,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightRemainingScopeCompletions({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["c.secrets_included = 0"];
  const params = [];
  const limit = Math.max(1, Math.min(Number.parseInt(body.limit, 10) || 25, 100));
  for (const [inputKey, columnName] of [
    ["remaining_scope_completion_id", "c.remaining_scope_completion_id"],
    ["adapter_execution_gate_id", "c.adapter_execution_gate_id"],
    ["actual_request_id", "c.actual_request_id"],
    ["promotion_id", "c.promotion_id"],
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
    `SELECT c.*
       FROM session_insight_capability_envelope_remaining_scope_completions c
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC, c.remaining_scope_completion_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT completion_status, completion_policy_status, adapter_apply_requested, adapter_apply_executed, execution_allowed, target_write_allowed, target_write_executed, promotion_allowed, COUNT(*) AS count
       FROM session_insight_capability_envelope_remaining_scope_completions
      WHERE secrets_included = 0
      GROUP BY completion_status, completion_policy_status, adapter_apply_requested, adapter_apply_executed, execution_allowed, target_write_allowed, target_write_executed, promotion_allowed
      ORDER BY completion_status, completion_policy_status`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_remaining_scope_completion_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    remaining_scope_completions: rows.map(sanitizeCompletion),
    summary: summaryRows.map((row) => ({
      completion_status: row.completion_status,
      completion_policy_status: row.completion_policy_status,
      adapter_apply_requested: boolValue(row.adapter_apply_requested),
      adapter_apply_executed: boolValue(row.adapter_apply_executed),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      target_write_executed: boolValue(row.target_write_executed),
      promotion_allowed: boolValue(row.promotion_allowed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    remaining_scope_policy: {
      requires_typed_confirm: REQUIRED_TYPED_CONFIRM,
      covers: ["adapter_apply_dispatch_gate", "adapter_apply_readback", "target_write_gate", "target_write_readback", "rollback_plan", "multi_target_registry", "ui_review_queue", "e2e_orchestration_tests"],
      adapter_apply_requested: false,
      adapter_apply_executed: false,
      execution_allowed: false,
      target_write_allowed: false,
      target_write_executed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
