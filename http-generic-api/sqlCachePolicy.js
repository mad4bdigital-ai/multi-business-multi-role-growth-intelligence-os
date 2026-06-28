import {
  SQL_CACHE_KEY_VERSION,
  SQL_CACHE_MAX_VALUE_BYTES,
  SQL_CACHE_OVERSIZE_COOLDOWN_SECONDS,
  SQL_CACHE_TABLE_ALLOWLIST,
  SQL_CACHE_TABLE_BLOCKLIST,
  SQL_CACHE_TABLE_POLICIES_JSON,
} from "./config.js";

const MIN_CACHE_VALUE_BYTES = 1_024;

const DEFAULT_CACHEABLE_TABLES = new Set([
  "brand_core",
  "execution_policies",
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
  "local_gateway_tools",
]);

// These tables can contain credentials, credential references, scoped connection
// details, or other values that must not enter a generic whole-table cache.
// Environment configuration cannot override this denylist.
const SECURITY_DENIED_TABLES = new Set([
  "actions",
  "brands",
  "hosting_accounts",
  "connected_systems",
  "local_connector_user_configs",
]);

export function normalizeSqlCachePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseSqlCacheCsvSet(value = "") {
  return new Set(
    String(value || "")
      .split(",")
      .map(normalizeSqlCachePart)
      .filter(Boolean)
  );
}

function boundedInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizePolicyRow(value = {}) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {};

  if (typeof row.enabled === "boolean") normalized.enabled = row.enabled;
  if (row.ttl_seconds !== undefined) {
    normalized.ttl_seconds = boundedInteger(row.ttl_seconds, null, { min: 0, max: 86_400 });
  }
  if (row.max_value_bytes !== undefined) {
    normalized.max_value_bytes = boundedInteger(row.max_value_bytes, null, {
      min: MIN_CACHE_VALUE_BYTES,
      max: SQL_CACHE_MAX_VALUE_BYTES,
    });
  }
  if (row.oversize_cooldown_seconds !== undefined) {
    normalized.oversize_cooldown_seconds = boundedInteger(
      row.oversize_cooldown_seconds,
      null,
      { min: 0, max: 86_400 }
    );
  }

  return Object.fromEntries(
    Object.entries(normalized).filter(([, item]) => item !== null)
  );
}

export function parseSqlCacheTablePolicies(raw = SQL_CACHE_TABLE_POLICIES_JSON) {
  const source = String(raw || "{}").trim() || "{}";
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        policies: {},
        valid: false,
        error_code: "sql_cache_policy_root_invalid",
      };
    }

    const policies = {};
    for (const [tableName, value] of Object.entries(parsed)) {
      const normalizedTable = normalizeSqlCachePart(tableName);
      if (!normalizedTable) continue;
      policies[normalizedTable] = normalizePolicyRow(value);
    }

    return { policies, valid: true, error_code: "" };
  } catch {
    return {
      policies: {},
      valid: false,
      error_code: "sql_cache_policy_json_invalid",
    };
  }
}

export function resolveSqlCacheTablePolicy(
  tableName,
  {
    requestedTtlSeconds = 0,
    allowlistSource = SQL_CACHE_TABLE_ALLOWLIST,
    blocklistSource = SQL_CACHE_TABLE_BLOCKLIST,
    policySource = SQL_CACHE_TABLE_POLICIES_JSON,
    globalMaxValueBytes = SQL_CACHE_MAX_VALUE_BYTES,
    globalOversizeCooldownSeconds = SQL_CACHE_OVERSIZE_COOLDOWN_SECONDS,
    keyVersion = SQL_CACHE_KEY_VERSION,
    globalEnabled = true,
  } = {}
) {
  const table = normalizeSqlCachePart(tableName);
  const allowlist = parseSqlCacheCsvSet(allowlistSource);
  const blocklist = parseSqlCacheCsvSet(blocklistSource);
  const parsedPolicies = parseSqlCacheTablePolicies(policySource);
  const override = parsedPolicies.policies[table] || {};

  let enabled = Boolean(globalEnabled && DEFAULT_CACHEABLE_TABLES.has(table));
  let reason = !globalEnabled
    ? "runtime_policy_disabled"
    : enabled
      ? "default_allowlist"
      : "not_default_cacheable";

  if (allowlist.size > 0) {
    enabled = allowlist.has(table);
    reason = enabled ? "configured_allowlist" : "not_in_configured_allowlist";
  }

  if (typeof override.enabled === "boolean") {
    enabled = override.enabled;
    reason = enabled ? "table_policy_enabled" : "table_policy_disabled";
  }

  if (blocklist.has(table)) {
    enabled = false;
    reason = "configured_blocklist";
  }

  if (!globalEnabled) {
    enabled = false;
    reason = "runtime_policy_disabled";
  }

  if (SECURITY_DENIED_TABLES.has(table)) {
    enabled = false;
    reason = "security_denylist";
  }

  return {
    table,
    enabled: Boolean(table && enabled),
    reason,
    ttl_seconds:
      override.ttl_seconds ??
      boundedInteger(requestedTtlSeconds, 0, { min: 0, max: 86_400 }),
    max_value_bytes:
      override.max_value_bytes ??
      boundedInteger(globalMaxValueBytes, SQL_CACHE_MAX_VALUE_BYTES, {
        min: MIN_CACHE_VALUE_BYTES,
        max: SQL_CACHE_MAX_VALUE_BYTES,
      }),
    oversize_cooldown_seconds:
      override.oversize_cooldown_seconds ??
      boundedInteger(globalOversizeCooldownSeconds, SQL_CACHE_OVERSIZE_COOLDOWN_SECONDS, {
        min: 0,
        max: 86_400,
      }),
    key_version: normalizeSqlCachePart(keyVersion) || SQL_CACHE_KEY_VERSION,
    policy_source_valid: parsedPolicies.valid,
    policy_error_code: parsedPolicies.error_code,
    security_denied: SECURITY_DENIED_TABLES.has(table),
  };
}

export function prepareSqlCacheValue(value, maxValueBytes = SQL_CACHE_MAX_VALUE_BYTES) {
  const limit = boundedInteger(maxValueBytes, SQL_CACHE_MAX_VALUE_BYTES, {
    min: MIN_CACHE_VALUE_BYTES,
    max: SQL_CACHE_MAX_VALUE_BYTES,
  });

  try {
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > limit) {
      return {
        status: "skipped_oversize",
        serialized: null,
        bytes,
        max_bytes: limit,
      };
    }

    return {
      status: "ready",
      serialized,
      bytes,
      max_bytes: limit,
    };
  } catch {
    return {
      status: "error",
      serialized: null,
      bytes: null,
      max_bytes: limit,
      error_code: "sql_cache_serialization_failed",
    };
  }
}

export function getSqlCachePolicyRuntimeStatus() {
  const parsed = parseSqlCacheTablePolicies();
  return {
    key_version: SQL_CACHE_KEY_VERSION,
    max_value_bytes: SQL_CACHE_MAX_VALUE_BYTES,
    oversize_cooldown_seconds: SQL_CACHE_OVERSIZE_COOLDOWN_SECONDS,
    configured_allowlist_count: parseSqlCacheCsvSet(SQL_CACHE_TABLE_ALLOWLIST).size,
    configured_blocklist_count: parseSqlCacheCsvSet(SQL_CACHE_TABLE_BLOCKLIST).size,
    table_policy_count: Object.keys(parsed.policies).length,
    table_policy_source_valid: parsed.valid,
    table_policy_error_code: parsed.error_code,
    security_denylist_count: SECURITY_DENIED_TABLES.size,
  };
}
