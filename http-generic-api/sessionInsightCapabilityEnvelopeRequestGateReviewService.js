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

function sanitizeReview(row = {}) {
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
    reviewed_by: row.reviewed_by || null,
    reviewed_at: row.reviewed_at || null,
    review_notes: row.review_notes || null,
    request_payload_json: parseMaybeJson(row.request_payload_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    secrets_included: false,
  };
}

async function readRequestGate(pool, requestGateId) {
  const [rows] = await pool.query(
    `SELECT *
       FROM session_insight_capability_envelope_request_gates
      WHERE request_gate_id = ?
      LIMIT 1`,
    [requestGateId]
  );
  return rows[0] || null;
}

async function writeReviewEvent(pool, { gate, decision, reviewedBy, reviewNotes, beforeStatus, afterStatus }) {
  const reviewEventId = `capability_request_review_${randomUUID()}`;
  await pool.query(
    `INSERT INTO session_insight_capability_envelope_request_gate_review_events
       (review_event_id, request_gate_id, capability_plan_id, payload_preview_id, apply_request_id,
        promotion_id, insight_id, event_type, request_review_status_before, request_policy_status_before,
        request_review_status_after, request_policy_status_after, reviewed_by, review_notes,
        evidence_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      reviewEventId,
      gate.request_gate_id,
      gate.capability_plan_id,
      gate.payload_preview_id,
      gate.apply_request_id,
      gate.promotion_id,
      gate.insight_id,
      decision === "approve" ? "request_approved" : "request_rejected",
      beforeStatus.request_review_status,
      beforeStatus.request_policy_status,
      afterStatus.request_review_status,
      afterStatus.request_policy_status,
      reviewedBy,
      reviewNotes || null,
      JSON.stringify({
        request_gate_id: gate.request_gate_id,
        capability_plan_id: gate.capability_plan_id,
        decision,
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

export async function decideSessionInsightCapabilityEnvelopeRequestGateReview({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const requestGateId = assertRequestGateId(body);
  const decision = cleanString(body.decision).toLowerCase();
  if (!DECISIONS.has(decision)) {
    const err = new Error("decision must be approve or reject.");
    err.status = 400;
    err.code = "invalid_capability_request_gate_review_decision";
    throw err;
  }
  const reviewedBy = cleanString(body.reviewed_by || body.reviewedBy, "session_insight_capability_request_gate_review_tool");
  const reviewNotes = cleanString(body.review_notes || body.reviewNotes || body.decision_notes || body.decisionNotes);
  const gate = await readRequestGate(pool, requestGateId);
  if (!gate) {
    const err = new Error("capability envelope request gate was not found.");
    err.status = 404;
    err.code = "capability_request_gate_not_found";
    throw err;
  }
  if (Number(gate.secrets_included || 0) !== 0) {
    const err = new Error("secret-flagged request gate cannot be reviewed.");
    err.status = 409;
    err.code = "capability_request_gate_secret_flagged";
    throw err;
  }
  if (boolValue(gate.actual_capability_envelope_requested) || gate.actual_capability_envelope_id || boolValue(gate.approval_hold_created) || boolValue(gate.execution_allowed) || boolValue(gate.target_write_allowed)) {
    const err = new Error("request gate claims actual envelope, approval hold, execution, or target write and cannot be reviewed.");
    err.status = 409;
    err.code = "capability_request_gate_runtime_claim";
    throw err;
  }
  if (gate.request_review_status !== "request_review_required" || gate.request_policy_status !== "blocked_until_request_gate_approved") {
    const err = new Error("request gate is not in a review-required state.");
    err.status = 409;
    err.code = "capability_request_gate_not_reviewable";
    err.details = {
      request_review_status: gate.request_review_status,
      request_policy_status: gate.request_policy_status,
    };
    throw err;
  }
  const beforeStatus = {
    request_review_status: gate.request_review_status,
    request_policy_status: gate.request_policy_status,
  };
  const afterStatus = decision === "approve"
    ? { request_review_status: "request_approved", request_policy_status: "request_approved_but_not_dispatched", request_gate_status: "request_gate_created_requires_review" }
    : { request_review_status: "request_rejected", request_policy_status: "rejected", request_gate_status: "rejected" };

  await pool.query(
    `UPDATE session_insight_capability_envelope_request_gates
        SET request_gate_status = ?,
            request_review_status = ?,
            request_policy_status = ?,
            reviewed_by = ?,
            reviewed_at = CURRENT_TIMESTAMP,
            review_notes = ?,
            actual_capability_envelope_requested = 0,
            actual_capability_envelope_id = NULL,
            approval_hold_created = 0,
            execution_allowed = 0,
            target_write_allowed = 0
      WHERE request_gate_id = ?
        AND request_review_status = 'request_review_required'
        AND request_policy_status = 'blocked_until_request_gate_approved'
        AND secrets_included = 0`,
    [afterStatus.request_gate_status, afterStatus.request_review_status, afterStatus.request_policy_status, reviewedBy, reviewNotes || null, requestGateId]
  );
  const review_event_id = await writeReviewEvent(pool, { gate, decision, reviewedBy, reviewNotes, beforeStatus, afterStatus });
  const updated = await readRequestGate(pool, requestGateId);
  return {
    ok: true,
    request_gate_id: requestGateId,
    decision,
    review_event_id,
    before: beforeStatus,
    after: afterStatus,
    request_gate: sanitizeReview(updated || { ...gate, ...afterStatus }),
    safety_contract: {
      request_gate_review_only: true,
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
