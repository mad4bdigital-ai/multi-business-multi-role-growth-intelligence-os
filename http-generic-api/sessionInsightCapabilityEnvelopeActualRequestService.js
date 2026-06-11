import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { createCapabilityResolutionEnvelopeLedger } from "./scripts/capability-resolution-envelope-create.mjs";

const REQUIRED_TYPED_CONFIRM = "REQUEST_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION";

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function boundedInt(value, fallback, min = 5, max = 1440) {
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

function actualRequestId() {
  return `capability_actual_request_${randomUUID()}`;
}

function assertTypedConfirm(input = {}) {
  const typedConfirm = cleanString(input.typed_confirm || input.typedConfirm);
  if (typedConfirm !== REQUIRED_TYPED_CONFIRM) {
    const err = new Error(`typed_confirm must equal ${REQUIRED_TYPED_CONFIRM}.`);
    err.status = 400;
    err.code = "actual_capability_envelope_request_typed_confirm_required";
    throw err;
  }
  return typedConfirm;
}

function assertActualRequestPreflightId(input = {}) {
  const value = cleanString(input.actual_request_preflight_id || input.actualRequestPreflightId);
  if (!value) {
    const err = new Error("actual_request_preflight_id is required.");
    err.status = 400;
    err.code = "actual_request_preflight_id_required";
    throw err;
  }
  return value;
}

function sanitizeActualRequest(row = {}) {
  return {
    actual_request_id: row.actual_request_id,
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
    actual_request_status: row.actual_request_status,
    actual_request_policy_status: row.actual_request_policy_status,
    actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
    actual_capability_envelope_id: row.actual_capability_envelope_id || null,
    actual_capability_envelope_status: row.actual_capability_envelope_status || null,
    actual_capability_envelope_decision: row.actual_capability_envelope_decision || null,
    actual_capability_envelope_dispatch_allowed: boolValue(row.actual_capability_envelope_dispatch_allowed),
    actual_capability_envelope_apply_allowed: boolValue(row.actual_capability_envelope_apply_allowed),
    approval_hold_created: boolValue(row.approval_hold_created),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    request_payload_json: parseMaybeJson(row.request_payload_json, null),
    request_result_json: parseMaybeJson(row.request_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readPreflightContext(pool, actualRequestPreflightId) {
  const [rows] = await pool.query(
    `SELECT p.*,
            d.dispatch_status, d.dispatch_mode, d.dispatch_review_status, d.dispatch_policy_status,
            d.dispatch_payload_json, d.validation_result_json, d.secrets_included AS dispatch_secrets_included,
            g.request_review_status, g.request_policy_status, g.secrets_included AS request_gate_secrets_included,
            promo.tenant_id, promo.user_id, promo.workspace_key,
            promo.decision_status AS promotion_decision_status,
            promo.approval_status AS promotion_approval_status,
            promo.promotion_status,
            promo.promotion_allowed,
            promo.secrets_included AS promotion_secrets_included
       FROM session_insight_capability_envelope_actual_request_preflights p
       JOIN session_insight_capability_envelope_dispatch_dry_runs d
         ON d.dispatch_dry_run_id = p.dispatch_dry_run_id
       JOIN session_insight_capability_envelope_request_gates g
         ON g.request_gate_id = p.request_gate_id
       LEFT JOIN session_insight_promotions promo
         ON promo.promotion_id = p.promotion_id
      WHERE p.actual_request_preflight_id = ?
      LIMIT 1`,
    [actualRequestPreflightId]
  );
  return rows[0] || null;
}

async function countExistingActualRequests(pool, actualRequestPreflightId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
       FROM session_insight_capability_envelope_actual_requests
      WHERE actual_request_preflight_id = ?
        AND secrets_included = 0
        AND actual_request_status = 'actual_envelope_requested'`,
    [actualRequestPreflightId]
  );
  return Number(rows?.[0]?.count || 0);
}

function validatePreflightContext(ctx = {}) {
  const preflightResult = parseMaybeJson(ctx.preflight_result_json, {});
  const sourcePayloadHash = sha256Text(ctx.dispatch_payload_json);
  const sourceValidationHash = sha256Text(ctx.validation_result_json);
  const checks = {
    preflight_passed: ctx.preflight_status === "actual_request_preflight_passed",
    preflight_policy_ready: ctx.preflight_policy_status === "ready_for_actual_capability_envelope_request",
    preflight_result_valid: preflightResult.valid_for_actual_request_preflight === true,
    source_payload_unchanged: ctx.source_dispatch_payload_sha256 === sourcePayloadHash,
    source_validation_unchanged: ctx.source_validation_sha256 === sourceValidationHash,
    dispatch_dry_run_approved: ctx.dispatch_review_status === "dispatch_dry_run_approved",
    dispatch_policy_not_dispatched: ctx.dispatch_policy_status === "dispatch_dry_run_approved_but_not_dispatched",
    source_request_gate_approved: ctx.request_review_status === "request_approved" && ctx.request_policy_status === "request_approved_but_not_dispatched",
    source_promotion_ready: ctx.promotion_decision_status === "approved" && ctx.promotion_approval_status === "approved" && ctx.promotion_status === "ready" && !boolValue(ctx.promotion_allowed),
    prior_preflight_created_no_actual_envelope: !boolValue(ctx.actual_capability_envelope_requested) && !ctx.actual_capability_envelope_id,
    prior_preflight_no_execution: !boolValue(ctx.approval_hold_created) && !boolValue(ctx.execution_allowed) && !boolValue(ctx.target_write_allowed),
    no_secrets: !boolValue(ctx.secrets_included) && !boolValue(ctx.dispatch_secrets_included) && !boolValue(ctx.request_gate_secrets_included) && !boolValue(ctx.promotion_secrets_included),
  };
  const valid = Object.values(checks).every(Boolean);
  return {
    valid_for_actual_capability_envelope_request: valid,
    checks,
    blockers: valid ? [] : Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
    source_dispatch_payload_sha256: sourcePayloadHash,
    source_validation_sha256: sourceValidationHash,
    preflight_result_sha256: sha256Text(ctx.preflight_result_json),
    secrets_included: false,
  };
}

function buildEnvelopePassthrough(ctx = {}, payload = {}) {
  const tenantId = cleanString(ctx.tenant_id, "00000000-0000-0000-0000-000000000000");
  const userId = cleanString(ctx.user_id, "platform_admin");
  const workspaceKey = cleanString(ctx.workspace_key || payload.workspace_key || payload.workspaceKey, "platform_repo_governance_zero");
  const appKey = cleanString(payload.app_key || payload.appKey, "session_insight");
  return [
    "--tenant-id", tenantId,
    "--user-id", userId,
    "--workspace-key", workspaceKey,
    "--workspace-type", "project",
    "--app-key", appKey,
    "--capability-key", cleanString(ctx.capability_key),
    "--operation-intent", cleanString(ctx.operation_intent),
    "--runtime-surface", cleanString(ctx.runtime_surface),
  ];
}

async function insertActualRequestLedger(pool, { ctx, actualRequest, requestPayload, requestResult, safety, typedConfirm, createdBy }) {
  const id = actualRequestId();
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_actual_requests
       (actual_request_id, actual_request_preflight_id, dispatch_dry_run_id, request_gate_id, capability_plan_id,
        payload_preview_id, apply_request_id, promotion_id, insight_id, target_surface, promotion_type,
        capability_key, operation_intent, runtime_surface, actual_request_status, actual_request_policy_status,
        actual_capability_envelope_requested, actual_capability_envelope_id, actual_capability_envelope_status,
        actual_capability_envelope_decision, actual_capability_envelope_dispatch_allowed, actual_capability_envelope_apply_allowed,
        approval_hold_created, execution_allowed, target_write_allowed, source_preflight_sha256,
        request_payload_json, request_result_json, safety_contract_json, typed_confirm, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'actual_envelope_requested', 'actual_envelope_requested_but_not_approved',
             1, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      ctx.actual_request_preflight_id,
      ctx.dispatch_dry_run_id,
      ctx.request_gate_id,
      ctx.capability_plan_id,
      ctx.payload_preview_id,
      ctx.apply_request_id,
      ctx.promotion_id,
      ctx.insight_id,
      ctx.target_surface,
      ctx.promotion_type,
      ctx.capability_key,
      ctx.operation_intent,
      ctx.runtime_surface,
      actualRequest.envelope_id,
      actualRequest.envelope_status,
      actualRequest.decision,
      actualRequest.dispatch_allowed === true ? 1 : 0,
      actualRequest.apply_allowed === true ? 1 : 0,
      sha256Text(ctx.preflight_result_json),
      JSON.stringify(requestPayload),
      JSON.stringify(requestResult),
      JSON.stringify(safety),
      typedConfirm,
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_capability_envelope_actual_requests WHERE actual_request_id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function createSessionInsightCapabilityEnvelopeActualRequest({
  pool = getPool(),
  input = {},
  capabilityEnvelopeCreator = createCapabilityResolutionEnvelopeLedger,
} = {}) {
  const body = input && typeof input === "object" ? input : {};
  const typedConfirm = assertTypedConfirm(body);
  const actualRequestPreflightId = assertActualRequestPreflightId(body);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_capability_actual_request_tool");
  const ttlMinutes = boundedInt(body.ttl_minutes || body.ttlMinutes, 60, 5, 1440);
  const ctx = await readPreflightContext(pool, actualRequestPreflightId);
  if (!ctx) {
    const err = new Error("actual request preflight was not found.");
    err.status = 404;
    err.code = "actual_request_preflight_not_found";
    throw err;
  }
  const existing = await countExistingActualRequests(pool, actualRequestPreflightId);
  if (existing > 0) {
    const err = new Error("actual capability envelope request already exists for this preflight.");
    err.status = 409;
    err.code = "actual_capability_envelope_request_already_exists";
    err.details = { actual_request_preflight_id: actualRequestPreflightId, existing_count: existing, secrets_included: false };
    throw err;
  }
  const validation = validatePreflightContext(ctx);
  if (!validation.valid_for_actual_capability_envelope_request) {
    const err = new Error("actual capability envelope request validation failed.");
    err.status = 409;
    err.code = "actual_capability_envelope_request_validation_failed";
    err.details = validation;
    throw err;
  }
  const dispatchPayload = parseMaybeJson(ctx.dispatch_payload_json, {});
  const passthrough = buildEnvelopePassthrough(ctx, dispatchPayload);
  const requestPayload = {
    actual_request_preflight_id: actualRequestPreflightId,
    dispatch_dry_run_id: ctx.dispatch_dry_run_id,
    promotion_id: ctx.promotion_id,
    typed_confirm: typedConfirm,
    ttl_minutes: ttlMinutes,
    passthrough,
    calls_capability_resolution: true,
    creates_actual_capability_envelope: true,
    creates_approval_hold: false,
    adapter_apply_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    secrets_included: false,
  };
  const actualRequest = await capabilityEnvelopeCreator({ requestedBy: createdBy, ttlMinutes, passthrough });
  const acceptableEnvelope = actualRequest?.ok === true
    && actualRequest.envelope_id
    && ["ready_requires_approval", "ready_for_dispatch"].includes(actualRequest.envelope_status)
    && actualRequest.dispatch_allowed === true
    && Number(actualRequest.blocking_gap_count || 0) === 0
    && actualRequest.secrets_included === false;
  if (!acceptableEnvelope) {
    const err = new Error("actual capability envelope request did not produce a dispatch-ready envelope.");
    err.status = 409;
    err.code = "actual_capability_envelope_request_not_dispatch_ready";
    err.details = { request_result: actualRequest, secrets_included: false };
    throw err;
  }
  const safety = {
    actual_request_ledger_only: true,
    calls_capability_resolution: true,
    actual_capability_envelope_requested: true,
    actual_capability_envelope_id: actualRequest.envelope_id,
    actual_capability_envelope_status: actualRequest.envelope_status,
    actual_capability_envelope_decision: actualRequest.decision,
    approval_hold_created: false,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_request: false,
    backlog_policy_canonical_write_executed: false,
    provider_runtime_execution_allowed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const row = await insertActualRequestLedger(pool, { ctx, actualRequest, requestPayload, requestResult: actualRequest, safety, typedConfirm, createdBy });
  return {
    ok: true,
    actual_request: sanitizeActualRequest(row || {
      actual_request_id: "",
      ...ctx,
      actual_request_status: "actual_envelope_requested",
      actual_request_policy_status: "actual_envelope_requested_but_not_approved",
      actual_capability_envelope_requested: 1,
      actual_capability_envelope_id: actualRequest.envelope_id,
      actual_capability_envelope_status: actualRequest.envelope_status,
      actual_capability_envelope_decision: actualRequest.decision,
      actual_capability_envelope_dispatch_allowed: actualRequest.dispatch_allowed === true ? 1 : 0,
      actual_capability_envelope_apply_allowed: actualRequest.apply_allowed === true ? 1 : 0,
      request_payload_json: JSON.stringify(requestPayload),
      request_result_json: JSON.stringify(actualRequest),
      safety_contract_json: JSON.stringify(safety),
      created_by: createdBy,
    }),
    safety_contract: safety,
    secrets_included: false,
  };
}

export async function listSessionInsightCapabilityEnvelopeActualRequests({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["r.secrets_included = 0"];
  const params = [];
  const limit = Math.max(1, Math.min(Number.parseInt(body.limit, 10) || 25, 100));
  for (const [inputKey, columnName] of [
    ["actual_request_id", "r.actual_request_id"],
    ["actual_request_preflight_id", "r.actual_request_preflight_id"],
    ["dispatch_dry_run_id", "r.dispatch_dry_run_id"],
    ["promotion_id", "r.promotion_id"],
    ["actual_capability_envelope_id", "r.actual_capability_envelope_id"],
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
       FROM session_insight_capability_envelope_actual_requests r
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at DESC, r.actual_request_id DESC
      LIMIT ?`,
    params
  );
  const [summaryRows] = await pool.query(
    `SELECT actual_request_status, actual_request_policy_status, approval_hold_created, execution_allowed, target_write_allowed, COUNT(*) AS count
       FROM session_insight_capability_envelope_actual_requests
      WHERE secrets_included = 0
      GROUP BY actual_request_status, actual_request_policy_status, approval_hold_created, execution_allowed, target_write_allowed
      ORDER BY actual_request_status, actual_request_policy_status`
  );
  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_capability_envelope_actual_request_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );
  return {
    ok: true,
    count: rows.length,
    actual_requests: rows.map(sanitizeActualRequest),
    summary: summaryRows.map((row) => ({
      actual_request_status: row.actual_request_status,
      actual_request_policy_status: row.actual_request_policy_status,
      approval_hold_created: boolValue(row.approval_hold_created),
      execution_allowed: boolValue(row.execution_allowed),
      target_write_allowed: boolValue(row.target_write_allowed),
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({ issue_code: row.issue_code, severity: row.severity, count: Number(row.count || 0) })),
    actual_request_policy: {
      requires_typed_confirm: REQUIRED_TYPED_CONFIRM,
      calls_capability_resolution: true,
      creates_actual_capability_envelope: true,
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
