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

function sanitizeAdapter(row = {}) {
  return {
    adapter_key: row.adapter_key,
    display_name: row.display_name,
    promotion_type: row.promotion_type,
    target_surface: row.target_surface,
    target_operation: row.target_operation,
    adapter_family: row.adapter_family,
    implementation_status: row.implementation_status,
    execution_mode: row.execution_mode,
    apply_supported: Number(row.apply_supported || 0) === 1,
    capability_key_required: row.capability_key_required || null,
    capability_envelope_required: Number(row.capability_envelope_required || 0) === 1,
    dry_run_tool_key: row.dry_run_tool_key || null,
    apply_tool_key: row.apply_tool_key || null,
    policy_key: row.policy_key || null,
    validator_commands: parseMaybeJson(row.validator_commands_json, []),
    safety_contract: parseMaybeJson(row.safety_contract_json, null),
    status: row.status,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

function sanitizeApplyRequestMapping(row = {}) {
  return {
    apply_request_id: row.apply_request_id,
    preview_id: row.preview_id,
    promotion_id: row.promotion_id,
    promotion_type: row.promotion_type,
    target_surface: row.target_surface,
    requested_operation: row.requested_operation,
    request_status: row.request_status,
    execution_allowed: Number(row.execution_allowed || 0) === 1,
    execution_status: row.execution_status,
    adapter_key: row.adapter_key || null,
    adapter_status: row.adapter_status || null,
    adapter_apply_supported: Number(row.adapter_apply_supported || 0) === 1,
    capability_key_required: row.capability_key_required || null,
    mapping_status: row.mapping_status,
    blockers: parseMaybeJson(row.blockers_json, []),
    secrets_included: false,
  };
}

export async function readSessionInsightTargetAdapterRegistry({ pool = getPool(), filters = {} } = {}) {
  const body = filters && typeof filters === "object" ? filters : {};
  const where = ["a.secrets_included = 0"];
  const params = [];
  const limit = boundedInt(body.limit, 25, 1, 100);

  for (const [inputKey, columnName] of [
    ["adapter_key", "a.adapter_key"],
    ["promotion_type", "a.promotion_type"],
    ["target_surface", "a.target_surface"],
    ["adapter_family", "a.adapter_family"],
    ["implementation_status", "a.implementation_status"],
    ["status", "a.status"],
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
    where.push("(a.adapter_key LIKE ? OR a.display_name LIKE ? OR a.target_surface LIKE ? OR a.promotion_type LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  params.push(limit);
  const [rows] = await pool.query(
    `SELECT a.*
       FROM session_insight_promotion_target_adapters a
      WHERE ${where.join(" AND ")}
      ORDER BY a.target_surface ASC, a.promotion_type ASC, a.adapter_key ASC
      LIMIT ?`,
    params
  );

  const [mappingRows] = await pool.query(
    `SELECT r.apply_request_id, r.preview_id, r.promotion_id, r.promotion_type, r.target_surface,
            r.requested_operation, r.request_status, r.execution_allowed, r.execution_status,
            a.adapter_key, a.status AS adapter_status, a.apply_supported AS adapter_apply_supported,
            a.capability_key_required,
            CASE
              WHEN r.execution_allowed <> 0 THEN 'invalid_apply_request_execution_allowed'
              WHEN a.adapter_key IS NULL THEN 'blocked_missing_target_adapter'
              WHEN a.apply_supported <> 0 THEN 'blocked_adapter_claims_apply_supported'
              WHEN a.implementation_status <> 'skeleton' THEN 'blocked_adapter_not_skeleton'
              ELSE 'mapped_skeleton_blocked_for_capability_envelope'
            END AS mapping_status,
            JSON_ARRAY(
              'capability_envelope_required',
              'target_adapter_apply_not_implemented',
              'apply_supported_false_by_policy'
            ) AS blockers_json
       FROM session_insight_promotion_apply_requests r
       LEFT JOIN session_insight_promotion_target_adapters a
         ON a.promotion_type = r.promotion_type
        AND a.target_surface = r.target_surface
        AND a.status = 'active'
      WHERE r.secrets_included = 0
      ORDER BY r.created_at DESC
      LIMIT ?`,
    [limit]
  );

  return {
    ok: true,
    adapter_count: rows.length,
    adapters: rows.map(sanitizeAdapter),
    apply_request_mapping_count: mappingRows.length,
    apply_request_mappings: mappingRows.map(sanitizeApplyRequestMapping),
    registry_policy: {
      registry_only: true,
      apply_supported_default: false,
      adapters_are_skeletons: true,
      capability_envelope_required: true,
      target_adapter_implementation_required_for_apply: true,
      execution_allowed: false,
      raw_transcript_included: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
