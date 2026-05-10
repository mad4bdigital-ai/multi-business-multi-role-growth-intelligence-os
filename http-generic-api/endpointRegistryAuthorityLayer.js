import { getPool } from "./db.js";

function boolFromEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function getEndpointRegistryAuthorityStatus(env = process.env) {
  const sourceMode = String(env.ENDPOINT_REGISTRY_SOURCE || "sql_emulated_sheet").trim().toLowerCase();
  const legacySheetActive =
    sourceMode === "sheets" && boolFromEnv(env.LEGACY_SHEET_ENDPOINT_REGISTRY_ENABLED, false);

  return {
    source_mode: sourceMode,
    active_runtime_source: sourceMode === "sheets" ? "legacy_sheet" : "sql_emulated_sheet",
    sql_emulated_sheet_active: sourceMode !== "sheets",
    legacy_sheet_available: true,
    legacy_sheet_active: legacySheetActive,
    legacy_sheet_activation_policy:
      "Legacy sheet endpoint registry remains separate and inactive unless ENDPOINT_REGISTRY_SOURCE=sheets and LEGACY_SHEET_ENDPOINT_REGISTRY_ENABLED=true.",
  };
}

export function assertSqlEndpointRegistryAuthority(env = process.env) {
  const status = getEndpointRegistryAuthorityStatus(env);
  if (!status.sql_emulated_sheet_active) {
    const err = new Error("SQL-emulated endpoint registry authority is inactive.");
    err.status = 503;
    err.code = "sql_endpoint_registry_authority_inactive";
    err.details = status;
    throw err;
  }
  return status;
}

function stringifyValue(value) {
  if (value === undefined || value === null) return "";
  return String(value);
}

export function endpointSqlRowToSheetShape(row = {}) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "id" || key === "created_at" || key === "updated_at") continue;
    out[key] = stringifyValue(value);
  }
  return out;
}

function normalizeLimit(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.trunc(parsed), 500);
}

function buildWhere(filters = {}) {
  const where = [];
  const params = [];

  for (const key of ["parent_action_key", "endpoint_key", "status"]) {
    const value = String(filters[key] || "").trim();
    if (value) {
      where.push(`${key} = ?`);
      params.push(value);
    }
  }

  return { where, params };
}

export async function loadEndpointRegistrySqlEmulated(filters = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const limit = normalizeLimit(filters.limit, 100);
  const { where, params } = buildWhere(filters);

  const [rows] = await pool.query(
    `SELECT * FROM endpoints ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY parent_action_key, endpoint_key LIMIT ?`,
    [...params, limit],
  );

  return rows.map(endpointSqlRowToSheetShape);
}

export async function resolveEndpointSqlEmulated(parentActionKey, endpointKey, deps = {}) {
  const normalizedParentActionKey = String(parentActionKey || "").trim();
  const normalizedEndpointKey = String(endpointKey || "").trim();

  if (!normalizedParentActionKey || !normalizedEndpointKey) {
    const err = new Error("parent_action_key and endpoint_key are required.");
    err.status = 400;
    err.code = "missing_required_endpoint_identity";
    throw err;
  }

  const pool = deps.pool || getPool();
  const [rows] = await pool.query(
    `SELECT * FROM endpoints
       WHERE parent_action_key = ?
         AND endpoint_key = ?
         AND status NOT IN ('deprecated', 'archived')
       ORDER BY FIELD(status, 'active') DESC, id DESC
       LIMIT 1`,
    [normalizedParentActionKey, normalizedEndpointKey],
  );

  if (!rows.length) {
    const err = new Error(
      `Endpoint not found in SQL endpoint registry: ${normalizedParentActionKey}/${normalizedEndpointKey}`,
    );
    err.status = 404;
    err.code = "endpoint_not_found";
    err.details = {
      source_mode: "sql_emulated_sheet",
      parent_action_key: normalizedParentActionKey,
      endpoint_key: normalizedEndpointKey,
    };
    throw err;
  }

  return endpointSqlRowToSheetShape(rows[0]);
}

export function describeEndpointRegistryLayer(env = process.env) {
  return {
    layer: "sql_emulated_endpoint_registry",
    purpose:
      "Emulates API Actions Endpoint Registry sheet rows from SQL while keeping the legacy sheet path separate and inactive.",
    ...getEndpointRegistryAuthorityStatus(env),
  };
}
