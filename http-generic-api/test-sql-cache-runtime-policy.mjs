import assert from "node:assert/strict";

process.env.SQL_CACHE_ENABLED = "TRUE";
process.env.SQL_CACHE_REQUIRED = "FALSE";
process.env.SQL_CACHE_KEY_VERSION = "v2";
process.env.SQL_CACHE_MAX_VALUE_BYTES = "1048576";
process.env.SQL_CACHE_POLICY_REFRESH_SECONDS = "15";
process.env.SQL_CACHE_RUNTIME_POLICY_CONFIG_KEY = "sql_cache_policy_v2";
process.env.QUEUE_WORKER_ENABLED = "FALSE";
process.env.REDIS_URL = "";

const {
  getSqlCacheRuntimePolicySnapshot,
  normalizeSqlCacheRuntimePolicy,
  refreshSqlCacheRuntimePolicy,
  resetSqlCacheRuntimePolicyForTests,
  updateSqlCacheRuntimePolicy,
} = await import("./sqlCacheRuntimePolicy.js");
const {
  prepareSqlCacheValue,
  resolveSqlCacheTablePolicy,
} = await import("./sqlCachePolicy.js");
const {
  setSqlCacheWithOutcome,
  sqlCacheKey,
} = await import("./sqlCache.js");

function fakePool({ row, failRead = null } = {}) {
  const calls = [];
  let current = row ? structuredClone(row) : null;
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (/^\s*SELECT/i.test(sql)) {
        if (failRead) throw failRead;
        return [[current].filter(Boolean), []];
      }
      if (/^\s*UPDATE/i.test(sql)) {
        const [enabled, configJson, updatedBy, policyKey, expectedRevision] = params;
        if (!current || current.policy_key !== policyKey || current.revision !== expectedRevision) {
          return [{ affectedRows: 0 }, []];
        }
        current = {
          ...current,
          revision: current.revision + 1,
          enabled,
          config_json: configJson,
          updated_by: updatedBy,
          updated_at: "2026-06-29T01:00:00.000Z",
        };
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

resetSqlCacheRuntimePolicyForTests();
const fallback = getSqlCacheRuntimePolicySnapshot();
assert.equal(fallback.source, "environment_fallback");
assert.equal(fallback.key_version, "v2");
assert.equal(fallback.max_value_bytes, 1_048_576);
assert.equal(fallback.required, false);

const row = {
  policy_key: "sql_cache_policy_v2",
  revision: 7,
  enabled: 1,
  config_json: JSON.stringify({
    required: true,
    key_version: "v7",
    max_value_bytes: 524288,
    oversize_cooldown_seconds: 90,
    circuit_breaker_seconds: 9,
    single_flight_enabled: false,
    table_allowlist: "workflows,task_routes,endpoints",
    table_blocklist: "",
    table_policies: {
      workflows: { enabled: true, ttl_seconds: 45, max_value_bytes: 262144 },
      endpoints: { enabled: true, ttl_seconds: 60 },
    },
  }),
  updated_by: "test",
  updated_at: "2026-06-29T00:30:00.000Z",
};
const pool = fakePool({ row });
const loaded = await refreshSqlCacheRuntimePolicy({ force: true, pool });
assert.equal(loaded.source, "mysql_primary");
assert.equal(loaded.revision, 7);
assert.equal(loaded.key_version, "v7");
assert.equal(loaded.single_flight_enabled, false);
assert.equal(loaded.required, true);

const workflowPolicy = resolveSqlCacheTablePolicy("workflows", { requestedTtlSeconds: 60 });
assert.equal(workflowPolicy.enabled, true);
assert.equal(workflowPolicy.ttl_seconds, 45);
assert.equal(workflowPolicy.max_value_bytes, 262144);
assert.equal(sqlCacheKey("table", "workflows", "rows"), "sql:v7:table:workflows:rows");

const endpointPolicy = resolveSqlCacheTablePolicy("endpoints", { requestedTtlSeconds: 60 });
assert.equal(endpointPolicy.enabled, false);
assert.equal(endpointPolicy.reason, "security_denylist");
assert.equal(endpointPolicy.security_denied, true);

const oversized = prepareSqlCacheValue({ payload: "x".repeat(17_000_000) }, 1_048_576);
assert.equal(oversized.status, "skipped_oversize");
assert.ok(oversized.bytes > 10_485_760);

let redisSetCalls = 0;
const fakeRedis = {
  async set() {
    redisSetCalls += 1;
    return "OK";
  },
};
const oversizedWrite = await setSqlCacheWithOutcome(
  "sql:v7:table:workflows:rows",
  { payload: "x".repeat(17_000_000) },
  60,
  {
    client: fakeRedis,
    availableOverride: true,
    maxValueBytes: 1_048_576,
    oversizeCooldownSeconds: 30,
  }
);
assert.equal(oversizedWrite.status, "skipped_oversize");
assert.equal(redisSetCalls, 0);

const dryRun = await updateSqlCacheRuntimePolicy({
  expectedRevision: 7,
  patch: { key_version: "v8", max_value_bytes: 393216, required: false },
  updatedBy: "test",
  dryRun: true,
  pool,
});
assert.equal(dryRun.dry_run, true);
assert.equal(dryRun.key_version, "v8");
assert.equal(pool.calls.filter((call) => /^\s*UPDATE/i.test(call.sql)).length, 0);

const updated = await updateSqlCacheRuntimePolicy({
  expectedRevision: 7,
  patch: {
    key_version: "v8",
    max_value_bytes: 393216,
    required: false,
    single_flight_enabled: true,
  },
  updatedBy: "test",
  pool,
});
assert.equal(updated.source, "mysql_primary");
assert.equal(updated.revision, 8);
assert.equal(updated.key_version, "v8");
assert.equal(updated.max_value_bytes, 393216);
assert.equal(updated.required, false);
assert.equal(sqlCacheKey("table", "workflows", "rows"), "sql:v8:table:workflows:rows");

const stale = await refreshSqlCacheRuntimePolicy({
  force: true,
  pool: fakePool({ failRead: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }),
});
assert.equal(stale.key_version, "v8");
assert.equal(stale.stale, true);

await assert.rejects(
  () => updateSqlCacheRuntimePolicy({ expectedRevision: 7, patch: {}, pool }),
  (error) => error.code === "sql_cache_runtime_policy_revision_conflict"
);
assert.throws(
  () => normalizeSqlCacheRuntimePolicy({ unsupported: true }),
  (error) => error.code === "sql_cache_runtime_policy_unknown_fields"
);

console.log("SQL cache runtime policy tests passed.");
