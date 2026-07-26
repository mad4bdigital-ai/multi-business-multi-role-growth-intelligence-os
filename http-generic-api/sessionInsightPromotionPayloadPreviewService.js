import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function payloadPreviewId() {
  return `payload_preview_${randomUUID()}`;
}

function assertApplyRequestId(applyRequestId) {
  const value = cleanString(applyRequestId);
  if (!value) {
    const err = new Error("apply_request_id is required.");
    err.status = 400;
    err.code = "apply_request_id_required";
    throw err;
  }
  return value;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return "";
}

function truncateText(value, max = 2000) {
  const text = cleanString(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function buildPayloadForContract(source = {}) {
  const proposedWrite = parseMaybeJson(source.proposed_write_json, {});
  const samplePayload = parseMaybeJson(source.sample_payload_json, {});
  const promotionType = source.promotion_type;
  const base = {
    source_promotion_id: source.promotion_id,
    source_insight_id: source.insight_id,
    risk_level: source.risk_level || "medium",
    confidence: Number(source.confidence ?? 0),
  };
  const title = truncateText(firstNonEmpty(proposedWrite.title, source.proposal_title, samplePayload.title, "Session insight promotion draft"), 255);
  if (promotionType === "development_backlog_item") {
    return {
      title,
      description: truncateText(firstNonEmpty(proposedWrite.body, source.proposal_text, source.statement_text, samplePayload.description), 4000),
      acceptance_criteria: [
        "Capability envelope exists before any apply action.",
        "Target adapter implementation is registered and tested.",
        "Release readiness passes before execution.",
      ],
      ...base,
    };
  }
  if (promotionType === "runtime_repair_backlog_item") {
    return {
      title,
      problem_statement: truncateText(firstNonEmpty(proposedWrite.body, source.proposal_text, source.statement_text, samplePayload.problem_statement), 2000),
      evidence_summary: truncateText(`Derived from session insight ${source.insight_id || "unknown"} and promotion ${source.promotion_id || "unknown"}.`, 2000),
      suggested_next_action: truncateText(firstNonEmpty(samplePayload.suggested_next_action, "Design a governed repair task after capability approval."), 1000),
      ...base,
    };
  }
  if (promotionType === "integration_backlog_item") {
    return {
      title,
      integration_need: truncateText(firstNonEmpty(proposedWrite.body, source.proposal_text, source.statement_text, samplePayload.integration_need), 3000),
      target_system: truncateText(firstNonEmpty(proposedWrite.target_system, source.target_scope_ref, samplePayload.target_system, "to_be_resolved_by_review"), 255),
      ...base,
    };
  }
  return {
    title,
    description: truncateText(firstNonEmpty(proposedWrite.body, source.proposal_text, source.statement_text, "Manual review required."), 4000),
    ...base,
  };
}

function validatePayloadAgainstContract(payload = {}, source = {}) {
  const required = parseMaybeJson(source.required_fields_json, []);
  const forbidden = parseMaybeJson(source.forbidden_fields_json, []);
  const missing = required.filter((field) => !(field in payload) || payload[field] === null || payload[field] === undefined || payload[field] === "");
  const serialized = JSON.stringify(payload).toLowerCase();
  const forbiddenHits = forbidden.filter((term) => serialized.includes(String(term).toLowerCase()));
  const issues = [];
  if (missing.length) issues.push("payload_missing_required_fields");
  if (forbiddenHits.length) issues.push("payload_contains_forbidden_terms");
  return {
    valid_for_dry_run_contract: missing.length === 0 && forbiddenHits.length === 0,
    missing_fields: missing,
    forbidden_term_hits: forbiddenHits,
    validation_issues: issues,
    dry_run_only: true,
    execution_allowed: false,
    secrets_included: false,
  };
}

function sanitizePayloadPreview(row = {}) {
  return {
    payload_preview_id: row.payload_preview_id,
    apply_request_id: row.apply_request_id,
    preview_id: row.preview_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    adapter_key: row.adapter_key,
    contract_key: row.contract_key,
    target_surface: row.target_surface,
    promotion_type: row.promotion_type,
    payload_status: row.payload_status,
    payload_mode: row.payload_mode,
    execution_allowed: Number(row.execution_allowed || 0) === 1,
    target_write_allowed: Number(row.target_write_allowed || 0) === 1,
    payload_json: parseMaybeJson(row.payload_json, null),
    validation_result: parseMaybeJson(row.validation_result_json, null),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    created_by: row.created_by || null,
    created_at: row.created_at || null,
    secrets_included: false,
  };
}

async function readApplyRequestContractSource(pool, applyRequestId) {
  const [rows] = await pool.query(
    `SELECT r.apply_request_id, r.preview_id, r.promotion_id, r.insight_id, r.promotion_type, r.target_surface,
            r.request_status, r.execution_allowed AS apply_request_execution_allowed,
            r.proposed_write_json, r.secrets_included AS apply_request_secrets_included,
            p.proposal_title, p.proposal_text, p.risk_level, p.confidence, p.secrets_included AS promotion_secrets_included,
            c.contract_key, c.adapter_key, c.contract_mode, c.contract_status,
            c.payload_schema_json, c.required_fields_json, c.forbidden_fields_json,
            c.sample_payload_json, c.validator_rules_json, c.safety_contract_json AS contract_safety_contract_json,
            c.apply_supported, c.execution_allowed AS contract_execution_allowed,
            c.secrets_included AS contract_secrets_included,
            ar.adapter_readiness_status,
            cr.contract_readiness_status
       FROM session_insight_promotion_apply_requests r
       LEFT JOIN session_insight_promotions p ON p.promotion_id = r.promotion_id
       LEFT JOIN v_session_insight_apply_request_adapter_readiness ar ON ar.apply_request_id = r.apply_request_id
       LEFT JOIN session_insight_promotion_adapter_contracts c ON c.adapter_key = ar.adapter_key AND c.status = 'active'
       LEFT JOIN v_session_insight_apply_request_contract_readiness cr ON cr.apply_request_id = r.apply_request_id
      WHERE r.apply_request_id = ?
      LIMIT 1`,
    [applyRequestId]
  );
  return rows[0] || null;
}

export async function generateSessionInsightContractPayloadPreview({ pool = getPool(), input = {} } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const applyRequestId = assertApplyRequestId(body.apply_request_id || body.applyRequestId);
  const createdBy = cleanString(body.created_by || body.createdBy, "session_insight_contract_payload_preview_tool");
  const source = await readApplyRequestContractSource(pool, applyRequestId);
  if (!source) {
    const err = new Error("apply request was not found.");
    err.status = 404;
    err.code = "apply_request_not_found";
    throw err;
  }
  if (Number(source.apply_request_secrets_included || 0) !== 0
    || Number(source.promotion_secrets_included || 0) !== 0
    || Number(source.contract_secrets_included || 0) !== 0) {
    const err = new Error("secret-flagged apply request, promotion, or contract cannot generate payload preview.");
    err.status = 409;
    err.code = "payload_preview_secret_flagged_source";
    throw err;
  }
  const blockers = [];
  if (!source.contract_key) blockers.push("missing_active_adapter_contract");
  if (source.contract_mode !== "dry_run_contract") blockers.push("contract_not_dry_run");
  if (source.contract_status !== "active") blockers.push("contract_not_active");
  if (Number(source.apply_supported || 0) !== 0 || Number(source.contract_execution_allowed || 0) !== 0) blockers.push("contract_claims_execution");
  if (Number(source.apply_request_execution_allowed || 0) !== 0) blockers.push("apply_request_execution_allowed_invalid");
  blockers.push("dry_run_payload_preview_only");
  blockers.push("target_adapter_apply_not_implemented");
  blockers.push("capability_envelope_required_before_apply");

  const payload = buildPayloadForContract(source);
  const validation = validatePayloadAgainstContract(payload, source);
  const payloadStatus = validation.valid_for_dry_run_contract && !blockers.includes("missing_active_adapter_contract")
    ? "payload_preview_generated"
    : "payload_preview_blocked";
  const safetyContract = {
    payload_preview_only: true,
    dry_run_contract_only: true,
    execution_allowed: false,
    target_write_allowed: false,
    promotion_allowed_after_preview: false,
    adapter_apply_executed: false,
    runtime_promotion_executed: false,
    backlog_policy_canonical_write_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    external_write_executed: false,
    raw_transcript_included: false,
    secrets_included: false,
  };
  const id = payloadPreviewId();
  await pool.query(
    `INSERT INTO session_insight_promotion_payload_previews
       (payload_preview_id, apply_request_id, preview_id, promotion_id, insight_id,
        adapter_key, contract_key, target_surface, promotion_type,
        payload_status, payload_mode, execution_allowed, target_write_allowed,
        payload_json, validation_result_json, safety_contract_json, created_by, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dry_run_payload_preview', 0, 0, ?, ?, ?, ?, 0)`,
    [
      id,
      source.apply_request_id,
      source.preview_id,
      source.promotion_id,
      source.insight_id,
      source.adapter_key,
      source.contract_key,
      source.target_surface,
      source.promotion_type,
      payloadStatus,
      JSON.stringify(payload),
      JSON.stringify({ ...validation, blockers }),
      JSON.stringify(safetyContract),
      createdBy,
    ]
  );
  const [rows] = await pool.query(
    `SELECT * FROM session_insight_promotion_payload_previews WHERE payload_preview_id = ? LIMIT 1`,
    [id]
  );
  return {
    ok: true,
    payload_preview: sanitizePayloadPreview(rows[0] || {
      payload_preview_id: id,
      apply_request_id: source.apply_request_id,
      preview_id: source.preview_id,
      promotion_id: source.promotion_id,
      insight_id: source.insight_id,
      adapter_key: source.adapter_key,
      contract_key: source.contract_key,
      target_surface: source.target_surface,
      promotion_type: source.promotion_type,
      payload_status: payloadStatus,
      payload_mode: "dry_run_payload_preview",
      execution_allowed: 0,
      target_write_allowed: 0,
      payload_json: JSON.stringify(payload),
      validation_result_json: JSON.stringify({ ...validation, blockers }),
      safety_contract_json: JSON.stringify(safetyContract),
      created_by: createdBy,
    }),
    safety_contract: safetyContract,
    secrets_included: false,
  };
}
