import {
  redis,
  REDIS_ENABLED,
  REDIS_URL_CONFIGURED,
  QUEUE_WORKER_EXPLICITLY_ENABLED,
} from "./queue.js";
import {
  SQL_CACHE_RUNTIME_STATE_MAX_ENTRIES,
  SQL_CONNECTOR_CACHE_TTL_SECONDS,
  SQL_REGISTRY_CACHE_TTL_SECONDS,
  SQL_TOOL_CACHE_TTL_SECONDS,
} from "./config.js";
import {
  getSqlCachePolicyRuntimeStatus,
  normalizeSqlCachePart,
  prepareSqlCacheValue,
  resolveSqlCacheTablePolicy,
} from "./sqlCachePolicy.js";
import {
  ensureSqlCacheRuntimePolicyRefresh,
  getSqlCacheRuntimePolicySnapshot,
  refreshSqlCacheRuntimePolicy,
} from "./sqlCacheRuntimePolicy.js";

const KEY_PREFIX = "sql";
const inFlightLoads = new Map();
const oversizeCooldownUntil = new Map();

let circuitOpenUntil = 0;
let lastErrorCode = "";

const runtimeCounters = {
  hits: 0,
  misses: 0,
  stores: 0,
  oversize_skips: 0,
  unavailable_skips: 0,
  circuit_open_skips: 0,
  errors: 0,
  bypasses: 0,
  single_flight_joins: 0,
};

function nowMs() {
  return Date.now();
}

function currentRuntimePolicy() {
  ensureSqlCacheRuntimePolicyRefresh();
  return getSqlCacheRuntimePolicySnapshot();
}

function boundedTtl(ttlSeconds) {
  const ttl = Number(ttlSeconds);
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 0;
}

function boundedMapSet(map, key, value) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);

  while (map.size > SQL_CACHE_RUNTIME_STATE_MAX_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

function pruneExpiredCooldowns(currentTime = nowMs()) {
  for (const [key, expiresAt] of oversizeCooldownUntil.entries()) {
    if (expiresAt <= currentTime) oversizeCooldownUntil.delete(key);
  }
}

function isCircuitOpen(currentTime = nowMs()) {
  return circuitOpenUntil > currentTime;
}

function circuitRetryAfterMs(currentTime = nowMs()) {
  return Math.max(0, circuitOpenUntil - currentTime);
}

function errorCode(err, fallback = "sql_cache_transport_error") {
  return String(err?.code || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 80);
}

function openCircuit(err) {
  const durationMs = Math.max(
    0,
    Number(currentRuntimePolicy().circuit_breaker_seconds) * 1_000
  );
  lastErrorCode = errorCode(err);
  if (durationMs > 0) circuitOpenUntil = nowMs() + durationMs;
}

function cacheClientAvailable(client, availableOverride = false) {
  if (availableOverride) return Boolean(client);
  return Boolean(
    currentRuntimePolicy().enabled &&
      REDIS_ENABLED &&
      REDIS_URL_CONFIGURED &&
      client
  );
}

export function isSqlCacheAvailable() {
  return cacheClientAvailable(redis);
}

export function isSqlCacheTableAllowed(tableName = "") {
  return resolveSqlCacheTablePolicy(tableName, {
    requestedTtlSeconds: SQL_REGISTRY_CACHE_TTL_SECONDS,
  }).enabled;
}

export function sqlCacheKey(...parts) {
  const policyStatus = getSqlCachePolicyRuntimeStatus();
  return [
    KEY_PREFIX,
    normalizeSqlCachePart(policyStatus.key_version),
    ...parts.map(normalizeSqlCachePart).filter(Boolean),
  ].join(":");
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

export async function getSqlCacheWithOutcome(
  cacheKey,
  { client = redis, availableOverride = false } = {}
) {
  if (!cacheClientAvailable(client, availableOverride)) {
    runtimeCounters.unavailable_skips += 1;
    return { status: "unavailable", value: null };
  }

  const key = String(cacheKey || "").trim();
  if (!key) {
    runtimeCounters.errors += 1;
    return {
      status: "error",
      value: null,
      error_code: "sql_cache_key_invalid",
    };
  }

  if (isCircuitOpen()) {
    runtimeCounters.circuit_open_skips += 1;
    return {
      status: "circuit_open",
      value: null,
      retry_after_ms: circuitRetryAfterMs(),
    };
  }

  try {
    const raw = await client.get(key);
    if (!raw) {
      runtimeCounters.misses += 1;
      return { status: "miss", value: null };
    }

    const value = JSON.parse(raw);
    runtimeCounters.hits += 1;
    return { status: "hit", value };
  } catch (err) {
    runtimeCounters.errors += 1;
    openCircuit(err);
    console.warn("SQL_CACHE_GET_WARN:", errorCode(err));
    return {
      status: "error",
      value: null,
      error_code: errorCode(err),
    };
  }
}

export async function getSqlCache(cacheKey) {
  const outcome = await getSqlCacheWithOutcome(cacheKey);
  return outcome.status === "hit" ? outcome.value : null;
}

export async function setSqlCacheWithOutcome(
  cacheKey,
  value,
  ttlSeconds,
  {
    client = redis,
    availableOverride = false,
    maxValueBytes,
    oversizeCooldownSeconds,
  } = {}
) {
  const runtimePolicy = currentRuntimePolicy();
  const effectiveMaxValueBytes =
    maxValueBytes === undefined ? runtimePolicy.max_value_bytes : maxValueBytes;
  const effectiveOversizeCooldownSeconds =
    oversizeCooldownSeconds === undefined
      ? runtimePolicy.oversize_cooldown_seconds
      : oversizeCooldownSeconds;

  if (!cacheClientAvailable(client, availableOverride)) {
    runtimeCounters.unavailable_skips += 1;
    return { status: "unavailable" };
  }

  const key = String(cacheKey || "").trim();
  const ttl = boundedTtl(ttlSeconds);
  if (!key || !ttl) {
    runtimeCounters.errors += 1;
    return {
      status: "error",
      error_code: "sql_cache_write_arguments_invalid",
    };
  }

  const currentTime = nowMs();
  pruneExpiredCooldowns(currentTime);

  if (isCircuitOpen(currentTime)) {
    runtimeCounters.circuit_open_skips += 1;
    return {
      status: "circuit_open",
      retry_after_ms: circuitRetryAfterMs(currentTime),
    };
  }

  const cooldownExpiresAt = oversizeCooldownUntil.get(key) || 0;
  if (cooldownExpiresAt > currentTime) {
    runtimeCounters.oversize_skips += 1;
    return {
      status: "skipped_oversize",
      reason: "cooldown",
      bytes: null,
      max_bytes: Number(effectiveMaxValueBytes),
      retry_after_ms: cooldownExpiresAt - currentTime,
    };
  }

  const prepared = prepareSqlCacheValue(value, effectiveMaxValueBytes);
  if (prepared.status === "skipped_oversize") {
    const cooldownMs = Math.max(
      0,
      Number(effectiveOversizeCooldownSeconds) * 1_000
    );
    if (cooldownMs > 0) {
      boundedMapSet(oversizeCooldownUntil, key, currentTime + cooldownMs);
    }
    runtimeCounters.oversize_skips += 1;
    return prepared;
  }

  if (prepared.status === "error") {
    runtimeCounters.errors += 1;
    return prepared;
  }

  try {
    await client.set(key, prepared.serialized, "EX", ttl);
    runtimeCounters.stores += 1;
    return {
      status: "stored",
      bytes: prepared.bytes,
      max_bytes: prepared.max_bytes,
      ttl_seconds: ttl,
    };
  } catch (err) {
    runtimeCounters.errors += 1;
    openCircuit(err);
    console.warn("SQL_CACHE_SET_WARN:", errorCode(err));
    return {
      status: "error",
      error_code: errorCode(err),
    };
  }
}

export async function setSqlCache(cacheKey, value, ttlSeconds) {
  const outcome = await setSqlCacheWithOutcome(cacheKey, value, ttlSeconds);
  return outcome.status === "stored";
}

export async function invalidateSqlCache(cacheKey) {
  if (!isSqlCacheAvailable()) return false;
  const key = String(cacheKey || "").trim();
  if (!key) return false;

  if (isCircuitOpen()) {
    runtimeCounters.circuit_open_skips += 1;
    return false;
  }

  try {
    await redis.del(key);
    return true;
  } catch (err) {
    runtimeCounters.errors += 1;
    openCircuit(err);
    console.warn("SQL_CACHE_INVALIDATE_WARN:", errorCode(err));
    return false;
  }
}

export async function invalidateSqlCachePrefix(prefix) {
  if (!isSqlCacheAvailable()) return 0;
  const normalized = String(prefix || "").trim();
  if (!normalized) return 0;

  if (isCircuitOpen()) {
    runtimeCounters.circuit_open_skips += 1;
    return 0;
  }

  try {
    let cursor = "0";
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${normalized}*`,
        "COUNT",
        100
      );
      cursor = nextCursor;
      if (keys.length) deleted += await redis.del(...keys);
    } while (cursor !== "0");
    return deleted;
  } catch (err) {
    runtimeCounters.errors += 1;
    openCircuit(err);
    console.warn("SQL_CACHE_PREFIX_INVALIDATE_WARN:", errorCode(err));
    return 0;
  }
}

async function loadAndCache(
  cacheKey,
  ttl,
  loaderFn,
  { maxValueBytes, oversizeCooldownSeconds } = {}
) {
  const value = await loaderFn();
  await setSqlCacheWithOutcome(cacheKey, value, ttl, {
    maxValueBytes,
    oversizeCooldownSeconds,
  });
  return value;
}

export async function cachedSqlRead(
  cacheKey,
  ttlSeconds,
  loaderFn,
  { maxValueBytes, oversizeCooldownSeconds } = {}
) {
  const ttl = boundedTtl(ttlSeconds);
  if (!isSqlCacheAvailable() || !ttl) {
    runtimeCounters.bypasses += 1;
    return loaderFn();
  }

  const cached = await getSqlCacheWithOutcome(cacheKey);
  if (cached.status === "hit") return cached.value;

  if (!currentRuntimePolicy().single_flight_enabled) {
    return loadAndCache(cacheKey, ttl, loaderFn, {
      maxValueBytes,
      oversizeCooldownSeconds,
    });
  }

  const normalizedKey = String(cacheKey || "").trim();
  if (inFlightLoads.has(normalizedKey)) {
    runtimeCounters.single_flight_joins += 1;
    return inFlightLoads.get(normalizedKey);
  }

  const promise = loadAndCache(normalizedKey, ttl, loaderFn, {
    maxValueBytes,
    oversizeCooldownSeconds,
  });

  boundedMapSet(inFlightLoads, normalizedKey, promise);

  try {
    return await promise;
  } finally {
    inFlightLoads.delete(normalizedKey);
  }
}

export async function cachedSqlTableRead(
  tableName,
  mode,
  loaderFn,
  { ttlSeconds = SQL_REGISTRY_CACHE_TTL_SECONDS } = {}
) {
  await refreshSqlCacheRuntimePolicy();
  const policy = resolveSqlCacheTablePolicy(tableName, {
    requestedTtlSeconds: ttlSeconds,
  });

  if (!policy.enabled || !policy.ttl_seconds) {
    runtimeCounters.bypasses += 1;
    return loaderFn();
  }

  return cachedSqlRead(
    sqlCacheKey("table", policy.table, mode || "rows"),
    policy.ttl_seconds,
    loaderFn,
    {
      maxValueBytes: policy.max_value_bytes,
      oversizeCooldownSeconds: policy.oversize_cooldown_seconds,
    }
  );
}

export async function invalidateSqlTableCache(tableName) {
  const normalizedTable = normalizeSqlCachePart(tableName);
  if (!normalizedTable) return 0;

  const currentPrefix = sqlCacheKey("table", normalizedTable);
  const legacyPrefix = [KEY_PREFIX, "table", normalizedTable].join(":");
  const [currentDeleted, legacyDeleted] = await Promise.all([
    invalidateSqlCachePrefix(currentPrefix),
    invalidateSqlCachePrefix(legacyPrefix),
  ]);
  return currentDeleted + legacyDeleted;
}

export function getSqlCacheRuntimeStatus() {
  pruneExpiredCooldowns();
  const runtimePolicy = currentRuntimePolicy();
  return {
    enabled: Boolean(runtimePolicy.enabled),
    available: isSqlCacheAvailable(),
    redis_enabled: Boolean(REDIS_ENABLED),
    redis_url_configured: Boolean(REDIS_URL_CONFIGURED),
    queue_worker_enabled: Boolean(QUEUE_WORKER_EXPLICITLY_ENABLED),
    registry_ttl_seconds: registryCacheTtl(),
    tool_ttl_seconds: toolCacheTtl(),
    connector_ttl_seconds: connectorCacheTtl(),
    single_flight_enabled: Boolean(runtimePolicy.single_flight_enabled),
    circuit_open: isCircuitOpen(),
    circuit_retry_after_ms: circuitRetryAfterMs(),
    last_error_code: lastErrorCode,
    in_flight_count: inFlightLoads.size,
    oversize_cooldown_count: oversizeCooldownUntil.size,
    counters: { ...runtimeCounters },
    policy: getSqlCachePolicyRuntimeStatus(),
  };
}

export function resetSqlCacheRuntimeStateForTests() {
  inFlightLoads.clear();
  oversizeCooldownUntil.clear();
  circuitOpenUntil = 0;
  lastErrorCode = "";
  for (const key of Object.keys(runtimeCounters)) runtimeCounters[key] = 0;
}
