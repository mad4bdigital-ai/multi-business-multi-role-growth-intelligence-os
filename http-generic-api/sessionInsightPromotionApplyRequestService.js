import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const SUPPORTED_PROMOTION_TYPES = new Set([
  "runtime_repair_backlog_item",
  "development_backlog_item",
  "integration_backlog_item",
]);

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function applyRequestId() {
  return `promo_apply_req_${randomUUID()}`;
}

function assertPreviewId(previewId) {
  const value = cleanString(previewId);
  if (!value) {
    const err = new Error("preview_id is required.");
    err.status = 400;
    err.code = "preview_id_required";
    throw err;
  }
  return value;
}

function sanitizeApplyRequest(row = {}) {
  return {
    apply_request_id: row.apply_request_id,
    preview_id: row.preview_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    promotion_type: row.promotion_type,
    target_surface: row.target_surface,
    requested_operation: row.requested_operation,
    request_status: row.request_status,
    capability_envelope_required: Number(row.capability_envelope_required || 0) === 1,
    capability_envelope_id: row.capability_envelope_id || null,
    adapter_key_required: Number(row.adapter_key_required || 0) === 1,
    target_adapter_key: row.target_adapter_key || null,
    execution_allowed: Number(row.execution_allowed || 0) === 1,
    execution_status: row.execution_status,
    requested_by: row.requested_by || null,
    decision_notes: row.decision_notes || null,
    proposed_write: parseMaybeJson(row.proposed_write_json, null),
    gating_result: parseMaybeJson(row.gating_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

function buildGatingResult({ promotion, preview, proposedWrite }) {
  const blockers = [];
  if (!promotion) blockers.push("promotion_missing");
  if (!preview) blockers.push("preview_missing");
  if (promotion?.decision_status !== "approved") blockers.push("promotion_decision_not_approved");
  if (promotion?.approval_status !== "approved") blockers.push("promotion_approval_not_approved");
  if (promotion?.promotion_status !== "ready") blockers.push("promotion_not_ready");
  if (Number(promotion?.promotion_allowed || 0) !== 0) blockers.push("promotion_allowed_must_stay_false_until_apply_executor");
  if (Number(preview?.execution_allowed || 0) !== 0) blockers.push("preview_execution_allowed_must_be_false");
  if (Number(promotion?.secrets_included || 0) !== 0 || Number(preview?.secrets_included || 0) !== 0) blockers.push("secret_flagged_source");
  if (!SUPPORTED_PROMOTION_TYPES.has(promotion?.promotion_type)) blockers.push("unsupported_promotion_type_requires_adapter_design");
  blockers.push("capability_envelope_required");
  blockers.push("target_adapter_required");
  blockers.push("apply_executor_not_implemented");
  return {
    request_status: "blocked_requires_capability_envelope",
    execution_allowed: false,
    execution_status: "not_executed",
    blockers,
    required_next_steps: [
      "create_capability_envelope_for_target_adapter",
      "approve_capability_envelope",
      "implement_target_specific_adapter",
      "run_adapter_specific_dry_run",
      "revalidate_release_readiness_before_apply",
    ],
    proposed_surface: proposedWrite?.proposed_surface || promotion?.target_surface || null,
    proposed_operation: proposedWrite?.proposed_operation || "would_request_target_adapter_apply",
    raw_transcript_included: false,
    secrets_included: false,
  };
}

async function readPreviewAndPromotion(pool, previewId) {
  const [rows] = await pool.query(
    `SELECT e.preview_id, e.promotion_id, e.insight_id, e.promotion_type AS preview_promotion_type,
            e.target_surface AS preview_target_surface, e.execution_allowed AS preview_execution_allowed,
            e.proposed_write_json, e.blockers_json, e.dry_run_result_json, e.safety_contract_json AS preview_safety_contract_json,
            e.secrets_included AS preview_secrets_included,
            p.promotion_type, p.target_surface, p.decision_status, p.approval_status, p.promotion_status,
            p.promotion_allowed, p.promotion_executor_key, p.proposal_title, p.proposal_text,
            p.tenant_id, p.workspace_key, p.target_scope_type, p.target_scope_ref,
            p.secrets_included AS promotion_secrets_included
       FROM session_insight_promotion_execution_previews e
       LEFT JOIN session_insight_promotions p ON p.promotion_id = e.promotion_id
      WHERE e.preview_id = ?
      LIMIT 1`,
    [previewId]
  );
  return rows[0] || null;
}

export async function createSessionInsightPromotionApplyRequest({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const previewId = assertPreviewId(body.preview_id || body.previewId);
  const requestedBy = cleanString(body.requested_by || body.requestedBy, "session_insight_promotion_apply_request_tool");
  const decisionNotes = cleanString(body.decision_notes || body.decisionNotes || body.request_notes || body.requestNotes);
  const source = await readPreviewAndPromotion(pool, previewId);
  if (!source) {
    const err = new Error("execution preview was not found.");
    err.status = 404;
    err.code = "execution_preview_not_found";
    throw err;
  }
  if (Number(source.preview_secrets_included || 0) !== 0 || Number(source.promotion_secrets_included || 0) !== 0) {
    const err = new Error("secret-flagged preview or promotion cannot create apply request.");
    err.status = 409;
    err.code = "apply_request_secret_flagged_source";
    throw err;
  }
  const proposedWrite = parseMaybeJson(source.proposed_write_json, {});
  const gatingResult = buildGatingResult({
    promotion: {
      decision_status: source.decision_status,
      approval_status: source.approval_status,
      promotion_status: source.promotion_status,
      promotion_allowed: source.promotion_allowed,
      promotion_type: source.promotion_type,
      secrets_included: source.promotion_secrets_included,
      target_surface: source.target_surface,
    },
    preview: {
      execution_allowed: source.preview_execution_allowed,
      secrets_included: source.preview_secrets_included,
    },
    proposedWrite,
  });
  const safetyContract = {
    skeleton_only: true,
    capability_envelope_required: true,
    target_adapter_required: true,
    execution_allowed: false,
    execution_status: "not_executed",
    promotion_allowed_after_request: false,
    promotion_executor_key_assigned: false,
    runtime_promotion_executed: false,
    backlog_policy_canonical_write_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const requestId = applyRequestId();
  await pool.query(
    `INSERT INTO session_insight_promotion_apply_requests
       (apply_request_id, preview_id, promotion_id, insight_id, promotion_type, target_surface,
        requested_operation, request_status, capability_envelope_required, capability_envelope_id,
        adapter_key_required, target_adapter_key, execution_allowed, execution_status,
        proposed_write_json, gating_result_json, safety_contract_json,
        requested_by, decision_notes, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'blocked_requires_capability_envelope', 1, NULL,
             1, NULL, 0, 'not_executed', ?, ?, ?, ?, ?, 0)`,
    [
      requestId,
      source.preview_id,
      source.promotion_id,
      source.insight_id,
      source.promotion_type,
      proposedWrite.proposed_surface || source.target_surface,
      proposedWrite.proposed_operation || "would_request_target_adapter_apply",
      JSON.stringify(proposedWrite),
      JSON.stringify(gatingResult),
      JSON.stringify(safetyContract),
      requestedBy,
      decisionNotes || null,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_promotion_apply_requests WHERE apply_request_id = ? LIMIT 1`,
    [requestId]
  );
  return {
    ok: true,
    apply_request: sanitizeApplyRequest(rows[0] || {
      apply_request_id: requestId,
      preview_id: source.preview_id,
      promotion_id: source.promotion_id,
      insight_id: source.insight_id,
      promotion_type: source.promotion_type,
      target_surface: proposedWrite.proposed_surface || source.target_surface,
      requested_operation: proposedWrite.proposed_operation || "would_request_target_adapter_apply",
      request_status: "blocked_requires_capability_envelope",
      capability_envelope_required: 1,
      adapter_key_required: 1,
      execution_allowed: 0,
      execution_status: "not_executed",
      proposed_write_json: JSON.stringify(proposedWrite),
      gating_result_json: JSON.stringify(gatingResult),
      safety_contract_json: JSON.stringify(safetyContract),
      requested_by: requestedBy,
      decision_notes: decisionNotes || null,
    }),
    safety_contract: safetyContract,
    secrets_included: false,
  };
}
