import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.SQL_CACHE_ENABLED = "TRUE";
process.env.SQL_CACHE_REQUIRED = "FALSE";
process.env.SQL_CACHE_KEY_VERSION = "v2";
process.env.SQL_CACHE_MAX_VALUE_BYTES = "1048576";
process.env.SQL_CACHE_POLICY_REFRESH_SECONDS = "15";
process.env.SQL_CACHE_RUNTIME_POLICY_CONFIG_KEY = "sql_cache_policy_v2";
process.env.SQL_CACHE_TABLE_BLOCKLIST = "endpoints";
process.env.QUEUE_WORKER_ENABLED = "FALSE";
process.env.REDIS_URL = "";

const {
  buildSqlCacheOperationalDiagnostics,
  runSqlCacheControlledLoadTest,
} = await import("./sqlCacheOperationalDiagnostics.js");

const healthy = buildSqlCacheOperationalDiagnostics({
  enabled: true,
  available: true,
  redis_enabled: true,
  redis_url_configured: true,
  circuit_open: false,
  circuit_retry_after_ms: 0,
  last_error_code: "",
  in_flight_count: 0,
  oversize_cooldown_count: 0,
  single_flight_enabled: true,
  counters: {
    hits: 80,
    misses: 20,
    stores: 20,
    oversize_skips: 0,
    unavailable_skips: 0,
    circuit_open_skips: 0,
    errors: 0,
    bypasses: 0,
    single_flight_joins: 10,
  },
  policy: { revision: 1, source: "mysql_primary", stale: false },
});
assert.equal(healthy.monitoring_state, "healthy");
assert.equal(healthy.metrics.hit_ratio, 0.8);
assert.equal(healthy.metrics.miss_ratio, 0.2);
assert.equal(healthy.metrics.error_rate, 0);
assert.deepEqual(healthy.alerts, []);
assert.equal(healthy.persistence, "process_lifetime_counters");

const degraded = buildSqlCacheOperationalDiagnostics({
  enabled: true,
  required: true,
  available: false,
  fallback_mode: "direct_loader",
  fallback_active: false,
  redis_enabled: true,
  redis_url_configured: true,
  circuit_open: true,
  circuit_retry_after_ms: 15000,
  last_error_code: "econnreset",
  in_flight_count: 1,
  oversize_cooldown_count: 2,
  single_flight_enabled: true,
  counters: {
    hits: 1,
    misses: 39,
    stores: 1,
    oversize_skips: 2,
    unavailable_skips: 4,
    circuit_open_skips: 3,
    errors: 5,
    bypasses: 0,
    single_flight_joins: 0,
  },
  policy: { revision: 1, required: true, source: "last_known_good", stale: true, last_error_code: "db_timeout" },
}, {
  minimum_read_samples: 20,
  low_hit_ratio: 0.4,
  high_error_rate: 0.05,
});
assert.equal(degraded.monitoring_state, "critical");
assert.equal(degraded.ok, false);
const alertCodes = new Set(degraded.alerts.map((item) => item.code));
for (const code of [
  "sql_cache_unavailable",
  "sql_cache_circuit_open",
  "sql_cache_policy_stale",
  "sql_cache_low_hit_ratio",
  "sql_cache_high_error_rate",
  "sql_cache_oversize_cooldown_active",
]) {
  assert.equal(alertCodes.has(code), true, `missing alert ${code}`);
}
assert.equal(degraded.alerts.every((item) => item.secrets_included === false), true);

const optionalFallback = buildSqlCacheOperationalDiagnostics({
  enabled: true,
  required: false,
  available: false,
  fallback_mode: "direct_loader",
  fallback_active: true,
  redis_enabled: false,
  redis_url_configured: false,
  circuit_open: false,
  circuit_retry_after_ms: 0,
  last_error_code: "",
  in_flight_count: 0,
  oversize_cooldown_count: 0,
  single_flight_enabled: true,
  counters: {
    hits: 0,
    misses: 0,
    stores: 0,
    oversize_skips: 0,
    unavailable_skips: 0,
    circuit_open_skips: 0,
    errors: 0,
    bypasses: 0,
    single_flight_joins: 0,
  },
  policy: { revision: 1, required: false, source: "environment_fallback", stale: false },
});
assert.equal(optionalFallback.monitoring_state, "warning");
assert.equal(optionalFallback.ok, true);
assert.deepEqual(
  optionalFallback.alerts.map((item) => [item.code, item.severity]),
  [["sql_cache_optional_fallback_active", "medium"]]
);
assert.equal(optionalFallback.runtime.required, false);
assert.equal(optionalFallback.runtime.fallback_active, true);

const load = await runSqlCacheControlledLoadTest({
  iterations: 60,
  concurrency: 12,
  loader_delay_ms: 2,
  payload_bytes: 256,
});
assert.equal(load.ok, true);
assert.equal(load.mode, "isolated_in_memory");
assert.equal(load.production_redis_touched, false);
assert.equal(load.production_database_touched, false);
assert.equal(load.baseline.loader_calls, 60);
assert.equal(load.cached.loader_calls, 1);
assert.ok(load.cached.cache_hits > 0);
assert.ok(load.cached.single_flight_joins > 0);
assert.ok(load.comparison.loader_call_reduction_ratio > 0.9);
assert.equal(load.policy_guards.allowed_table.table, "workflows");
assert.equal(load.policy_guards.allowed_table.enabled, true);
assert.equal(load.policy_guards.security_denylist.table, "endpoints");
assert.equal(load.policy_guards.security_denylist.enabled, false);
assert.equal(load.policy_guards.security_denylist.security_denied, true);
assert.equal(load.policy_guards.security_denylist.reason, "security_denylist");
assert.equal(load.policy_guards.security_denylist.fallback_loader_calls, 1);
assert.equal(load.secrets_included, false);

const routes = readFileSync("routes/gptToolsRoutes.js", "utf8");
const alerts = readFileSync("operationalAlertService.js", "utf8");
assert.match(routes, /name: "sql_cache_runtime_diagnostics_get"/);
assert.match(routes, /name: "sql_cache_controlled_load_test"/);
assert.match(routes, /toolKey === "sql_cache_runtime_diagnostics_get"/);
assert.match(routes, /toolKey === "sql_cache_controlled_load_test"/);
assert.match(routes, /isolated_in_memory/);
assert.match(alerts, /source: "sql_cache_runtime"/);
assert.match(alerts, /sql_cache\.review_runtime/);
assert.doesNotMatch(
  alerts,
  /sql_cache_runtime:\s*1/,
  "synthetic singleton runtime diagnostics must not be treated as a SQL row-cap source"
);

console.log("SQL cache operational diagnostics tests passed.");
