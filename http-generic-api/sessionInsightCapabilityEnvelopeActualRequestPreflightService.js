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

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function boolValue(value) {
  return Number(value || 0) === 1 || value === true;
}

function sha256Text(value = "") {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function actualRequestPreflightId() {
  return `capability_actual_request_preflight_${randomUUID()}`;
}

function assertDispatchDryRunId(input = {}) {
  const value = cleanString(input.dispatch_dry_run_id || input.dispatchDryRunId);
  if (!value) {
    const err = new Error("dispatch_dry_run_id is required.");
    err.status = 400;
    err.code = "dispatch_dry_run_id_required";
    throw err;
  }
  return value;
}

function sanitizePreflight(row = {}) {
  return {
    actual_request_preflight_id: row.actual_request_preflight_id,
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
    preflight_status: row.preflight_status,
    preflight_policy_status: row.preflight_policy_status,
    actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
    actual_capability_envelope_id: row.actual_capability_envelope_id || null,
    approval_hold_created: boolValue(row.approval_hold_created),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    source_dispatch_payload_sha256: row.source_dispatch_payload_sha256,
    source_validation_sha256: row.source_validation_sha256,
    duplicate_live_envelope_count: Number(row.duplicate_live_envelope_count || 0),
    preflight_result_json: parseMaybeJson(row.preflight_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readDispatchDryRun(pool, dispatchDryRunId) {
  const [rows] = await pool.query(
    `SELECT d.*,
            g.request_review_status,
            g.request_policy_status,
            g.secrets_included AS request_gate_secrets_included,
            p.decision_status AS promotion_decision_status,
            p.approval_status AS promotion_approval_status,
            p.promotion_status,
            p.promotion_allowed,
            p.secrets_included AS promotion_secrets_included
       FROM session_insight_capability_envelope_dispatch_dry_runs d
       JOIN session_insight_capability_envelope_request_gates g
         ON g.request_gate_id = d.request_gate_id
       LEFT JOIN session_insight_promotions p
         ON p.promotion_id = d.promotion_id
      WHERE d.dispatch_dry_run_id = ?
      LIMIT 1`,
    [dispatchDryRunId]
  );
  return rows[0] || null;
}

async function countDuplicateLiveEnvelope(pool, dispatch = {}, payload = {}) {
  const appKey = cleanString(payload.app_key, "session_insight");
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM capability_resolution_envelope_ledger
      WHERE secrets_included = 0
        AND app_key = ?
        AND capability_key = ?
        AND operation_intent = ?
        AND envelope_status IN ('ready_requires_approval','ready_for_dispatch')
        AND execution_status IN ('not_executed','referenced')
        AND (expires_at IS NULL OR expires_at > NOW())
        AND JSON_UNQUOTE(JSON_EXTRACT(envelope_json, '$.request_context.promotion_id')) = ?`,
    [appKey, dispatch.capability_key, dispatch.operation_intent, dispatch.promotion_id]
  );
  return Number(rows?.[0]?.count || 0);
}

function validateActualRequestPreflight(dispatch = {}, payload = {}, validation = {}, duplicateLiveEnvelopeCount = 0) {
  const checks = {
    dispatch_dry_run_approved: dispatch.dispatch_review_status === "dispatch_dry_run_approved",
    dispatch_policy_not_dispatched: dispatch.dispatch_policy_status === "dispatch_dry_run_approved_but_not_dispatched",
    dispatch_dry_run_generated: dispatch.dispatch_status === "dispatch_dry_run_generated" && dispatch.dispatch_mode === "dry_run_no_dispatch",
    source_request_gate_approved: dispatch.request_review_status === "request_approved" && dispatch.request_policy_status === "request_approved_but_not_dispatched",
    source_promotion_ready: dispatch.promotion_decision_status === "approved" && dispatch.promotion_approval_status === "approved" && dispatch.promotion_status === "ready" && !boolValue(dispatch.promotion_allowed),
    source_payload_unchanged_and_dry_run_only: payload.dispatch_not_called === true && payload.actual_capability_envelope_requested === false && payload.approval_hold_created === false && payload.adapter_apply_executed === false,
    source_validation_passed: validation.valid_for_dispatch_dry_run === true,
    no_duplicate_live_envelope: Number(duplicateLiveEnvelopeCount || 0) === 0,
    no_actual_envelope_request: !boolValue(dispatch.actual_capability_envelope_requested) && !dispatch.actual_capability_envelope_id,
    no_approval_hold_created: !boolValue(dispatch.approval_hold_created),
    execution_disabled: !boolValue(dispatch.execution_allowed),
    target_write_disabled: !boolValue(dispatch.target_write_allowed),
    no_secrets: !boolValue(dispatch.secrets_included) && !boolValue(dispatch.request_gate_secrets_included) && !boolValue(dispatch.promotion_secrets_included) && payload.secrets_included === false,
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_for_actual_request_preflight: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    duplicate_live_envelope_count: Number(duplicateLiveEnvelopeCount || 0),
    preflight_only: true,
    actual_capability_envelope_requested: false,
    approval_hold_created: false,
    adapter_apply_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    secrets_included: false,
  };
}

export async function createSessionInsightCapabilityEnvelopeActualRequestPreflight({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const dispatchDryRunId = assertDispatchDryRunId(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_capability_actual_request_preflight_tool");
  const dispatch = await readDispatchDryRun(pool, dispatchDryRunId);
  if (!dispatch) {
    const err = new Error("capability envelope dispatch dry-run was not found.");
    err.status = 404;
    err.code = "capability_dispatch_dry_run_not_found";
    throw err;
  }

  const payload = parseMaybeJson(dispatch.dispatch_payload_json, {});
  const validationJson = parseMaybeJson(dispatch.validation_result_json, {});
  const duplicateLiveEnvelopeCount = await countDuplicateLiveEnvelope(pool, dispatch, payload);
  const preflightResult = validateActualRequestPreflight(dispatch, payload, validationJson, duplicateLiveEnvelopeCount);
  if (!preflightResult.valid_for_actual_request_preflight) {
    const err = new Error("actual capability envelope request preflight failed.");
    err.status = 409;
    err.code = "actual_capability_envelope_request_preflight_failed";
    err.details = preflightResult;
    throw err;
  }

  const safety = {
    actual_request_preflight_only: true,
    dispatch_dry_run_id: dispatch.dispatch_dry_run_id,
    request_gate_id: dispatch.request_gate_id,
    calls_capability_resolution: false,
    actual_capability_envelope_requested: false,
    actual_capability_envelope_id: null,
    approval_hold_created: false,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_preflight: false,
    backlog_policy_canonical_write_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const id = actualRequestPreflightId();
  const dispatchPayloadHash = sha256Text(dispatch.dispatch_payload_json);
  const validationHash = sha256Text(dispatch.validation_result_json);
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_actual_request_preflights
       (actual_request_preflight_id, dispatch_dry_run_id, request_gate_id, capability_plan_id, payload_preview_id,
        apply_request_id, promotion_id, insight_id, target_surface, promotion_type, capability_key, operation_intent, runtime_surface,
        preflight_status, preflight_policy_status, actual_capability_envelope_requested, actual_capability_envelope_id,
        approval_hold_created, execution_allowed, target_write_allowed,
        source_dispatch_payload_sha256, source_validation_sha256, duplicate_live_envelope_count,
        preflight_result_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'actual_request_preflight_passed', 'ready_for_actual_capability_envelope_request', 0, NULL, 0, 0, 0,
             ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      dispatch.dispatch_dry_run_id,
      dispatch.request_gate_id,
      dispatch.capability_plan_id,
      dispatch.payload_preview_id,
      dispatch.apply_request_id,
      dispatch.promotion_id,
      dispatch.insight_id,
      dispatch.target_surface,
      dispatch.promotion_type,
      dispatch.capability_key,
      dispatch.operation_intent,
      dispatch.runtime_surface,
      dispatchPayloadHash,
      validationHash,
      duplicateLiveEnvelopeCount,
      JSON.stringify(preflightResult),
      JSON.stringify(safety),
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_actual_request_preflights WHERE actual_request_preflight_id = ? LIMIT 1`,
    [id]
  );
  return {
    ok: true,
    actual_request_preflight: sanitizePreflight(rows[0] || {
      actual_request_preflight_id: id,
      dispatch_dry_run_id: dispatch.dispatch_dry_run_id,
      request_gate_id: dispatch.request_gate_id,
      capability_plan_id: dispatch.capability_plan_id,
      payload_preview_id: dispatch.payload_preview_id,
      apply_request_id: dispatch.apply_request_id,
      promotion_id: dispatch.promotion_id,
      insight_id: dispatch.insight_id,
      target_surface: dispatch.target_surface,
      promotion_type: dispatch.promotion_type,
      capability_key: dispatch.capability_key,
      operation_intent: dispatch.operation_intent,
      runtime_surface: dispatch.runtime_surface,
      preflight_status: "actual_request_preflight_passed",
      preflight_policy_status: "ready_for_actual_capability_envelope_request",
      actual_capability_envelope_requested: 0,
      approval_hold_created: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      source_dispatch_payload_sha256: dispatchPayloadHash,
      source_validation_sha256: validationHash,
      duplicate_live_envelope_count: duplicateLiveEnvelopeCount,
      preflight_result_json: JSON.stringify(preflightResult),
      safety_contract_json: JSON.stringify(safety),
      created_by: createdBy,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightCapabilityEnvelopeActualRequestPreflights({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["p.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);
  for (const [inputKey, columnName] of [
    ["actual_request_preflight_id", "p.actual_request_preflight_id"],
    ["dispatch_dry_run_id", "p.dispatch_dry_run_id"],
    ["request_gate_id", "p.request_gate_id"],
    ["capability_plan_id", "p.capability_plan_id"],
    ["promotion_id", "p.promotion_id"],
    ["preflight_status", "p.preflight_status"],
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
       FROM session_insight_capability_envelope_actual_request_preflights p
      WHERE ${where.join(" AND ")}
      ORDER BY p.created_at DESC, p.actual_request_preflight_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT preflight_status, preflight_policy_status, actual_capability_envelope_requested, approval_hold_created, execution_allowed, target_write_allowed, COUNT(*) AS count
       FROM session_insight_capability_envelope_actual_request_preflights
      WHERE secrets_included = 0
      GROUP BY preflight_status, preflight_policy_status, actual_capability_envelope_requested, approval_hold_created, execution_allowed, target_write_allowed
      ORDER BY preflight_status, preflight_policy_status`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_actual_preflight_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    actual_request_preflights: rows.map(sanitizePreflight),
    summary: summaryRows.map((row) => ({
      preflight_status: row.preflight_status,
      preflight_policy_status: row.preflight_policy_status,
      actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
      approval_hold_created: boolValue(row.approval_hold_created),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    actual_request_preflight_policy: {
      preflight_only: true,
      calls_capability_resolution: false,
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
