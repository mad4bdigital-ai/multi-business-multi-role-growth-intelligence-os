import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const REVIEW_STATUSES = new Set(["review_required", "approved", "rejected", "not_required"]);
const DECISIONS = new Set(["approve", "reject"]);

function boundedInt(value, fallback, min = 1, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function assertPayloadPreviewId(payloadPreviewId) {
  const value = cleanString(payloadPreviewId);
  if (!value) {
    const err = new Error("payload_preview_id is required.");
    err.status = 400;
    err.code = "payload_preview_id_required";
    throw err;
  }
  return value;
}

function sanitizePayloadPreviewReview(row = {}, { includePayload = false } = {}) {
  return {
    payload_preview_id: row.payload_preview_id,
    apply_request_id: row.apply_request_id,
    preview_id: row.preview_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    adapter_key: row.adapter_key || null,
    contract_key: row.contract_key || null,
    target_surface: row.target_surface,
    promotion_type: row.promotion_type,
    payload_status: row.payload_status,
    payload_mode: row.payload_mode,
    payload_review_status: row.payload_review_status,
    payload_decision_status: row.payload_decision_status,
    execution_allowed: Number(row.execution_allowed || 0) === 1,
    target_write_allowed: Number(row.target_write_allowed || 0) === 1,
    approved_by: row.approved_by || null,
    approved_at: row.approved_at || null,
    rejected_by: row.rejected_by || null,
    rejected_at: row.rejected_at || null,
    decision_notes: row.decision_notes || null,
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    payload: includePayload ? parseMaybeJson(row.payload_json, null) : undefined,
    validation_result: includePayload ? parseMaybeJson(row.validation_result_json, null) : undefined,
    safety_contract: includePayload ? parseMaybeJson(row.safety_contract_json, null) : undefined,
    secrets_included: false,
  };
}

export async function listSessionInsightPayloadPreviewReviews({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["p.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);
  const includePayload = body.include_payload === true || body.includePayload === true;

  const reviewStatus = cleanString(body.payload_review_status || body.payloadReviewStatus || body.review_status || body.reviewStatus);
  if (reviewStatus) {
    if (!REVIEW_STATUSES.has(reviewStatus)) {
      const err = new Error("payload_review_status is not allowed.");
      err.status = 400;
      err.code = "invalid_payload_review_status";
      throw err;
    }
    where.push("p.payload_review_status = ?");
    params.push(reviewStatus);
  } else {
    where.push("p.payload_review_status IN ('review_required', 'approved', 'rejected')");
  }

  for (const [inputKey, columnName] of [
    ["payload_preview_id", "p.payload_preview_id"],
    ["apply_request_id", "p.apply_request_id"],
    ["promotion_id", "p.promotion_id"],
    ["promotion_type", "p.promotion_type"],
    ["target_surface", "p.target_surface"],
    ["adapter_key", "p.adapter_key"],
    ["contract_key", "p.contract_key"],
  ]) {
    const camelKey = inputKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = cleanString(body[inputKey] || body[camelKey]);
    if (value) {
      where.push(`${columnName} = ?`);
      params.push(value);
    }
  }

  const q = cleanString(body.q || body.query);
  if (q) {
    where.push("(p.payload_preview_id = ? OR p.apply_request_id = ? OR p.promotion_id = ? OR p.payload_json LIKE ?)");
    params.push(q, q, q, `%${q}%`);
  }

  params.push(limit);
  const [rows] = await pool.query(
    `SELECT p.*
       FROM session_insight_promotion_payload_previews p
      WHERE ${where.join(" AND ")}
      ORDER BY FIELD(p.payload_review_status,'review_required','approved','rejected','not_required'), p.created_at ASC, p.payload_preview_id ASC
      LIMIT ?`,
    params
  );

  const [summaryRows] = await pool.query(
    `SELECT payload_review_status, payload_decision_status, payload_status, target_surface,
            execution_allowed, target_write_allowed, COUNT(*) AS count
       FROM session_insight_promotion_payload_previews
      WHERE secrets_included = 0
      GROUP BY payload_review_status, payload_decision_status, payload_status, target_surface, execution_allowed, target_write_allowed
      ORDER BY payload_review_status, payload_decision_status, target_surface`
  );

  return {
    ok: true,
    count: rows.length,
    payload_previews: rows.map((row) => sanitizePayloadPreviewReview(row, { includePayload })),
    summary: summaryRows.map((row) => ({
      payload_review_status: row.payload_review_status,
      payload_decision_status: row.payload_decision_status,
      payload_status: row.payload_status,
      target_surface: row.target_surface,
      execution_allowed: Number(row.execution_allowed || 0) === 1,
      target_write_allowed: Number(row.target_write_allowed || 0) === 1,
      count: Number(row.count || 0),
    })),
    review_policy: {
      allowed_decisions: ["approve", "reject"],
      approval_sets_execution_allowed: false,
      approval_sets_target_write_allowed: false,
      payload_review_only: true,
      adapter_apply_executed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

async function readPayloadPreview(pool, payloadPreviewId) {
  const [rows] = await pool.query(
    `SELECT *
       FROM session_insight_promotion_payload_previews
      WHERE payload_preview_id = ?
      LIMIT 1`,
    [payloadPreviewId]
  );
  return rows[0] || null;
}

async function writeReviewEvent(pool, { preview, decision, reviewedBy, reviewNotes, beforeStatus, afterStatus }) {
  const reviewEventId = `payload_review_${randomUUID()}`;
  await pool.query(
    `INSERT INTO session_insight_payload_preview_review_events
       (review_event_id, payload_preview_id, apply_request_id, promotion_id, insight_id,
        event_type, payload_review_status_before, payload_decision_status_before,
        payload_review_status_after, payload_decision_status_after,
        reviewed_by, review_notes, evidence_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      reviewEventId,
      preview.payload_preview_id,
      preview.apply_request_id,
      preview.promotion_id,
      preview.insight_id,
      decision === "approve" ? "approved" : "rejected",
      beforeStatus.payload_review_status,
      beforeStatus.payload_decision_status,
      afterStatus.payload_review_status,
      afterStatus.payload_decision_status,
      reviewedBy,
      reviewNotes || null,
      JSON.stringify({
        payload_preview_id: preview.payload_preview_id,
        apply_request_id: preview.apply_request_id,
        promotion_id: preview.promotion_id,
        decision,
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

export async function decideSessionInsightPayloadPreviewReview({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const payloadPreviewId = assertPayloadPreviewId(body.payload_preview_id || body.payloadPreviewId);
  const decision = cleanString(body.decision).toLowerCase();
  if (!DECISIONS.has(decision)) {
    const err = new Error("decision must be approve or reject.");
    err.status = 400;
    err.code = "invalid_payload_review_decision";
    throw err;
  }
  const reviewedBy = cleanString(body.reviewed_by || body.reviewedBy, "session_insight_payload_preview_review_tool");
  const reviewNotes = cleanString(body.review_notes || body.reviewNotes || body.decision_notes || body.decisionNotes);
  const preview = await readPayloadPreview(pool, payloadPreviewId);
  if (!preview) {
    const err = new Error("payload preview was not found.");
    err.status = 404;
    err.code = "payload_preview_not_found";
    throw err;
  }
  if (Number(preview.secrets_included || 0) !== 0) {
    const err = new Error("secret-flagged payload preview cannot be reviewed by this tool.");
    err.status = 409;
    err.code = "payload_preview_secret_flagged";
    throw err;
  }
  if (Number(preview.execution_allowed || 0) !== 0 || Number(preview.target_write_allowed || 0) !== 0) {
    const err = new Error("payload preview claims execution or target write and cannot be reviewed.");
    err.status = 409;
    err.code = "payload_preview_execution_claim";
    throw err;
  }
  const beforeStatus = {
    payload_review_status: preview.payload_review_status,
    payload_decision_status: preview.payload_decision_status,
  };
  if (preview.payload_review_status !== "review_required" || preview.payload_decision_status !== "review_required") {
    const err = new Error("payload preview is not in a review-required state.");
    err.status = 409;
    err.code = "payload_preview_not_reviewable";
    err.details = beforeStatus;
    throw err;
  }
  const afterStatus = decision === "approve"
    ? { payload_review_status: "approved", payload_decision_status: "approved" }
    : { payload_review_status: "rejected", payload_decision_status: "rejected" };

  if (decision === "approve") {
    await pool.query(
      `UPDATE session_insight_promotion_payload_previews
          SET payload_review_status = 'approved', payload_decision_status = 'approved',
              approved_by = ?, approved_at = CURRENT_TIMESTAMP,
              rejected_by = NULL, rejected_at = NULL,
              decision_notes = ?,
              execution_allowed = 0,
              target_write_allowed = 0
        WHERE payload_preview_id = ?
          AND payload_review_status = 'review_required'
          AND payload_decision_status = 'review_required'
          AND secrets_included = 0`,
      [reviewedBy, reviewNotes || null, payloadPreviewId]
    );
  } else {
    await pool.query(
      `UPDATE session_insight_promotion_payload_previews
          SET payload_review_status = 'rejected', payload_decision_status = 'rejected',
              rejected_by = ?, rejected_at = CURRENT_TIMESTAMP,
              approved_by = NULL, approved_at = NULL,
              decision_notes = ?,
              execution_allowed = 0,
              target_write_allowed = 0
        WHERE payload_preview_id = ?
          AND payload_review_status = 'review_required'
          AND payload_decision_status = 'review_required'
          AND secrets_included = 0`,
      [reviewedBy, reviewNotes || null, payloadPreviewId]
    );
  }
  const review_event_id = await writeReviewEvent(pool, { preview, decision, reviewedBy, reviewNotes, beforeStatus, afterStatus });
  const updated = await readPayloadPreview(pool, payloadPreviewId);
  return {
    ok: true,
    payload_preview_id: payloadPreviewId,
    decision,
    review_event_id,
    before: beforeStatus,
    after: afterStatus,
    payload_preview: sanitizePayloadPreviewReview(updated || { ...preview, ...afterStatus }),
    safety_contract: {
      payload_review_only: true,
      approval_sets_execution_allowed: false,
      approval_sets_target_write_allowed: false,
      adapter_apply_executed: false,
      runtime_promotion_executed: false,
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
