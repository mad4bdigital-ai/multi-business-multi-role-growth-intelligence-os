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

function sanitizeContract(row = {}) {
  return {
    contract_key: row.contract_key,
    adapter_key: row.adapter_key,
    promotion_type: row.promotion_type,
    target_surface: row.target_surface,
    contract_version: row.contract_version,
    contract_status: row.contract_status,
    contract_mode: row.contract_mode,
    payload_schema: parseMaybeJson(row.payload_schema_json, null),
    required_fields: parseMaybeJson(row.required_fields_json, []),
    forbidden_fields: parseMaybeJson(row.forbidden_fields_json, []),
    sample_payload: parseMaybeJson(row.sample_payload_json, null),
    validator_rules: parseMaybeJson(row.validator_rules_json, []),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    apply_supported: Number(row.apply_supported || 0) === 1,
    execution_allowed: Number(row.execution_allowed || 0) === 1,
    status: row.status,
    secrets_included: false,
  };
}

function sanitizeMapping(row = {}) {
  return {
    apply_request_id: row.apply_request_id,
    preview_id: row.preview_id,
    promotion_id: row.promotion_id,
    promotion_type: row.promotion_type,
    target_surface: row.target_surface,
    adapter_key: row.adapter_key || null,
    contract_key: row.contract_key || null,
    contract_status: row.contract_status || null,
    contract_mode: row.contract_mode || null,
    request_status: row.request_status,
    adapter_readiness_status: row.adapter_readiness_status,
    contract_readiness_status: row.contract_readiness_status,
    execution_allowed: Number(row.execution_allowed || 0) === 1,
    apply_supported: Number(row.apply_supported || 0) === 1,
    blockers: parseMaybeJson(row.blockers_json, []),
    secrets_included: false,
  };
}

export async function readSessionInsightAdapterDryRunContracts({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["c.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);

  for (const [inputKey, columnName] of [
    ["contract_key", "c.contract_key"],
    ["adapter_key", "c.adapter_key"],
    ["promotion_type", "c.promotion_type"],
    ["target_surface", "c.target_surface"],
    ["contract_status", "c.contract_status"],
    ["status", "c.status"],
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
    where.push("(c.contract_key LIKE ? OR c.adapter_key LIKE ? OR c.target_surface LIKE ? OR c.promotion_type LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  params.push(limit);
  const [rows] = await pool.query(
    `SELECT c.*
       FROM session_insight_promotion_adapter_contracts c
      WHERE ${where.join(" AND ")}
      ORDER BY c.target_surface ASC, c.promotion_type ASC, c.contract_key ASC
      LIMIT ?`,
    params
  );

  const [mappingRows] = await pool.query(
    `SELECT r.apply_request_id, r.preview_id, r.promotion_id, r.promotion_type, r.target_surface,
            r.request_status, r.execution_allowed,
            ar.adapter_key, ar.adapter_readiness_status,
            c.contract_key, c.contract_status, c.contract_mode, c.apply_supported,
            CASE
              WHEN r.execution_allowed <> 0 THEN 'invalid_apply_request_execution_allowed'
              WHEN ar.adapter_key IS NULL THEN 'blocked_missing_adapter'
              WHEN c.contract_key IS NULL THEN 'blocked_missing_adapter_contract'
              WHEN c.contract_mode <> 'dry_run_contract' THEN 'blocked_contract_not_dry_run'
              WHEN c.apply_supported <> 0 OR c.execution_allowed <> 0 THEN 'blocked_contract_claims_execution'
              WHEN c.contract_status <> 'active' THEN 'blocked_contract_not_active'
              ELSE 'mapped_dry_run_contract_blocked_for_apply_adapter'
            END AS contract_readiness_status,
            JSON_ARRAY(
              'dry_run_contract_only',
              'target_adapter_apply_not_implemented',
              'capability_envelope_required',
              'apply_supported_false_by_policy'
            ) AS blockers_json
       FROM session_insight_promotion_apply_requests r
       LEFT JOIN v_session_insight_apply_request_adapter_readiness ar
         ON ar.apply_request_id = r.apply_request_id
       LEFT JOIN session_insight_promotion_adapter_contracts c
         ON c.adapter_key = ar.adapter_key
        AND c.status = 'active'
      WHERE r.secrets_included = 0
      ORDER BY r.created_at DESC
      LIMIT ?`,
    [limit]
  );

  return {
    ok: true,
    contract_count: rows.length,
    contracts: rows.map(sanitizeContract),
    apply_request_mapping_count: mappingRows.length,
    apply_request_mappings: mappingRows.map(sanitizeMapping),
    contract_policy: {
      dry_run_contract_only: true,
      apply_supported_default: false,
      execution_allowed: false,
      payload_schema_readback_only: true,
      capability_envelope_required_for_apply: true,
      target_adapter_implementation_required_for_apply: true,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
