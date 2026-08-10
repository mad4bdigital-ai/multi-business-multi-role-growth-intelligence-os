import crypto from "node:crypto";
import { DATA_SOURCE_MODE } from "./dataSource.js";
import { readTableDirect as sqlReadTableDirect } from "./sqlAdapter.js";

export function toSheetCellValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

export function toA1Start(sheetName, deps = {}) {
  return deps.toValuesApiRange(sheetName, "A1");
}

export async function readLiveSheetShape(spreadsheetId, sheetName, rangeA1, deps = {}) {
  const { getGoogleClientsForSpreadsheet, headerMap } = deps;
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: rangeA1
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(value => String(value || "").trim());
  const row2 = (values[1] || []).map(value => String(value || "").trim());

  if (!header.length) {
    const err = new Error(`${sheetName} header row is empty.`);
    err.code = "sheet_header_missing";
    err.status = 500;
    throw err;
  }

  return {
    header,
    row2,
    headerMap: headerMap(header, sheetName),
    columnCount: header.length
  };
}

export function buildExpectedHeaderSignatureFromCanonical(columns = []) {
  return (columns || []).map(value => String(value || "").trim()).join("|");
}

export function normalizeExpectedColumnCount(value, fallbackColumns = []) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  return Array.isArray(fallbackColumns) ? fallbackColumns.length : 0;
}

function normalizeSurfaceCatalogRow(row = {}) {
  if (!row || typeof row !== "object") return null;
  return {
    surface_id: String(row.surface_id || "").trim(),
    surface_name: String(row.surface_name || "").trim(),
    worksheet_name: String(row.worksheet_name || "").trim(),
    worksheet_gid: String(row.worksheet_gid || "").trim(),
    active_status: String(row.active_status || "").trim(),
    authority_status: String(row.authority_status || "").trim(),
    required_for_execution: String(row.required_for_execution || "").trim(),
    schema_ref: String(row.schema_ref || "").trim(),
    schema_version: String(row.schema_version || "").trim(),
    header_signature: String(row.header_signature || "").trim(),
    expected_column_count: String(row.expected_column_count ?? "").trim(),
    binding_mode: String(row.binding_mode || "").trim(),
    sheet_role: String(row.sheet_role || "").trim(),
    audit_mode: String(row.audit_mode || "").trim(),
    legacy_surface_containment_required: String(row.legacy_surface_containment_required || "").trim(),
    repair_candidate_types: String(row.repair_candidate_types || "").trim(),
    repair_priority: String(row.repair_priority || "").trim(),
  };
}

async function getSqlSurfaceCatalogRow(surfaceId, deps = {}) {
  const readTableDirect = deps.sqlReadTableDirect || sqlReadTableDirect;
  const rows = await readTableDirect("Registry Surfaces Catalog");
  const normalizedSurfaceId = String(surfaceId || "").trim();
  const matches = (Array.isArray(rows) ? rows : []).filter(
    (row) => String(row?.surface_id || "").trim() === normalizedSurfaceId
  );
  if (matches.length > 1) {
    const err = new Error(`Registry Surfaces Catalog contains duplicate surface_id: ${normalizedSurfaceId}`);
    err.code = "registry_surface_catalog_ambiguous";
    err.status = 409;
    throw err;
  }
  return matches.length === 1 ? normalizeSurfaceCatalogRow(matches[0]) : null;
}

async function resolveSurfaceCatalogRow(surfaceId, deps = {}) {
  const mode = String(deps.dataSourceMode || DATA_SOURCE_MODE || "sql").trim().toLowerCase();
  if (mode !== "sheets") {
    try {
      const sqlRow = await getSqlSurfaceCatalogRow(surfaceId, deps);
      if (sqlRow || mode === "sql") return { row: sqlRow, source: "sql_registry_surface_catalog" };
    } catch (error) {
      if (mode === "sql") throw error;
      if (typeof deps.onSqlSurfaceCatalogFallback === "function") {
        deps.onSqlSurfaceCatalogFallback(error);
      }
    }
  }

  if (typeof deps.getRegistrySurfaceCatalogRowBySurfaceId !== "function") {
    return { row: null, source: mode === "sheets" ? "sheet_registry_surface_catalog_unavailable" : "registry_surface_catalog_unavailable" };
  }
  const row = await deps.getRegistrySurfaceCatalogRowBySurfaceId(surfaceId);
  return {
    row: row ? normalizeSurfaceCatalogRow(row) : null,
    source: "sheet_registry_surface_catalog",
  };
}

export async function getCanonicalSurfaceMetadata(surfaceId = "", fallback = {}, deps = {}) {
  const resolved = await resolveSurfaceCatalogRow(surfaceId, deps);
  const row = resolved.row;

  if (!row) {
    return {
      source: "fallback_constant",
      authority_source: resolved.source,
      surface_id: surfaceId,
      schema_ref: fallback.schema_ref || "",
      schema_version: fallback.schema_version || "",
      header_signature: buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
      expected_column_count: Array.isArray(fallback.columns) ? fallback.columns.length : 0,
      binding_mode: fallback.binding_mode || "constant_fallback",
      sheet_role: fallback.sheet_role || "",
      audit_mode: fallback.audit_mode || ""
    };
  }

  return {
    source: "registry_surface_catalog",
    authority_source: resolved.source,
    surface_id: row.surface_id,
    schema_ref: row.schema_ref,
    schema_version: row.schema_version,
    header_signature:
      row.header_signature || buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
    expected_column_count: normalizeExpectedColumnCount(
      row.expected_column_count,
      fallback.columns || []
    ),
    binding_mode: row.binding_mode || fallback.binding_mode || "",
    sheet_role: row.sheet_role || fallback.sheet_role || "",
    audit_mode: row.audit_mode || fallback.audit_mode || "",
    authority_status: row.authority_status || "",
    active_status: row.active_status || "",
    required_for_execution: row.required_for_execution || "",
    legacy_surface_containment_required: row.legacy_surface_containment_required || ""
  };
}

export function assertHeaderMatchesSurfaceMetadata(args = {}, deps = {}) {
  const { assertCanonicalHeaderExact } = deps;
  const sheetName = String(args.sheetName || "sheet").trim();
  const actualHeader = (args.actualHeader || []).map(value => String(value || "").trim());
  const metadata = args.metadata || {};
  const fallbackColumns = args.fallbackColumns || [];

  const expectedColumnCount = normalizeExpectedColumnCount(
    metadata.expected_column_count,
    fallbackColumns
  );

  const expectedSignature =
    String(metadata.header_signature || "").trim() ||
    buildExpectedHeaderSignatureFromCanonical(fallbackColumns);

  const actualSignature = actualHeader.join("|");

  if (expectedColumnCount && actualHeader.length !== expectedColumnCount) {
    const err = new Error(
      `${sheetName} header column count mismatch from surface metadata. expected=${expectedColumnCount} actual=${actualHeader.length}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (expectedSignature && actualSignature !== expectedSignature) {
    const err = new Error(`${sheetName} header signature mismatch from surface metadata.`);
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (String(metadata.audit_mode || "").trim() === "exact_header_match") {
    assertCanonicalHeaderExact(actualHeader, fallbackColumns, sheetName);
  }

  return true;
}

export function computeHeaderSignature(header = []) {
  return crypto
    .createHash("sha256")
    .update(header.map(value => String(value || "").trim()).join("|"))
    .digest("hex");
}

export function assertExpectedColumnsPresent(header = [], required = [], sheetName = "sheet") {
  const missing = required.filter(col => !header.includes(col));
  if (missing.length) {
    const err = new Error(`${sheetName} missing required columns: ${missing.join(", ")}`);
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}

export const _testingSurfaceMetadata = Object.freeze({
  normalizeSurfaceCatalogRow,
  getSqlSurfaceCatalogRow,
  resolveSurfaceCatalogRow,
});
