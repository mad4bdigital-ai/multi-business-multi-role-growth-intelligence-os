import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_COLUMN_RE = /(password|secret|token|credential|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key)/i;
const DEFAULT_MAX_LIMIT = 100;
const MAX_LIMIT_CAP = 500;

export class DataManagementError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "DataManagementError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function asArray(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
}

function asObject(value) {
  const parsed = parseJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function quoteIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (!IDENTIFIER_RE.test(value)) throw new DataManagementError("invalid_registry_identifier", "Registry contains an unsafe SQL identifier.", 500, { identifier: value });
  return `\`${value}\``;
}

function normalizeLimit(value, maxLimit = DEFAULT_MAX_LIMIT) {
  const limit = Math.min(Number(value) || DEFAULT_MAX_LIMIT, Math.min(maxLimit || DEFAULT_MAX_LIMIT, MAX_LIMIT_CAP));
  return Math.max(1, limit);
}

function normalizeCursor(value) {
  return Math.max(0, Number(value) || 0);
}

export function containsSecretLikeColumn(columnName) {
  return SECRET_COLUMN_RE.test(String(columnName || ""));
}

export function normalizeTableRegistration(row = {}) {
  const primaryKeyColumns = asArray(row.primary_key_columns_json);
  const readableColumns = asArray(row.readable_columns_json);
  const writableColumns = asArray(row.writable_columns_json);
  const creatableColumns = asArray(row.creatable_columns_json);
  const patchableColumns = asArray(row.patchable_columns_json);
  const filterableColumns = asArray(row.filterable_columns_json);
  const requiredCreateColumns = asArray(row.required_create_columns_json);
  const jsonColumns = new Set(asArray(row.json_columns_json));
  const allowedOperations = asArray(row.allowed_operations_json);
  const enabledSurfaces = asArray(row.enabled_surfaces_json);
  const defaultValues = asObject(row.default_values_json);
  return { ...row, primaryKeyColumns, readableColumns, writableColumns, creatableColumns, patchableColumns, filterableColumns, requiredCreateColumns, jsonColumns, allowedOperations, enabledSurfaces, defaultValues, maxLimit: Number(row.max_limit || DEFAULT_MAX_LIMIT) };
}

export function validateRegisteredColumns(registry) {
  const groups = [registry.primaryKeyColumns, registry.readableColumns, registry.writableColumns, registry.creatableColumns, registry.patchableColumns, registry.filterableColumns, registry.requiredCreateColumns, [registry.tenant_column, registry.workspace_column, registry.soft_delete_column].filter(Boolean)];
  for (const column of groups.flat()) {
    quoteIdentifier(column);
    if (containsSecretLikeColumn(column)) throw new DataManagementError("secret_like_column_not_allowed", "Registry-managed data tables must not expose secret-like columns.", 500, { table_key: registry.table_key, column });
  }
}

function assertSurfaceAllowed(registry, surface) {
  if (!registry.enabledSurfaces.includes(surface)) throw new DataManagementError("data_table_surface_not_allowed", "This data table is not exposed on the requested surface.", 403, { table_key: registry.table_key, surface });
}

function assertOperationAllowed(registry, operation) {
  if (!registry.allowedOperations.includes(operation)) throw new DataManagementError("data_table_operation_not_allowed", "This operation is not enabled for the requested data table.", 403, { table_key: registry.table_key, operation });
}

export async function loadTableRegistration({ tableKey, surface, pool = getPool() } = {}) {
  const cleanTableKey = String(tableKey || "").trim();
  if (!/^[a-z0-9_.:-]{2,191}$/i.test(cleanTableKey)) throw new DataManagementError("invalid_table_key", "A valid table_key is required.", 400);
  const [rows] = await pool.query("SELECT * FROM platform_data_table_registry WHERE table_key = ? AND status = 'active' LIMIT 1", [cleanTableKey]);
  const registry = rows[0] ? normalizeTableRegistration(rows[0]) : null;
  if (!registry) throw new DataManagementError("data_table_not_registered", "The requested data table is not registered.", 404, { table_key: cleanTableKey });
  assertSurfaceAllowed(registry, surface);
  validateRegisteredColumns(registry);
  return registry;
}

export async function listTableRegistrations({ surface, pool = getPool() } = {}) {
  const [rows] = await pool.query("SELECT table_key, display_name, description, scope_mode, allowed_operations_json, enabled_surfaces_json, status, updated_at FROM platform_data_table_registry WHERE status = 'active' ORDER BY sort_order ASC, table_key ASC");
  return rows.map(normalizeTableRegistration).filter((row) => row.enabledSurfaces.includes(surface)).map((row) => ({ table_key: row.table_key, display_name: row.display_name, description: row.description, scope_mode: row.scope_mode, allowed_operations: row.allowedOperations, secrets_included: false }));
}

function pushRequiredParam(params, value, code) {
  if (!value) throw new DataManagementError(code, "A required row identifier is missing.", 400);
  params.push(value);
}

function buildScopeWhere(registry, context, params) {
  const clauses = [];
  const tenantColumn = String(registry.tenant_column || "").trim();
  if (context.surface === "tenant") {
    if (!tenantColumn) throw new DataManagementError("tenant_scope_column_required", "Tenant data tables must declare a tenant scope column.", 500, { table_key: registry.table_key });
    clauses.push(`${quoteIdentifier(tenantColumn)} = ?`);
    params.push(context.tenantId);
  } else if (context.tenantId && tenantColumn) {
    clauses.push(`${quoteIdentifier(tenantColumn)} = ?`);
    params.push(context.tenantId);
  }
  return clauses;
}

function buildPrimaryKeyWhere(registry, rowId, params) {
  if (registry.primaryKeyColumns.length !== 1) throw new DataManagementError("single_primary_key_required", "Generic row operations require exactly one registered primary key column.", 500, { table_key: registry.table_key });
  const pk = registry.primaryKeyColumns[0];
  pushRequiredParam(params, String(rowId || "").trim(), "row_id_required");
  return `${quoteIdentifier(pk)} = ?`;
}

function normalizeRowPayload(input, registry, mode, context) {
  const row = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  const allowed = new Set(mode === "create" ? registry.creatableColumns : registry.patchableColumns);
  const required = mode === "create" ? registry.requiredCreateColumns : [];
  for (const [column, defaultValue] of Object.entries(registry.defaultValues)) {
    if (row[column] != null && row[column] !== "") continue;
    if (defaultValue === "$uuid") row[column] = randomUUID();
    if (defaultValue === "$tenant_id") row[column] = context.tenantId;
    if (defaultValue === "$user_id") row[column] = context.userId;
    if (defaultValue === "$now") row[column] = new Date().toISOString();
  }
  if (context.surface === "tenant" && registry.tenant_column) row[registry.tenant_column] = context.tenantId;
  const columns = Object.keys(row);
  if (!columns.length) throw new DataManagementError("empty_row_payload", "At least one registered column is required.", 400);
  for (const column of columns) {
    if (!allowed.has(column)) throw new DataManagementError("unregistered_or_readonly_column", "The payload contains a column that is not writable for this operation.", 400, { table_key: registry.table_key, column });
    if (containsSecretLikeColumn(column)) throw new DataManagementError("secret_like_column_not_allowed", "Secret-like columns are not accepted by generic data management routes.", 400, { column });
  }
  for (const column of required) {
    if (row[column] == null || row[column] === "") throw new DataManagementError("required_column_missing", "A required create column is missing.", 400, { table_key: registry.table_key, column });
  }
  return row;
}

function serializeValue(registry, column, value) {
  if (registry.jsonColumns.has(column)) {
    if (value == null || value === "") return null;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  return value;
}

async function readOneRow({ registry, rowId, context, pool = getPool() }) {
  assertOperationAllowed(registry, "read");
  const params = [];
  const columns = registry.readableColumns.map(quoteIdentifier).join(", ");
  const where = [buildPrimaryKeyWhere(registry, rowId, params), ...buildScopeWhere(registry, context, params)].join(" AND ");
  const [rows] = await pool.query(`SELECT ${columns} FROM ${quoteIdentifier(registry.physical_table_name)} WHERE ${where} LIMIT 1`, params);
  return rows[0] || null;
}

export async function listRows({ tableKey, surface, tenantId, userId, query = {}, pool = getPool() } = {}) {
  const registry = await loadTableRegistration({ tableKey, surface, pool });
  assertOperationAllowed(registry, "list");
  const context = { surface, tenantId, userId };
  const params = [];
  const where = buildScopeWhere(registry, context, params);
  for (const column of registry.filterableColumns) {
    const value = query[column];
    if (value == null || value === "") continue;
    where.push(`${quoteIdentifier(column)} = ?`);
    params.push(String(value));
  }
  const limit = normalizeLimit(query.limit, registry.maxLimit);
  const cursor = normalizeCursor(query.cursor);
  const columns = registry.readableColumns.map(quoteIdentifier).join(", ");
  const sql = `SELECT ${columns} FROM ${quoteIdentifier(registry.physical_table_name)} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${quoteIdentifier(registry.primaryKeyColumns[0])} ASC LIMIT ? OFFSET ?`;
  const [rows] = await pool.query(sql, [...params, limit, cursor]);
  return { ok: true, table_key: registry.table_key, rows, count: rows.length, page: { cursor, nextCursor: rows.length === limit ? String(cursor + limit) : null, hasMore: rows.length === limit }, secrets_included: false };
}

export async function getRow({ tableKey, rowId, surface, tenantId, userId, pool = getPool() } = {}) {
  const registry = await loadTableRegistration({ tableKey, surface, pool });
  const row = await readOneRow({ registry, rowId, context: { surface, tenantId, userId }, pool });
  if (!row) throw new DataManagementError("data_table_row_not_found", "The requested row was not found in scope.", 404, { table_key: registry.table_key });
  return { ok: true, table_key: registry.table_key, row, secrets_included: false };
}

export async function createRow({ tableKey, surface, tenantId, userId, row, pool = getPool() } = {}) {
  const registry = await loadTableRegistration({ tableKey, surface, pool });
  assertOperationAllowed(registry, "create");
  const context = { surface, tenantId, userId };
  const payload = normalizeRowPayload(row, registry, "create", context);
  const columns = Object.keys(payload);
  const values = columns.map((column) => serializeValue(registry, column, payload[column]));
  const placeholders = columns.map(() => "?").join(", ");
  await pool.query(`INSERT INTO ${quoteIdentifier(registry.physical_table_name)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})`, values);
  const rowId = payload[registry.primaryKeyColumns[0]];
  return { ok: true, table_key: registry.table_key, created: true, readback: await readOneRow({ registry, rowId, context, pool }), secrets_included: false };
}

export async function patchRow({ tableKey, rowId, surface, tenantId, userId, row, pool = getPool() } = {}) {
  const registry = await loadTableRegistration({ tableKey, surface, pool });
  assertOperationAllowed(registry, "patch");
  const context = { surface, tenantId, userId };
  const payload = normalizeRowPayload(row, registry, "patch", context);
  const columns = Object.keys(payload).filter((column) => column !== registry.tenant_column);
  if (!columns.length) throw new DataManagementError("empty_patch_payload", "At least one patchable column is required.", 400);
  const params = columns.map((column) => serializeValue(registry, column, payload[column]));
  const whereParams = [];
  const where = [buildPrimaryKeyWhere(registry, rowId, whereParams), ...buildScopeWhere(registry, context, whereParams)].join(" AND ");
  const [result] = await pool.query(`UPDATE ${quoteIdentifier(registry.physical_table_name)} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(", ")} WHERE ${where}`, [...params, ...whereParams]);
  if (!result.affectedRows) throw new DataManagementError("data_table_row_not_found", "The requested row was not found in scope.", 404, { table_key: registry.table_key });
  return { ok: true, table_key: registry.table_key, patched: true, readback: await readOneRow({ registry, rowId, context, pool }), secrets_included: false };
}

export async function archiveRow({ tableKey, rowId, surface, tenantId, userId, pool = getPool() } = {}) {
  const registry = await loadTableRegistration({ tableKey, surface, pool });
  assertOperationAllowed(registry, "archive");
  if (!registry.soft_delete_column) throw new DataManagementError("archive_not_supported", "This data table does not define a soft delete column.", 405, { table_key: registry.table_key });
  const context = { surface, tenantId, userId };
  const params = [registry.soft_delete_value || "archived"];
  const whereParams = [];
  const where = [buildPrimaryKeyWhere(registry, rowId, whereParams), ...buildScopeWhere(registry, context, whereParams)].join(" AND ");
  const [result] = await pool.query(`UPDATE ${quoteIdentifier(registry.physical_table_name)} SET ${quoteIdentifier(registry.soft_delete_column)} = ? WHERE ${where}`, [...params, ...whereParams]);
  if (!result.affectedRows) throw new DataManagementError("data_table_row_not_found", "The requested row was not found in scope.", 404, { table_key: registry.table_key });
  return { ok: true, table_key: registry.table_key, archived: true, readback: await readOneRow({ registry, rowId, context, pool }), secrets_included: false };
}

export const _testingRegistryDataManagementService = { asArray, asObject, containsSecretLikeColumn, normalizeTableRegistration, normalizeLimit };
