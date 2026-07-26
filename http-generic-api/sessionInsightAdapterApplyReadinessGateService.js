import { getPool } from "./db.js";

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

function boolValue(value) {
  return Number(value || 0) === 1 || value === true;
}

function sanitizeGateRow(row = {}) {
  return {
    payload_preview_id: row.payload_preview_id,
    apply_request_id: row.apply_request_id,
    promotion_id: row.promotion_id,
    insight_id: row.insight_id,
    promotion_type: row.promotion_type,
    target_surface: row.target_surface,
    adapter_key: row.adapter_key || null,
    contract_key: row.contract_key || null,
    promotion_approval_status: row.promotion_approval_status || null,
    promotion_status: row.promotion_status || null,
    payload_review_status: row.payload_review_status || null,
    payload_decision_status: row.payload_decision_status || null,
    request_status: row.request_status || null,
    adapter_implementation_status: row.adapter_implementation_status || null,
    capability_envelope_required: boolValue(row.capability_envelope_required),
    capability_envelope_id: row.capability_envelope_id || null,
    target_adapter_key: row.target_adapter_key || null,
    promotion_allowed: boolValue(row.promotion_allowed),
    execution_allowed: boolValue(row.execution_allowed),
    target_write_allowed: boolValue(row.target_write_allowed),
    adapter_apply_supported: boolValue(row.adapter_apply_supported),
    contract_apply_supported: boolValue(row.contract_apply_supported),
    contract_execution_allowed: boolValue(row.contract_execution_allowed),
    valid_for_dry_run_contract: boolValue(row.valid_for_dry_run_contract),
    gate_status: row.gate_status,
    blockers: parseMaybeJson(row.blockers_json, []),
    readiness_evidence: parseMaybeJson(row.readiness_evidence_json, null),
    secrets_included: false,
  };
}

export async function listSessionInsightAdapterApplyReadinessGate({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["g.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);

  for (const [inputKey, columnName] of [
    ["payload_preview_id", "g.payload_preview_id"],
    ["apply_request_id", "g.apply_request_id"],
    ["promotion_id", "g.promotion_id"],
    ["promotion_type", "g.promotion_type"],
    ["target_surface", "g.target_surface"],
    ["adapter_key", "g.adapter_key"],
    ["contract_key", "g.contract_key"],
    ["gate_status", "g.gate_status"],
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
    where.push("(g.payload_preview_id = ? OR g.apply_request_id = ? OR g.promotion_id = ? OR g.adapter_key LIKE ? OR g.gate_status LIKE ?)");
    params.push(q, q, q, `%${q}%`, `%${q}%`);
  }

  params.push(limit);
  const [rows] = await pool.query(
    `SELECT g.*
       FROM v_session_insight_adapter_apply_readiness_gate g
      WHERE ${where.join(" AND ")}
      ORDER BY FIELD(g.gate_status,
        'ready_but_blocked_requires_capability_envelope_and_apply_adapter',
        'blocked_payload_not_approved',
        'blocked_promotion_not_approved_ready',
        'blocked_payload_contract_invalid',
        'invalid_execution_or_target_write_claim',
        'secret_flagged_source'),
        g.payload_preview_id ASC
      LIMIT ?`,
    params
  );

  const [summaryRows] = await pool.query(
    `SELECT gate_status, target_surface, COUNT(*) AS count
       FROM v_session_insight_adapter_apply_readiness_gate
      WHERE secrets_included = 0
      GROUP BY gate_status, target_surface
      ORDER BY gate_status, target_surface`
  );

  const [issueRows] = await pool.query(
    `SELECT issue_code, severity, COUNT(*) AS count
       FROM v_session_insight_adapter_apply_readiness_gate_issues
      GROUP BY issue_code, severity
      ORDER BY severity, issue_code`
  );

  return {
    ok: true,
    count: rows.length,
    gates: rows.map(sanitizeGateRow),
    summary: summaryRows.map((row) => ({
      gate_status: row.gate_status,
      target_surface: row.target_surface,
      count: Number(row.count || 0),
    })),
    issues: issueRows.map((row) => ({
      issue_code: row.issue_code,
      severity: row.severity,
      count: Number(row.count || 0),
    })),
    gate_policy: {
      read_only_gate: true,
      adapter_apply_executed: false,
      approval_sets_execution_allowed: false,
      approval_sets_target_write_allowed: false,
      promotion_allowed_must_remain_false_in_gate: true,
      target_adapter_implementation_required: true,
      capability_envelope_required: true,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
