import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const PROMOTION_TARGETS = Object.freeze({
  runtime_repair_backlog_item: {
    proposed_surface: "runtime_repair_backlog",
    proposed_operation: "would_create_runtime_repair_backlog_item",
    executor_family: "runtime_repair_backlog_executor",
  },
  development_backlog_item: {
    proposed_surface: "development_backlog",
    proposed_operation: "would_create_development_backlog_item",
    executor_family: "development_backlog_executor",
  },
  integration_backlog_item: {
    proposed_surface: "integration_backlog",
    proposed_operation: "would_create_integration_backlog_item",
    executor_family: "integration_backlog_executor",
  },
});

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

function previewId() {
  return `promo_preview_${randomUUID()}`;
}

function buildProposedWrite(row = {}) {
  const target = PROMOTION_TARGETS[row.promotion_type] || null;
  const proposedSurface = target?.proposed_surface || row.target_surface || "manual_review_required";
  const proposedOperation = target?.proposed_operation || "would_create_manual_review_task";
  return {
    proposed_surface: proposedSurface,
    proposed_operation: proposedOperation,
    source_promotion_id: row.promotion_id,
    source_insight_id: row.insight_id,
    title: row.proposal_title,
    body: row.proposal_text,
    target_scope_type: row.target_scope_type || null,
    target_scope_ref: row.target_scope_ref || null,
    tenant_id: row.tenant_id || null,
    workspace_key: row.workspace_key || null,
    risk_level: row.risk_level,
    confidence: Number(row.confidence ?? 0),
    runtime_write_executed: false,
    backlog_policy_canonical_write_executed: false,
    provider_call_executed: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
}

export function buildSessionInsightPromotionExecutionPreview(row = {}) {
  const target = PROMOTION_TARGETS[row.promotion_type] || null;
  const approvedReady = row.approval_status === "approved"
    && row.decision_status === "approved"
    && row.promotion_status === "ready";
  const blockers = [];
  if (!approvedReady) blockers.push("promotion_not_approved_ready");
  if (Number(row.secrets_included || 0) !== 0) blockers.push("promotion_secret_flagged");
  blockers.push("executor_layer_not_implemented");
  blockers.push("promotion_allowed_policy_forces_false_until_executor_layer");
  if (!target) blockers.push("unknown_promotion_type_requires_manual_mapping");

  const proposedWrite = buildProposedWrite(row);
  const dryRunResult = {
    preview_status: approvedReady && Number(row.secrets_included || 0) === 0 ? "preview_ready_blocked_for_executor_layer" : "preview_blocked",
    execution_mode: "dry_run",
    execution_allowed: false,
    promotion_allowed_observed: Number(row.promotion_allowed || 0) === 1,
    would_target_surface: proposedWrite.proposed_surface,
    would_operation: proposedWrite.proposed_operation,
    executor_family_required: target?.executor_family || "manual_review_executor",
    blockers,
    no_runtime_effects: true,
    secrets_included: false,
  };
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
    decision_status: row.decision_status,
    approval_status: row.approval_status,
    promotion_status: row.promotion_status,
    promotion_allowed: false,
    execution_allowed: false,
    execution_mode: "dry_run",
    proposed_write: proposedWrite,
    dry_run_result: dryRunResult,
    blockers,
    safety_contract: {
      dry_run_only: true,
      promotion_allowed_after_preview: false,
      promotion_executor_key_assigned: false,
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

async function writeExecutionPreviewRecord(pool, preview, createdBy = "session_insight_promotion_dry_run_executor") {
  const id = previewId();
  await pool.query(
    `INSERT INTO session_insight_promotion_execution_previews
       (preview_id, promotion_id, insight_id, promotion_type, target_surface,
        execution_mode, execution_allowed, execution_status,
        proposed_write_json, blockers_json, dry_run_result_json, safety_contract_json,
        secrets_included, created_by)
     VALUES (?, ?, ?, ?, ?, 'dry_run', 0, 'preview_generated', ?, ?, ?, ?, 0, ?)`,
    [
      id,
      preview.promotion_id,
      preview.insight_id,
      preview.promotion_type,
      preview.proposed_write.proposed_surface,
      JSON.stringify(preview.proposed_write),
      JSON.stringify(preview.blockers),
      JSON.stringify(preview.dry_run_result),
      JSON.stringify(preview.safety_contract),
      createdBy,
    ]
  );
  return id;
}

export async function previewSessionInsightPromotionExecution({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["p.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);
  const recordPreview = body.record_preview === true || body.recordPreview === true;
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_promotion_dry_run_executor");

  const promotionId = cleanString(body.promotion_id || body.promotionId);
  if (promotionId) {
    where.push("p.promotion_id = ?");
    params.push(promotionId);
  } else {
    where.push("p.decision_status = 'approved'");
    where.push("p.approval_status = 'approved'");
    where.push("p.promotion_status = 'ready'");
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

  params.push(limit);
  const [rows] = await pool.query(
    `SELECT p.*, c.insight_type
       FROM session_insight_promotions p
       LEFT JOIN session_insight_candidates c ON c.insight_id = p.insight_id
      WHERE ${where.join(" AND ")}
      ORDER BY FIELD(p.risk_level,'critical','high','medium','low'), p.approved_at ASC, p.created_at ASC, p.promotion_id ASC
      LIMIT ?`,
    params
  );
  const previews = rows.map(buildSessionInsightPromotionExecutionPreview);
  const recorded = [];
  if (recordPreview) {
    for (const preview of previews) {
      recorded.push({
        promotion_id: preview.promotion_id,
        preview_id: await writeExecutionPreviewRecord(pool, preview, createdBy),
      });
    }
  }
  const [summaryRows] = await pool.query(
    `SELECT approval_status, promotion_status, promotion_allowed, COUNT(*) AS count
       FROM session_insight_promotions
      WHERE secrets_included = 0
      GROUP BY approval_status, promotion_status, promotion_allowed
      ORDER BY approval_status, promotion_status, promotion_allowed`
  );
  return {
    ok: true,
    count: previews.length,
    recorded_count: recorded.length,
    previews,
    recorded_previews: recorded,
    summary: summaryRows.map((row) => ({
      approval_status: row.approval_status,
      promotion_status: row.promotion_status,
      promotion_allowed: Number(row.promotion_allowed || 0) === 1,
      count: Number(row.count || 0),
    })),
    executor_policy: {
      mode: "dry_run_only",
      accepted_source_state: "approved_ready",
      execution_allowed: false,
      promotion_allowed_after_preview: false,
      writes_backlog_policy_or_canonical: false,
      executor_layer_required_for_apply: true,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
