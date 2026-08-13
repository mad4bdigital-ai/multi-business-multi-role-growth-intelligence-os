import { getPool } from "./db.js";
import {
  SQL_CACHE_CIRCUIT_BREAKER_SECONDS,
  SQL_CACHE_ENABLED,
  SQL_CACHE_REQUIRED,
  SQL_CACHE_KEY_VERSION,
  SQL_CACHE_MAX_VALUE_BYTES,
  SQL_CACHE_OVERSIZE_COOLDOWN_SECONDS,
  SQL_CACHE_POLICY_REFRESH_SECONDS,
  SQL_CACHE_RUNTIME_POLICY_CONFIG_KEY,
  SQL_CACHE_SINGLE_FLIGHT_ENABLED,
  SQL_CACHE_TABLE_ALLOWLIST,
  SQL_CACHE_TABLE_BLOCKLIST,
  SQL_CACHE_TABLE_POLICIES_JSON,
} from "./config.js";

const TABLE = "sql_cache_runtime_policies";
const POLICY_KEY = SQL_CACHE_RUNTIME_POLICY_CONFIG_KEY || "sql_cache_policy_v2";
const ALLOWED_FIELDS = new Set([
  "enabled",
  "required",
  "key_version",
  "max_value_bytes",
  "oversize_cooldown_seconds",
  "circuit_breaker_seconds",
  "single_flight_enabled",
  "table_allowlist",
  "table_blocklist",
  "table_policies",
]);

const DEPLOYMENT_MAX_VALUE_BYTES = Number.isFinite(Number(SQL_CACHE_MAX_VALUE_BYTES))
  ? Math.max(1_024, Math.min(8_388_608, Math.floor(Number(SQL_CACHE_MAX_VALUE_BYTES))))
  : 1_048_576;

const state = {
  current: null,
  lastGood: null,
  inFlight: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastErrorCode: "",
};

function fail(code, message, status = 400, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "on"].includes(text)) return true;
  if (["false", "no", "off"].includes(text)) return false;
  return fallback;
}

function asInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeKey(value, fallback = "v2") {
  return (
    String(value || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || fallback
  );
}

function normalizeCsv(value = "") {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) =>
        item
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "_")
          .replace(/^_+|_+$/g, "")
      )
      .filter(Boolean)
  )].join(",");
}

function parseObject(value, code) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}
  throw fail(code, "SQL cache runtime policy JSON must be an object.");
}

function normalizeTablePolicies(value = {}) {
  const parsed = parseObject(value, "sql_cache_runtime_table_policies_invalid");
  const entries = Object.entries(parsed);
  if (entries.length > 200) {
    throw fail("sql_cache_runtime_table_policy_limit_exceeded", "At most 200 table policies are allowed.");
  }
  const output = {};
  for (const [rawTable, rawPolicy] of entries) {
    const table = normalizeCsv(rawTable);
    if (!table || table.includes(",")) {
      throw fail("sql_cache_runtime_table_name_invalid", "A table policy contains an invalid table name.");
    }
    if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
      throw fail("sql_cache_runtime_table_policy_invalid", `Policy for ${table} must be an object.`);
    }
    const unknown = Object.keys(rawPolicy).filter(
      (key) => !["enabled", "ttl_seconds", "max_value_bytes", "oversize_cooldown_seconds"].includes(key)
    );
    if (unknown.length) {
      throw fail(
        "sql_cache_runtime_table_policy_unknown_fields",
        `Policy for ${table} contains unsupported fields.`,
        400,
        unknown.map((field) => ({ field: `table_policies.${table}.${field}`, issue: "unsupported" }))
      );
    }
    const row = {};
    if (rawPolicy.enabled !== undefined) row.enabled = asBoolean(rawPolicy.enabled);
    if (rawPolicy.ttl_seconds !== undefined) {
      row.ttl_seconds = asInteger(rawPolicy.ttl_seconds, 0, 0, 86_400);
    }
    if (rawPolicy.max_value_bytes !== undefined) {
      row.max_value_bytes = asInteger(rawPolicy.max_value_bytes, 1_024, 1_024, DEPLOYMENT_MAX_VALUE_BYTES);
    }
    if (rawPolicy.oversize_cooldown_seconds !== undefined) {
      row.oversize_cooldown_seconds = asInteger(rawPolicy.oversize_cooldown_seconds, 0, 0, 86_400);
    }
    output[table] = row;
  }
  return output;
}

function envPolicy() {
  let tablePolicies = {};
  try {
    tablePolicies = normalizeTablePolicies(SQL_CACHE_TABLE_POLICIES_JSON || "{}");
  } catch {}
  return {
    policy_key: POLICY_KEY,
    revision: 0,
    enabled: Boolean(SQL_CACHE_ENABLED),
    required: Boolean(SQL_CACHE_REQUIRED),
    key_version: normalizeKey(SQL_CACHE_KEY_VERSION),
    max_value_bytes: asInteger(
      SQL_CACHE_MAX_VALUE_BYTES,
      1_048_576,
      1_024,
      DEPLOYMENT_MAX_VALUE_BYTES
    ),
    oversize_cooldown_seconds: asInteger(SQL_CACHE_OVERSIZE_COOLDOWN_SECONDS, 300, 0, 86_400),
    circuit_breaker_seconds: asInteger(SQL_CACHE_CIRCUIT_BREAKER_SECONDS, 15, 0, 3_600),
    single_flight_enabled: Boolean(SQL_CACHE_SINGLE_FLIGHT_ENABLED),
    table_allowlist: normalizeCsv(SQL_CACHE_TABLE_ALLOWLIST),
    table_blocklist: normalizeCsv(SQL_CACHE_TABLE_BLOCKLIST),
    table_policies: tablePolicies,
    source: "environment_fallback",
    stale: false,
    loaded_at: null,
    updated_at: null,
    updated_by: null,
    secrets_included: false,
  };
}

export function normalizeSqlCacheRuntimePolicy(value = {}, { strict = true } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("sql_cache_runtime_policy_invalid", "SQL cache runtime policy must be an object.");
  }
  if (strict) {
    const unknown = Object.keys(value).filter((key) => !ALLOWED_FIELDS.has(key));
    if (unknown.length) {
      throw fail(
        "sql_cache_runtime_policy_unknown_fields",
        "SQL cache runtime policy contains unsupported fields.",
        400,
        unknown.map((field) => ({ field, issue: "unsupported" }))
      );
    }
  }
  const fallback = envPolicy();
  return {
    enabled: asBoolean(value.enabled, fallback.enabled),
    required: asBoolean(value.required, fallback.required),
    key_version: normalizeKey(value.key_version, fallback.key_version),
    max_value_bytes: asInteger(
      value.max_value_bytes,
      fallback.max_value_bytes,
      1_024,
      DEPLOYMENT_MAX_VALUE_BYTES
    ),
    oversize_cooldown_seconds: asInteger(
      value.oversize_cooldown_seconds,
      fallback.oversize_cooldown_seconds,
      0,
      86_400
    ),
    circuit_breaker_seconds: asInteger(
      value.circuit_breaker_seconds,
      fallback.circuit_breaker_seconds,
      0,
      3_600
    ),
    single_flight_enabled: asBoolean(value.single_flight_enabled, fallback.single_flight_enabled),
    table_allowlist: normalizeCsv(value.table_allowlist ?? fallback.table_allowlist),
    table_blocklist: normalizeCsv(value.table_blocklist ?? fallback.table_blocklist),
    table_policies: normalizeTablePolicies(value.table_policies ?? fallback.table_policies),
  };
}

function parseRow(row) {
  const config = parseObject(row?.config_json, "sql_cache_runtime_policy_row_invalid");
  return {
    policy_key: String(row?.policy_key || POLICY_KEY),
    revision: asInteger(row?.revision, 0, 0, Number.MAX_SAFE_INTEGER),
    ...normalizeSqlCacheRuntimePolicy({ ...config, enabled: Number(row?.enabled) === 1 }),
    source: "mysql_primary",
    stale: false,
    loaded_at: new Date().toISOString(),
    updated_at: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    updated_by: row?.updated_by || null,
    secrets_included: false,
  };
}

function snapshot() {
  return state.current || state.lastGood || envPolicy();
}

export function getSqlCacheRuntimePolicySnapshot() {
  const value = snapshot();
  return { ...value, table_policies: { ...(value.table_policies || {}) } };
}

export function getSqlCacheRuntimePolicyStatus() {
  return {
    ...getSqlCacheRuntimePolicySnapshot(),
    refresh_seconds: SQL_CACHE_POLICY_REFRESH_SECONDS,
    refresh_in_flight: Boolean(state.inFlight),
    last_attempt_at: state.lastAttemptAt,
    last_success_at: state.lastSuccessAt,
    last_error_code: state.lastErrorCode,
  };
}

function refreshDue(now = Date.now()) {
  if (!state.lastAttemptAt) return true;
  const refreshMs = Math.max(1, Number(SQL_CACHE_POLICY_REFRESH_SECONDS || 15)) * 1_000;
  return now - Date.parse(state.lastAttemptAt) >= refreshMs;
}

export async function refreshSqlCacheRuntimePolicy({ force = false, pool = getPool(), now = Date.now() } = {}) {
  if (state.inFlight) return state.inFlight;
  if (!force && !refreshDue(now)) return getSqlCacheRuntimePolicySnapshot();

  state.lastAttemptAt = new Date(now).toISOString();
  state.inFlight = (async () => {
    try {
      const [rows] = await pool.query(
        `SELECT policy_key, revision, enabled, config_json, updated_by, updated_at
           FROM ${TABLE}
          WHERE policy_key = ?
          LIMIT 1`,
        [POLICY_KEY]
      );
      if (!rows?.[0]) throw fail("sql_cache_runtime_policy_not_found", "SQL cache runtime policy is not seeded.", 404);
      const next = parseRow(rows[0]);
      state.current = next;
      state.lastGood = next;
      state.lastSuccessAt = next.loaded_at;
      state.lastErrorCode = "";
      return getSqlCacheRuntimePolicySnapshot();
    } catch (error) {
      state.lastErrorCode = String(error?.code || "sql_cache_runtime_policy_load_failed")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .slice(0, 96);
      state.current = state.lastGood
        ? { ...state.lastGood, stale: true }
        : { ...envPolicy(), stale: true };
      return getSqlCacheRuntimePolicySnapshot();
    } finally {
      state.inFlight = null;
    }
  })();
  return state.inFlight;
}

export function ensureSqlCacheRuntimePolicyRefresh() {
  void refreshSqlCacheRuntimePolicy().catch(() => {});
}

function configurable(value) {
  return {
    enabled: value.enabled,
    required: value.required,
    key_version: value.key_version,
    max_value_bytes: value.max_value_bytes,
    oversize_cooldown_seconds: value.oversize_cooldown_seconds,
    circuit_breaker_seconds: value.circuit_breaker_seconds,
    single_flight_enabled: value.single_flight_enabled,
    table_allowlist: value.table_allowlist,
    table_blocklist: value.table_blocklist,
    table_policies: value.table_policies,
  };
}

export async function updateSqlCacheRuntimePolicy({
  expectedRevision,
  patch,
  updatedBy = "platform_admin",
  dryRun = false,
  pool = getPool(),
} = {}) {
  const revision = Number(expectedRevision);
  if (!Number.isInteger(revision) || revision < 0) {
    throw fail(
      "sql_cache_runtime_policy_expected_revision_required",
      "expected_revision must be a non-negative integer.",
      400,
      [{ field: "expected_revision", issue: "required_non_negative_integer" }]
    );
  }
  const current = await refreshSqlCacheRuntimePolicy({ force: true, pool });
  if (current.source !== "mysql_primary") {
    throw fail("sql_cache_runtime_policy_mysql_unavailable", "MySQL policy authority is unavailable.", 503);
  }
  if (current.revision !== revision) {
    throw fail(
      "sql_cache_runtime_policy_revision_conflict",
      "SQL cache runtime policy revision has changed.",
      409,
      [{ field: "expected_revision", issue: "conflict", current_revision: current.revision }]
    );
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw fail("sql_cache_runtime_policy_patch_invalid", "policy must be an object.");
  }

  const merged = normalizeSqlCacheRuntimePolicy({ ...configurable(current), ...patch });
  const preview = {
    policy_key: POLICY_KEY,
    revision: dryRun ? current.revision : current.revision + 1,
    ...merged,
    source: dryRun ? "dry_run" : "mysql_primary",
    stale: false,
    loaded_at: new Date().toISOString(),
    updated_at: current.updated_at,
    updated_by: String(updatedBy || "platform_admin").slice(0, 191),
    dry_run: Boolean(dryRun),
    secrets_included: false,
  };
  if (dryRun) return preview;

  const stored = configurable(preview);
  delete stored.enabled;
  const [result] = await pool.query(
    `UPDATE ${TABLE}
        SET revision = revision + 1,
            enabled = ?,
            config_json = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE policy_key = ?
        AND revision = ?`,
    [preview.enabled ? 1 : 0, JSON.stringify(stored), preview.updated_by, POLICY_KEY, current.revision]
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw fail("sql_cache_runtime_policy_revision_conflict", "SQL cache policy update lost a revision race.", 409);
  }
  return refreshSqlCacheRuntimePolicy({ force: true, pool });
}

export function resetSqlCacheRuntimePolicyForTests() {
  state.current = null;
  state.lastGood = null;
  state.inFlight = null;
  state.lastAttemptAt = null;
  state.lastSuccessAt = null;
  state.lastErrorCode = "";
}
