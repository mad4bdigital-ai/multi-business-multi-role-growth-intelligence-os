import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const PROMOTION_REVIEW_STATUSES = new Set(["queued", "ready", "rejected", "promoted", "superseded"]);
const APPROVAL_STATUSES = new Set(["review_required", "approved", "rejected", "not_required"]);
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

function assertPromotionId(promotionId) {
  const value = cleanString(promotionId);
  if (!value) {
    const err = new Error("promotion_id is required.");
    err.status = 400;
    err.code = "promotion_id_required";
    throw err;
  }
  return value;
}

function sanitizePromotionRow(row = {}, { includeEvidence = false } = {}) {
  return {
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    insight_type: row.insight_type || null,
    promotion_type: row.promotion_type,
    target_surface: row.target_surface,
    target_ref: row.target_ref || null,
    target_scope_type: row.target_scope_type || null,
    target_scope_ref: row.target_scope_ref || null,
    proposal_title: row.proposal_title,
    proposal_text: row.proposal_text,
    decision_status: row.decision_status,
    approval_status: row.approval_status,
    promotion_status: row.promotion_status,
    risk_level: row.risk_level,
    confidence: Number(row.confidence ?? 0),
    requires_human_approval: Number(row.requires_human_approval || 0) === 1,
    promotion_allowed: Number(row.promotion_allowed || 0) === 1,
    promotion_executor_key: row.promotion_executor_key || null,
    source_session_id: row.source_session_id || null,
    source_summary_id: row.source_summary_id || null,
    tenant_id: row.tenant_id || null,
    user_id: row.user_id || null,
    workspace_key: row.workspace_key || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    approved_by: row.approved_by || null,
    approved_at: row.approved_at || null,
    rejected_by: row.rejected_by || null,
    rejected_at: row.rejected_at || null,
    promoted_at: row.promoted_at || null,
    secrets_included: false,
    evidence: includeEvidence ? parseMaybeJson(row.evidence_json, null) : undefined,
    scope_links: includeEvidence ? parseMaybeJson(row.scope_links_json, []) : undefined,
    metadata: includeEvidence ? parseMaybeJson(row.metadata_json, null) : undefined,
  };
}

export async function listSessionInsightPromotionReviews({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["p.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);
  const includeEvidence = body.include_evidence === true || body.includeEvidence === true;

  const promotionStatus = cleanString(body.promotion_status || body.promotionStatus);
  if (promotionStatus) {
    if (!PROMOTION_REVIEW_STATUSES.has(promotionStatus)) {
      const err = new Error("promotion_status is not allowed.");
      err.status = 400;
      err.code = "invalid_promotion_status";
      throw err;
    }
    where.push("p.promotion_status = ?");
    params.push(promotionStatus);
  } else {
    where.push("p.promotion_status IN ('queued', 'ready', 'rejected')");
  }

  const approvalStatus = cleanString(body.approval_status || body.approvalStatus);
  if (approvalStatus) {
    if (!APPROVAL_STATUSES.has(approvalStatus)) {
      const err = new Error("approval_status is not allowed.");
      err.status = 400;
      err.code = "invalid_approval_status";
      throw err;
    }
    where.push("p.approval_status = ?");
    params.push(approvalStatus);
  }

  for (const [inputKey, columnName] of [
    ["promotion_type", "p.promotion_type"],
    ["target_surface", "p.target_surface"],
    ["tenant_id", "p.tenant_id"],
    ["workspace_key", "p.workspace_key"],
    ["target_scope_type", "p.target_scope_type"],
    ["target_scope_ref", "p.target_scope_ref"],
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
    where.push("(p.proposal_title LIKE ? OR p.proposal_text LIKE ? OR p.promotion_id = ? OR p.insight_id = ?)");
    params.push(`%${q}%`, `%${q}%`, q, q);
  }

  params.push(limit);
  const [rows] = await pool.query(
    `SELECT p.promotion_id, p.promotion_hash, p.insight_id, c.insight_type,
            p.source_session_id, p.source_summary_id, p.tenant_id, p.user_id, p.workspace_key,
            p.promotion_type, p.target_surface, p.target_ref, p.target_scope_type, p.target_scope_ref,
            p.proposal_title, p.proposal_text, p.decision_status, p.approval_status, p.promotion_status,
            p.risk_level, p.confidence, p.requires_human_approval, p.promotion_allowed, p.promotion_executor_key,
            p.approved_by, p.approved_at, p.rejected_by, p.rejected_at, p.promoted_at,
            p.evidence_json, p.scope_links_json, p.metadata_json, p.created_at, p.updated_at
       FROM session_insight_promotions p
       LEFT JOIN session_insight_candidates c ON c.insight_id = p.insight_id
      WHERE ${where.join(" AND ")}
      ORDER BY FIELD(p.risk_level,'critical','high','medium','low'), p.created_at ASC, p.promotion_id ASC
      LIMIT ?`,
    params
  );

  const [summaryRows] = await pool.query(
    `SELECT promotion_type, target_surface, approval_status, promotion_status, promotion_allowed, COUNT(*) AS count
       FROM session_insight_promotions
      WHERE secrets_included = 0
      GROUP BY promotion_type, target_surface, approval_status, promotion_status, promotion_allowed
      ORDER BY promotion_type, approval_status, promotion_status`
  );

  return {
    ok: true,
    count: rows.length,
    promotions: rows.map((row) => sanitizePromotionRow(row, { includeEvidence })),
    summary: summaryRows.map((row) => ({
      ...row,
      promotion_allowed: Number(row.promotion_allowed || 0) === 1,
      count: Number(row.count || 0),
    })),
    review_policy: {
      allowed_decisions: ["approve", "reject"],
      approval_sets_promotion_allowed: false,
      executor_required_for_runtime_promotion: true,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

async function readPromotionForDecision(pool, promotionId) {
  const [rows] = await pool.query(
    `SELECT p.*, c.insight_type
       FROM session_insight_promotions p
       LEFT JOIN session_insight_candidates c ON c.insight_id = p.insight_id
      WHERE p.promotion_id = ?
      LIMIT 1`,
    [promotionId]
  );
  return rows[0] || null;
}

async function writeReviewEvent(pool, { promotion, decision, reviewedBy, reviewNotes, beforeStatus, afterStatus }) {
  const reviewEventId = `promo_review_${randomUUID()}`;
  await pool.query(
    `INSERT INTO session_insight_promotion_review_events
       (review_event_id, promotion_id, insight_id, event_type,
        decision_status_before, approval_status_before, promotion_status_before,
        decision_status_after, approval_status_after, promotion_status_after,
        reviewed_by, review_notes, evidence_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      reviewEventId,
      promotion.promotion_id,
      promotion.insight_id,
      decision === "approve" ? "approved" : "rejected",
      beforeStatus.decision_status,
      beforeStatus.approval_status,
      beforeStatus.promotion_status,
      afterStatus.decision_status,
      afterStatus.approval_status,
      afterStatus.promotion_status,
      reviewedBy,
      reviewNotes || null,
      JSON.stringify({
        promotion_id: promotion.promotion_id,
        insight_id: promotion.insight_id,
        promotion_type: promotion.promotion_type,
        target_surface: promotion.target_surface,
        promotion_allowed_after_review: false,
        executor_assigned: false,
        raw_transcript_included: false,
        secrets_included: false,
      }),
    ]
  );
  return reviewEventId;
}

export async function decideSessionInsightPromotionReview({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const promotionId = assertPromotionId(body.promotion_id || body.promotionId);
  const decision = cleanString(body.decision).toLowerCase();
  if (!DECISIONS.has(decision)) {
    const err = new Error("decision must be approve or reject.");
    err.status = 400;
    err.code = "invalid_review_decision";
    throw err;
  }
  const reviewedBy = cleanString(body.reviewed_by || body.reviewedBy, "session_insight_promotion_review_tool");
  const reviewNotes = cleanString(body.review_notes || body.reviewNotes || body.decision_notes || body.decisionNotes);
  const promotion = await readPromotionForDecision(pool, promotionId);
  if (!promotion) {
    const err = new Error("promotion proposal was not found.");
    err.status = 404;
    err.code = "promotion_not_found";
    throw err;
  }
  if (Number(promotion.secrets_included || 0) !== 0) {
    const err = new Error("promotion proposal is secret-flagged and cannot be reviewed by this tool.");
    err.status = 409;
    err.code = "promotion_secret_flagged";
    throw err;
  }
  const beforeStatus = {
    decision_status: promotion.decision_status,
    approval_status: promotion.approval_status,
    promotion_status: promotion.promotion_status,
  };
  if (promotion.approval_status !== "review_required" || promotion.decision_status !== "review_required" || promotion.promotion_status !== "queued") {
    const err = new Error("promotion proposal is not in a review-required queued state.");
    err.status = 409;
    err.code = "promotion_not_reviewable";
    err.details = beforeStatus;
    throw err;
  }

  const afterStatus = decision === "approve"
    ? { decision_status: "approved", approval_status: "approved", promotion_status: "ready" }
    : { decision_status: "rejected", approval_status: "rejected", promotion_status: "rejected" };

  if (decision === "approve") {
    await pool.query(
      `UPDATE session_insight_promotions
          SET decision_status = 'approved', approval_status = 'approved', promotion_status = 'ready',
              approved_by = ?, approved_at = CURRENT_TIMESTAMP,
              rejected_by = NULL, rejected_at = NULL,
              decision_notes = ?,
              promotion_allowed = 0,
              promotion_executor_key = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE promotion_id = ?
          AND decision_status = 'review_required'
          AND approval_status = 'review_required'
          AND promotion_status = 'queued'
          AND secrets_included = 0`,
      [reviewedBy, reviewNotes || null, promotionId]
    );
  } else {
    await pool.query(
      `UPDATE session_insight_promotions
          SET decision_status = 'rejected', approval_status = 'rejected', promotion_status = 'rejected',
              rejected_by = ?, rejected_at = CURRENT_TIMESTAMP,
              approved_by = NULL, approved_at = NULL,
              decision_notes = ?,
              promotion_allowed = 0,
              promotion_executor_key = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE promotion_id = ?
          AND decision_status = 'review_required'
          AND approval_status = 'review_required'
          AND promotion_status = 'queued'
          AND secrets_included = 0`,
      [reviewedBy, reviewNotes || null, promotionId]
    );
  }

  const review_event_id = await writeReviewEvent(pool, { promotion, decision, reviewedBy, reviewNotes, beforeStatus, afterStatus });
  const updated = await readPromotionForDecision(pool, promotionId);
  return {
    ok: true,
    promotion_id: promotionId,
    decision,
    review_event_id,
    before: beforeStatus,
    after: afterStatus,
    promotion: sanitizePromotionRow(updated || { ...promotion, ...afterStatus }),
    safety_contract: {
      promotion_allowed: false,
      promotion_executor_key: null,
      runtime_promotion_executed: false,
      backlog_policy_canonical_write_executed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
