import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const DECISIONS = new Set(["approve", "reject"]);

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function boolValue(value) {
  return Number(value || 0) === 1 || value === true;
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

function sanitizeDispatchReview(row = {}) {
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
    dispatch_review_status: row.dispatch_review_status,
    dispatch_policy_status: row.dispatch_policy_status,
    actual_capability_envelope_requested: boolValue(row.actual_capability_envelope_requested),
    actual_capability_envelope_id: row.actual_capability_envelope_id || null,
    approval_hold_created: boolValue(row.approval_hold_created),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    dispatch_payload_json: parseMaybeJson(row.dispatch_payload_json, null),
    validation_result_json: parseMaybeJson(row.validation_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    review_notes: row.review_notes || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readDispatchDryRun(pool, dispatchDryRunId) {
  const [rows] = await pool.query(
    `SELECT d.*, g.request_review_status, g.request_policy_status, g.secrets_included AS request_gate_secrets_included
       FROM session_insight_capability_envelope_dispatch_dry_runs d
       JOIN session_insight_capability_envelope_request_gates g
         ON g.request_gate_id = d.request_gate_id
      WHERE d.dispatch_dry_run_id = ?
      LIMIT 1`,
    [dispatchDryRunId]
  );
  return rows[0] || null;
}

async function writeReviewEvent(pool, { dispatch, decision, reviewedBy, reviewNotes, beforeStatus, afterStatus }) {
  const reviewEventId = `capability_dispatch_dry_run_review_${randomUUID()}`;
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_dispatch_dry_run_review_events
       (review_event_id, dispatch_dry_run_id, request_gate_id, capability_plan_id, payload_preview_id,
        apply_request_id, promotion_id, insight_id, event_type,
        dispatch_review_status_before, dispatch_policy_status_before, dispatch_status_before,
        dispatch_review_status_after, dispatch_policy_status_after, dispatch_status_after,
        reviewed_by, review_notes, evidence_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      reviewEventId,
      dispatch.dispatch_dry_run_id,
      dispatch.request_gate_id,
      dispatch.capability_plan_id,
      dispatch.payload_preview_id,
      dispatch.apply_request_id,
      dispatch.promotion_id,
      dispatch.insight_id,
      decision === "approve" ? "dispatch_dry_run_approved" : "dispatch_dry_run_rejected",
      beforeStatus.dispatch_review_status,
      beforeStatus.dispatch_policy_status,
      beforeStatus.dispatch_status,
      afterStatus.dispatch_review_status,
      afterStatus.dispatch_policy_status,
      afterStatus.dispatch_status,
      reviewedBy,
      reviewNotes || null,
      JSON.stringify({
        dispatch_dry_run_id: dispatch.dispatch_dry_run_id,
        request_gate_id: dispatch.request_gate_id,
        capability_plan_id: dispatch.capability_plan_id,
        decision,
        dispatch_review_only: true,
        dispatch_not_called_after_review: true,
        actual_capability_envelope_requested_after_review: false,
        actual_capability_envelope_id_after_review: null,
        approval_hold_created_after_review: false,
        execution_allowed_after_review: false,
        target_write_allowed_after_review: false,
        adapter_apply_executed: false,
        raw_transcript_included: false,
        secrets_included: false,
      }),
    ]
  );
  return reviewEventId;
}

function assertNoRuntimeEffect(dispatch = {}) {
  if (boolValue(dispatch.actual_capability_envelope_requested) || dispatch.actual_capability_envelope_id || boolValue(dispatch.approval_hold_created) || boolValue(dispatch.execution_allowed) || boolValue(dispatch.target_write_allowed)) {
    const err = new Error("dispatch dry-run claims actual envelope, approval hold, execution, or target write and cannot be reviewed.");
    err.status = 409;
    err.code = "dispatch_dry_run_runtime_claim";
    throw err;
  }
}

export async function decideSessionInsightCapabilityEnvelopeDispatchDryRunReview({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const dispatchDryRunId = assertDispatchDryRunId(body);
  const decision = cleanString(body.decision).toLowerCase();
  if (!DECISIONS.has(decision)) {
    const err = new Error("decision must be approve or reject.");
    err.status = 400;
    err.code = "invalid_capability_dispatch_dry_run_review_decision";
    throw err;
  }
  const reviewedBy = cleanString(body.reviewed_by || body.reviewedBy, "session_insight_capability_dispatch_dry_run_review_tool");
  const reviewNotes = cleanString(body.review_notes || body.reviewNotes || body.decision_notes || body.decisionNotes);
  const dispatch = await readDispatchDryRun(pool, dispatchDryRunId);
  if (!dispatch) {
    const err = new Error("capability envelope dispatch dry-run was not found.");
    err.status = 404;
    err.code = "capability_dispatch_dry_run_not_found";
    throw err;
  }
  if (Number(dispatch.secrets_included || 0) !== 0 || Number(dispatch.request_gate_secrets_included || 0) !== 0) {
    const err = new Error("secret-flagged dispatch dry-run cannot be reviewed.");
    err.status = 409;
    err.code = "capability_dispatch_dry_run_secret_flagged";
    throw err;
  }
  assertNoRuntimeEffect(dispatch);
  if (dispatch.request_review_status !== "request_approved" || dispatch.request_policy_status !== "request_approved_but_not_dispatched") {
    const err = new Error("source request gate is not approved for dispatch dry-run review.");
    err.status = 409;
    err.code = "capability_dispatch_dry_run_source_gate_not_approved";
    err.details = {
      request_review_status: dispatch.request_review_status,
      request_policy_status: dispatch.request_policy_status,
    };
    throw err;
  }
  if (dispatch.dispatch_status !== "dispatch_dry_run_generated" || dispatch.dispatch_mode !== "dry_run_no_dispatch") {
    const err = new Error("dispatch dry-run is not in a generated dry-run state.");
    err.status = 409;
    err.code = "capability_dispatch_dry_run_not_generated";
    err.details = { dispatch_status: dispatch.dispatch_status, dispatch_mode: dispatch.dispatch_mode };
    throw err;
  }
  if (dispatch.dispatch_review_status !== "dispatch_dry_run_review_required" || dispatch.dispatch_policy_status !== "blocked_until_dispatch_dry_run_approved") {
    const err = new Error("dispatch dry-run is not in a review-required state.");
    err.status = 409;
    err.code = "capability_dispatch_dry_run_not_reviewable";
    err.details = {
      dispatch_review_status: dispatch.dispatch_review_status,
      dispatch_policy_status: dispatch.dispatch_policy_status,
    };
    throw err;
  }

  const beforeStatus = {
    dispatch_review_status: dispatch.dispatch_review_status,
    dispatch_policy_status: dispatch.dispatch_policy_status,
    dispatch_status: dispatch.dispatch_status,
  };
  const afterStatus = decision === "approve"
    ? {
        dispatch_review_status: "dispatch_dry_run_approved",
        dispatch_policy_status: "dispatch_dry_run_approved_but_not_dispatched",
        dispatch_status: "dispatch_dry_run_generated",
      }
    : {
        dispatch_review_status: "dispatch_dry_run_rejected",
        dispatch_policy_status: "rejected",
        dispatch_status: "rejected",
      };

  await pool.query(
    `UPDATE session_insight_capability_envelope_dispatch_dry_runs
        SET dispatch_status = ?,
            dispatch_review_status = ?,
            dispatch_policy_status = ?,
            reviewed_by = ?,
            reviewed_at = CURRENT_TIMESTAMP,
            review_notes = ?,
            actual_capability_envelope_requested = 0,
            actual_capability_envelope_id = NULL,
            approval_hold_created = 0,
            execution_allowed = 0,
            target_write_allowed = 0
      WHERE dispatch_dry_run_id = ?
        AND dispatch_status = 'dispatch_dry_run_generated'
        AND dispatch_mode = 'dry_run_no_dispatch'
        AND dispatch_review_status = 'dispatch_dry_run_review_required'
        AND dispatch_policy_status = 'blocked_until_dispatch_dry_run_approved'
        AND secrets_included = 0`,
    [afterStatus.dispatch_status, afterStatus.dispatch_review_status, afterStatus.dispatch_policy_status, reviewedBy, reviewNotes || null, dispatchDryRunId]
  );
  const review_event_id = await writeReviewEvent(pool, { dispatch, decision, reviewedBy, reviewNotes, beforeStatus, afterStatus });
  const updated = await readDispatchDryRun(pool, dispatchDryRunId);
  return {
    ok: true,
    dispatch_dry_run_id: dispatchDryRunId,
    decision,
    review_event_id,
    before: beforeStatus,
    after: afterStatus,
    dispatch_dry_run: sanitizeDispatchReview(updated || { ...dispatch, ...afterStatus }),
    safety_contract: {
      dispatch_dry_run_review_only: true,
      actual_capability_envelope_requested: false,
      actual_capability_envelope_approved: false,
      approval_hold_created: false,
      adapter_apply_executed: false,
      runtime_promotion_executed: false,
      execution_allowed: false,
      target_write_allowed: false,
      promotion_allowed_after_review: false,
      backlog_policy_canonical_write_executed: false,
      provider_call_executed: false,
      credential_payload_read: false,
      external_write_executed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
