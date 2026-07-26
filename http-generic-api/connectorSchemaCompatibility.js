import { getPool } from "./db.js";

const columnExistsCache = new Map();

function cacheKey(tableName, columnName) {
  return `${String(tableName || "").trim().toLowerCase()}.${String(columnName || "").trim().toLowerCase()}`;
}

export function resetConnectorSchemaCompatibilityCache() {
  columnExistsCache.clear();
}

export async function tableColumnExists(tableName, columnName, pool = getPool()) {
  const table = String(tableName || "").trim();
  const column = String(columnName || "").trim();
  if (!table || !column) return false;

  const key = cacheKey(table, column);
  if (columnExistsCache.has(key)) return columnExistsCache.get(key);

  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS column_count
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?`,
      [table, column]
    );
    const exists = Number(rows?.[0]?.column_count || 0) > 0;
    columnExistsCache.set(key, exists);
    return exists;
  } catch {
    // Schema compatibility checks must not make connector routes fail closed when
    // the data source itself is reachable but metadata inspection is restricted.
    // Callers should continue with the oldest compatible query shape.
    columnExistsCache.set(key, false);
    return false;
  }
}

export async function hasConnectorLocalApiKeyColumn(pool = getPool()) {
  return tableColumnExists("local_connector_user_configs", "connector_local_api_key", pool);
}

export async function connectorLocalApiKeySelectFragment(pool = getPool()) {
  return (await hasConnectorLocalApiKeyColumn(pool))
    ? "connector_local_api_key"
    : "NULL AS connector_local_api_key";
}

export async function connectorAuthPredicateForToken(token, pool = getPool()) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) {
    return {
      sql: "1 = 0",
      params: [],
      connector_local_api_key_supported: await hasConnectorLocalApiKeyColumn(pool),
    };
  }

  if (await hasConnectorLocalApiKeyColumn(pool)) {
    return {
      sql: "(connector_secret = ? OR connector_local_api_key = ?)",
      params: [cleanToken, cleanToken],
      connector_local_api_key_supported: true,
    };
  }

  return {
    sql: "connector_secret = ?",
    params: [cleanToken],
    connector_local_api_key_supported: false,
  };
}
