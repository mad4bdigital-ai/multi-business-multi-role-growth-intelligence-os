import { getPool } from "./db.js";
import { resolveSurfaceAuthority, SURFACE_KEYS } from "./surfaceAuthorityResolver.js";

function normalizeToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isTruthy(value) {
  return ["true", "1", "yes", "required", "recommended", "repair", "active"].includes(normalizeToken(value));
}

function isReadyStatus(value) {
  return ["ready", "validated", "valid", "not_applicable", "pass", "passed", "ok"].includes(normalizeToken(value));
}

function compactList(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function mapErrorCodeToRepairAction(errorCode = "") {
  const code = normalizeToken(errorCode);
  if (code === "brand_writing_requires_brand_core") return "add_brand_core_assets";
  if (code.includes("brand_core")) return "add_brand_core_assets";
  if (code.includes("surface_authority")) return "repair_surface_authority";
  if (code.includes("readback")) return "repair_readback";
  return "";
}

function sanitizeRepairRow(row = {}) {
  return {
    validation_id: row.validation_id || null,
    entity_key: row.entity_key || null,
    surface_id: row.surface_id || null,
    surface_name: row.surface_name || null,
    rule_id: row.rule_id || null,
    validation_target: row.validation_target || null,
    validation_type: row.validation_type || null,
    validation_method: row.validation_method || null,
    required_for_execution: row.required_for_execution || null,
    validation_status: row.validation_status || null,
    result_state: row.result_state || null,
    repair_action: row.repair_action || row.repair_type || null,
    repair_handler: row.repair_handler_ext || row.repair_handler || null,
    repair_stage: row.repair_stage || null,
    repair_owner: row.repair_owner || null,
    repair_required: row.repair_required || row.binding_repair_required || null,
    repair_recommended: row.repair_recommended || null,
    repair_status: row.repair_status || null,
    readback_required: row.readback_required || null,
    priority: row.priority || null,
    severity: row.severity || null,
    stability_band: row.stability_band || null,
    execution_readiness_status: row.execution_readiness_status || null,
    updated_at: row.updated_at || null,
    secrets_included: false,
  };
}

function repairCandidateScore(row = {}) {
  let score = 0;
  if (isTruthy(row.repair_required) || isTruthy(row.binding_repair_required)) score += 50;
  if (isTruthy(row.repair_recommended)) score += 30;
  if (isTruthy(row.required_for_execution)) score += 20;
  if (["critical", "high"].includes(normalizeToken(row.severity))) score += 15;
  if (["critical", "high"].includes(normalizeToken(row.priority))) score += 10;
  if (!isReadyStatus(row.validation_status) || !isReadyStatus(row.result_state)) score += 5;
  return score;
}

export async function resolveRepairCandidates({
  entityKey = "",
  validationTarget = "",
  surfaceKey = "",
  surfaceName = "",
  errorCodes = [],
  limit = 5,
} = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const surfaceAuthority = await resolveSurfaceAuthority(
    SURFACE_KEYS.VALIDATION_REPAIR_REGISTRY,
    { requireExecution: true },
    { pool }
  );

  if (!surfaceAuthority.ok) {
    return {
      ok: false,
      classification: "repair_registry_unavailable",
      reason: surfaceAuthority.reason,
      repair_candidates: [],
      surface_authority: surfaceAuthority,
      secrets_included: false,
    };
  }

  const normalizedEntity = String(entityKey || validationTarget || "").trim();
  const normalizedTarget = String(validationTarget || entityKey || "").trim();
  const normalizedSurface = String(surfaceKey || "").trim();
  const normalizedSurfaceName = String(surfaceName || "").trim();
  const mappedActions = compactList(errorCodes.map(mapErrorCodeToRepairAction));

  const where = [];
  const params = [];
  if (normalizedEntity) {
    where.push("(entity_key = ? OR validation_target = ?)");
    params.push(normalizedEntity, normalizedTarget || normalizedEntity);
  }
  if (normalizedSurface || normalizedSurfaceName) {
    where.push("(surface_id = ? OR target_surface_id = ? OR surface_name = ?)");
    params.push(normalizedSurface, normalizedSurface, normalizedSurfaceName || normalizedSurface);
  }
  if (mappedActions.length) {
    where.push(`(repair_action IN (${mappedActions.map(() => "?").join(",")}) OR repair_type IN (${mappedActions.map(() => "?").join(",")}))`);
    params.push(...mappedActions, ...mappedActions);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT validation_id, entity_key, surface_id, surface_name, rule_id,
            validation_target, target_surface_id, validation_type, validation_method,
            required_for_execution, validation_status, result_state,
            repair_action, repair_handler, repair_stage,
            binding_repair_required, repair_recommended, repair_owner,
            repair_status, repair_required, priority, severity, stability_band,
            execution_readiness_status, readback_required, repair_type,
            repair_handler_ext, updated_at
       FROM \`validation_repair\`
       ${whereSql}
      ORDER BY
        CASE WHEN COALESCE(repair_required, binding_repair_required) IN ('TRUE','true','1','yes') THEN 0 ELSE 1 END,
        CASE WHEN repair_recommended IN ('TRUE','true','1','yes') THEN 0 ELSE 1 END,
        CASE WHEN severity IN ('critical','high') THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT ?`,
    [...params, Math.max(1, Math.min(Number(limit || 5), 20))]
  );

  const scored = rows
    .map((row) => ({ row, score: repairCandidateScore(row) }))
    .sort((a, b) => b.score - a.score)
    .map(({ row, score }) => ({ ...sanitizeRepairRow(row), score }));

  return {
    ok: true,
    classification: scored.length ? "repair_candidates_found" : "no_repair_candidates_found",
    repair_candidates: scored,
    candidate_count: scored.length,
    query: {
      entity_key: normalizedEntity || null,
      validation_target: normalizedTarget || null,
      surface_key: normalizedSurface || null,
      surface_name: normalizedSurfaceName || null,
      mapped_repair_actions: mappedActions,
    },
    surface_authority: {
      ok: surfaceAuthority.ok,
      resolved_surface_key: surfaceAuthority.resolved_surface_key,
      classification: surfaceAuthority.classification,
      code: surfaceAuthority.code,
    },
    secrets_included: false,
  };
}

export async function resolveBrandCoreRepairCandidates(brandKey, errorCodes = ["brand_writing_requires_brand_core"], deps = {}) {
  return resolveRepairCandidates({
    entityKey: brandKey,
    validationTarget: brandKey,
    surfaceKey: SURFACE_KEYS.BRAND_CORE_REGISTRY,
    surfaceName: "Brand Core Registry",
    errorCodes,
    limit: 5,
  }, deps);
}
