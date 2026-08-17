import { getPool } from "./db.js";

export const MCP_CATALOG_LEVEL_MIGRATION = "20260815_custom_gpt_mcp_catalog_levels.sql";
export const MCP_CATALOG_TABLES = Object.freeze([
  "admin_platform_endpoint_tools",
  "tenant_platform_endpoint_tools",
]);
export const MCP_CATALOG_LEVEL_COLUMN = "mcp_catalog_level";

const schemaCache = new WeakMap();
const CACHE_TTL_MS = 30_000;

function schemaError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = {
    ...details,
    migration: MCP_CATALOG_LEVEL_MIGRATION,
    table: details.table || null,
    column: MCP_CATALOG_LEVEL_COLUMN,
    migration_apply_required: true,
    secrets_included: false,
  };
  return error;
}

function cacheFor(pool) {
  let cache = schemaCache.get(pool);
  if (!cache) {
    cache = new Map();
    schemaCache.set(pool, cache);
  }
  return cache;
}

export function buildMcpCatalogSchemaMigrationRequiredError({ table = null, originalErrorCode = null } = {}) {
  return schemaError("mcp_catalog_schema_migration_required", "MCP catalog schema is missing mcp_catalog_level; apply the governed migration before serving the catalog.", {
    table,
    original_error_code: originalErrorCode,
  });
}

export async function readMcpCatalogLevelSchemaStatus({ pool = getPool(), table } = {}) {
  const normalizedTable = String(table || "").trim();
  if (!MCP_CATALOG_TABLES.includes(normalizedTable)) {
    throw schemaError("mcp_catalog_table_invalid", "The requested MCP catalog table is not governed.", { table: normalizedTable });
  }
  const cache = cacheFor(pool);
  const cached = cache.get(normalizedTable);
  if (cached && cached.expires_at > Date.now()) return cached.status;

  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS column_count
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?`,
      [normalizedTable, MCP_CATALOG_LEVEL_COLUMN],
    );
    const available = Number(rows?.[0]?.column_count || 0) > 0;
    const status = {
      ok: available,
      table: normalizedTable,
      column: MCP_CATALOG_LEVEL_COLUMN,
      available,
      migration: MCP_CATALOG_LEVEL_MIGRATION,
      migration_apply_required: !available,
      secrets_included: false,
    };
    cache.set(normalizedTable, { expires_at: Date.now() + CACHE_TTL_MS, status });
    return status;
  } catch (error) {
    throw schemaError("mcp_catalog_schema_metadata_unavailable", "MCP catalog schema metadata could not be read.", {
      table: normalizedTable,
      original_error_code: String(error?.code || error?.errno || "schema_metadata_unavailable").slice(0, 128),
    });
  }
}

export async function assertMcpCatalogLevelColumn({ pool = getPool(), table } = {}) {
  const status = await readMcpCatalogLevelSchemaStatus({ pool, table });
  if (!status.available) {
    throw buildMcpCatalogSchemaMigrationRequiredError({
      table: status.table,
      originalErrorCode: status.code || null,
    });
  }
  return status;
}

export async function readMcpCatalogSchemaReadiness({ pool = null } = {}) {
  if (!pool) {
    return {
      ok: false,
      migration: MCP_CATALOG_LEVEL_MIGRATION,
      tables: MCP_CATALOG_TABLES.map((table) => ({
        ok: false,
        table,
        column: MCP_CATALOG_LEVEL_COLUMN,
        available: false,
        code: "DB_CONFIG_MISSING",
        migration: MCP_CATALOG_LEVEL_MIGRATION,
        migration_apply_required: true,
        secrets_included: false,
      })),
      migration_apply_required: true,
      secrets_included: false,
    };
  }
  const tables = [];
  for (const table of MCP_CATALOG_TABLES) {
    try {
      tables.push(await readMcpCatalogLevelSchemaStatus({ pool, table }));
    } catch (error) {
      tables.push({
        ok: false,
        table,
        column: MCP_CATALOG_LEVEL_COLUMN,
        available: false,
        code: error.code || "mcp_catalog_schema_metadata_unavailable",
        migration: MCP_CATALOG_LEVEL_MIGRATION,
        migration_apply_required: true,
        secrets_included: false,
      });
    }
  }
  return {
    ok: tables.every((item) => item.available === true),
    migration: MCP_CATALOG_LEVEL_MIGRATION,
    tables,
    migration_apply_required: tables.some((item) => item.available !== true),
    secrets_included: false,
  };
}
