import { redis, REDIS_ENABLED, QUEUE_WORKER_EXPLICITLY_ENABLED } from "./queue.js";
import {
  SQL_CACHE_ENABLED,
  SQL_REGISTRY_CACHE_TTL_SECONDS,
  SQL_TOOL_CACHE_TTL_SECONDS,
  SQL_CONNECTOR_CACHE_TTL_SECONDS,
} from "./config.js";

const KEY_PREFIX = "sql";
const DEFAULT_CACHEABLE_TABLES = new Set([
  "actions",
  "endpoints",
  "execution_policies",
  "brands",
  "hosting_accounts",
  "site_runtime_inventory",
  "site_settings_inventory",
  "plugins",
  "business_activity_types",
  "business_type_profiles",
  "brand_paths",
  "task_routes",
  "workflows",
  "registry_surfaces_catalog",
  "validation_repair",
  "admin_platform_endpoint_tools",
  "tenant_platform_endpoint_tools",
  "connected_systems",
  "local_connector_user_configs",
  "local_gateway_tools",
]);

function envList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function cacheableTableSet() {
  const configured = envList("SQL_CACHE_TABLE_ALLOWLIST");
  if (!configured.length) return DEFAULT_CACHEABLE_TABLES;
  return new Set(configured.map(normalizePart));
}

export function isSqlCacheAvailable() {
  return Boolean(SQL_CACHE_ENABLED && REDIS_ENABLED && redis);
}

export function isSqlCacheTableAllowed(tableName = "") {
  return cacheableTableSet().has(normalizePart(tableName));
}

export function sqlCacheKey(...parts) {
  return [KEY_PREFIX, ...parts.map(normalizePart).filter(Boolean)].join(":");
}

function boundedTtl(ttlSeconds) {
  const ttl = Number(ttlSeconds);
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 0;
}

export function registryCacheTtl() {
  return boundedTtl(SQL_REGISTRY_CACHE_TTL_SECONDS);
}

export function toolCacheTtl() {
  return boundedTtl(SQL_TOOL_CACHE_TTL_SECONDS);
}

export function connectorCacheTtl() {
  return boundedTtl(SQL_CONNECTOR_CACHE_TTL_SECONDS);
}

export async function getSqlCache(cacheKey) {
  if (!isSqlCacheAvailable()) return null;
  const key = String(cacheKey || "").trim();
  if (!key) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`SQL_CACHE_GET_WARN [${key}]:`, err?.message || err);
    return null;
  }
}

export async function setSqlCache(cacheKey, value, ttlSeconds) {
  if (!isSqlCacheAvailable()) return false;
  const key = String(cacheKey || "").trim();
  const ttl = boundedTtl(ttlSeconds);
  if (!key || !ttl) return false;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttl);
    return true;
  } catch (err) {
    console.warn(`SQL_CACHE_SET_WARN [${key}]:`, err?.message || err);
    return false;
  }
}

export async function invalidateSqlCache(cacheKey) {
  if (!isSqlCacheAvailable()) return false;
  const key = String(cacheKey || "").trim();
  if (!key) return false;
  try {
    await redis.del(key);
    return true;
  } catch (err) {
    console.warn(`SQL_CACHE_INVALIDATE_WARN [${key}]:`, err?.message || err);
    return false;
  }
}

export async function invalidateSqlCachePrefix(prefix) {
  if (!isSqlCacheAvailable()) return 0;
  const normalized = String(prefix || "").trim();
  if (!normalized) return 0;
  try {
    let cursor = "0";
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${normalized}*`, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length) deleted += await redis.del(...keys);
    } while (cursor !== "0");
    return deleted;
  } catch (err) {
    console.warn(`SQL_CACHE_PREFIX_INVALIDATE_WARN [${normalized}]:`, err?.message || err);
    return 0;
  }
}

export async function cachedSqlRead(cacheKey, ttlSeconds, loaderFn) {
  const ttl = boundedTtl(ttlSeconds);
  if (!isSqlCacheAvailable() || !ttl) return loaderFn();
  const cached = await getSqlCache(cacheKey);
  if (cached !== null) return cached;
  const value = await loaderFn();
  await setSqlCache(cacheKey, value, ttl);
  return value;
}

export async function cachedSqlTableRead(tableName, mode, loaderFn, { ttlSeconds = SQL_REGISTRY_CACHE_TTL_SECONDS } = {}) {
  const normalizedTable = normalizePart(tableName);
  if (!isSqlCacheTableAllowed(normalizedTable)) return loaderFn();
  return cachedSqlRead(sqlCacheKey("table", normalizedTable, mode || "rows", "v1"), ttlSeconds, loaderFn);
}

export async function invalidateSqlTableCache(tableName) {
  const normalizedTable = normalizePart(tableName);
  if (!normalizedTable) return 0;
  return invalidateSqlCachePrefix(sqlCacheKey("table", normalizedTable));
}

export function getSqlCacheRuntimeStatus() {
  return {
    enabled: Boolean(SQL_CACHE_ENABLED),
    available: isSqlCacheAvailable(),
    redis_enabled: Boolean(REDIS_ENABLED),
    queue_worker_enabled: Boolean(QUEUE_WORKER_EXPLICITLY_ENABLED),
    registry_ttl_seconds: registryCacheTtl(),
    tool_ttl_seconds: toolCacheTtl(),
    connector_ttl_seconds: connectorCacheTtl(),
    table_allowlist_count: cacheableTableSet().size,
  };
}
