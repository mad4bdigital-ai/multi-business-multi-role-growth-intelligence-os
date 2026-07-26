import { getPool } from "./db.js";

function normalizeToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isTruthy(value) {
  return ["true", "1", "yes", "active", "required", "authoritative"].includes(normalizeToken(value));
}

function isInactive(value) {
  return ["false", "0", "no", "inactive", "disabled", "archived", "archived_placeholder", "retired"].includes(normalizeToken(value));
}

function isAuthoritativeStatus(value) {
  return ["authoritative", "authoritative_candidate", "legacy_alias"].includes(normalizeToken(value));
}

function sanitizeSurfaceRow(row = {}) {
  if (!row) return null;
  return {
    surface_id: row.surface_id || null,
    logical_surface_key: row.logical_surface_key || null,
    surface_name: row.surface_name || null,
    surface_type: row.surface_type || null,
    surface_scope: row.surface_scope || null,
    storage_type: row.storage_type || null,
    active_status: row.active_status || null,
    authority_status: row.authority_status || null,
    required_for_execution: row.required_for_execution || null,
    resolution_rule: row.resolution_rule || null,
    owner_layer: row.owner_layer || null,
    schema_ref: row.schema_ref || null,
    schema_version: row.schema_version || null,
    binding_mode: row.binding_mode || null,
    sheet_role: row.sheet_role || null,
    source_surface_id: row.source_surface_id || null,
    source_surface_role: row.source_surface_role || null,
    retired_replacement_surface_id: row.retired_replacement_surface_id || null,
    backend_type: row.backend_type || null,
    backend_adapter: row.backend_adapter || null,
    authority_model: row.authority_model || null,
    portability_class: row.portability_class || null,
    repair_candidate_types: row.repair_candidate_types || null,
    repair_priority: row.repair_priority || null,
    updated_at: row.updated_at || null,
  };
}

async function findSurfaceRow(pool, surfaceKey) {
  const key = String(surfaceKey || "").trim();
  if (!key) return null;
  const [rows] = await pool.query(
    `SELECT surface_id, logical_surface_key, surface_name, surface_type, surface_scope,
            storage_type, active_status, authority_status, required_for_execution,
            resolution_rule, owner_layer, schema_ref, schema_version, binding_mode,
            sheet_role, source_surface_id, source_surface_role,
            retired_replacement_surface_id, backend_type, backend_adapter,
            authority_model, portability_class, repair_candidate_types,
            repair_priority, updated_at
       FROM \`registry_surfaces_catalog\`
      WHERE surface_id = ? OR logical_surface_key = ? OR surface_name = ?
      ORDER BY CASE
        WHEN surface_id = ? THEN 0
        WHEN logical_surface_key = ? THEN 1
        ELSE 2
      END, updated_at DESC
      LIMIT 1`,
    [key, key, key, key, key]
  );
  return rows[0] || null;
}

function evaluateSurface(row, { requireExecution = false } = {}) {
  if (!row) {
    return {
      ok: false,
      classification: requireExecution ? "blocked" : "missing",
      code: "surface_not_found",
      reason: "Registry surface was not found in registry_surfaces_catalog.",
    };
  }

  if (isInactive(row.active_status)) {
    return {
      ok: false,
      classification: "blocked",
      code: "surface_inactive",
      reason: "Registry surface is inactive, disabled, archived, or retired.",
    };
  }

  if (!isAuthoritativeStatus(row.authority_status)) {
    return {
      ok: !requireExecution,
      classification: requireExecution ? "blocked" : "advisory",
      code: "surface_not_authoritative",
      reason: "Registry surface is not marked authoritative.",
    };
  }

  if (requireExecution && row.required_for_execution && !isTruthy(row.required_for_execution)) {
    return {
      ok: false,
      classification: "blocked",
      code: "surface_not_required_for_execution",
      reason: "Required execution surface is not marked required_for_execution.",
    };
  }

  return {
    ok: true,
    classification: row.authority_status === "authoritative_candidate" ? "allow_with_surface_warning" : "allow",
    code: "surface_authorized",
    reason: "Registry surface is active and authoritative.",
  };
}

export async function resolveSurfaceAuthority(surfaceKey, options = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const maxDepth = Number(options.maxDepth || 3);
  const visited = [];
  let currentKey = surfaceKey;
  let row = null;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    row = await findSurfaceRow(pool, currentKey);
    if (!row) break;
    visited.push(row.surface_id || currentKey);
    const replacement = String(row.retired_replacement_surface_id || "").trim();
    if (normalizeToken(row.authority_status) === "legacy_alias" && replacement && !visited.includes(replacement)) {
      currentKey = replacement;
      continue;
    }
    break;
  }

  const sanitized = sanitizeSurfaceRow(row);
  const decision = evaluateSurface(sanitized, options);
  return {
    ...decision,
    requested_surface_key: surfaceKey,
    resolved_surface_key: sanitized?.surface_id || null,
    resolution_chain: visited,
    surface: sanitized,
    secrets_included: false,
  };
}

export async function assertSurfaceAuthority(surfaceKey, options = {}, deps = {}) {
  const result = await resolveSurfaceAuthority(surfaceKey, options, deps);
  if (result.ok) return result;
  const err = new Error(`Surface authority check failed: ${result.code}`);
  err.status = 403;
  err.code = "surface_authority_check_failed";
  err.details = result;
  throw err;
}

export const SURFACE_KEYS = Object.freeze({
  EXECUTION_POLICY_REGISTRY: "surface.execution_policy_registry_sheet",
  REGISTRY_SURFACES_CATALOG: "surface.registry_surfaces_catalog_sheet",
  VALIDATION_REPAIR_REGISTRY: "surface.validation_and_repair_registry_sheet",
  BRAND_CORE_REGISTRY: "surface.brand_core_registry_sheet",
  BRAND_REGISTRY: "surface.brand_registry_sheet",
  TASK_ROUTES: "surface.task_routes_sheet",
  WORKFLOW_REGISTRY: "surface.workflow_registry_sheet",
  ACTION_REGISTRY: "surface.actions_registry_sheet",
  ENDPOINT_REGISTRY: "surface.endpoint_registry_sheet",
  TOOL_MANIFEST: "surface.platform_tool_manifest",
  EXECUTION_LOG: "surface.operations_log_unified_sheet",
  JSON_ASSET_REGISTRY: "surface.json_asset_registry_sheet",
  PLATFORM_GRAPH_MEMORY: "surface.platform_graph_memory",
  SESSION_SUMMARY_MEMORY: "surface.session_summary_memory",
});
