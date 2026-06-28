import assert from "node:assert/strict";

process.env.SQL_CACHE_ENABLED = "TRUE";
process.env.SQL_CACHE_KEY_VERSION = "v2";
process.env.SQL_CACHE_MAX_VALUE_BYTES = "1048576";
process.env.SQL_CACHE_POLICY_REFRESH_SECONDS = "15";
process.env.SQL_CACHE_RUNTIME_POLICY_CONFIG_KEY = "sql_cache_policy_v2";

const {
  getSqlCacheRuntimePolicySnapshot,
  normalizeSqlCacheRuntimePolicy,
  refreshSqlCacheRuntimePolicy,
  resetSqlCacheRuntimePolicyForTests,
  updateSqlCacheRuntimePolicy,
} = await import("./sqlCacheRuntimePolicy.js");
const {
  assertNoSecretBearingFields,
  isSafeFalseSecretMetadata,
} = await import("./capabilityEnvelopeSecretPolicy.js");

function fakePool({ row, updateAffectedRows = 1, failRead = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(String(sql));
      if (/^\s*SELECT/i.test(sql)) {
        if (failRead) throw failRead;
        return [[row], []];
      }
      if (/^\s*UPDATE/i.test(sql)) return [{ affectedRows: updateAffectedRows }, []];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

resetSqlCacheRuntimePolicyForTests();
assert.equal(getSqlCacheRuntimePolicySnapshot().source, "environment_fallback");

const row = {
  policy_key: "sql_cache_policy_v2",
  revision: 7,
  enabled: 1,
  config_json: JSON.stringify({
    key_version: "v7",
    max_value_bytes: 524288,
    oversize_cooldown_seconds: 90,
    circuit_breaker_seconds: 9,
    single_flight_enabled: false,
    table_allowlist: "workflows,task_routes",
    table_blocklist: "endpoints",
    table_policies: {
      workflows: { enabled: true, ttl_seconds: 45, max_value_bytes: 262144 },
    },
  }),
  updated_by: "test",
  updated_at: "2026-06-28T12:00:00.000Z",
};
const pool = fakePool({ row });
const loaded = await refreshSqlCacheRuntimePolicy({ force: true, pool });
assert.equal(loaded.source, "mysql_primary");
assert.equal(loaded.revision, 7);
assert.equal(loaded.key_version, "v7");
assert.equal(loaded.single_flight_enabled, false);
assert.equal(loaded.table_policies.workflows.ttl_seconds, 45);

const stale = await refreshSqlCacheRuntimePolicy({
  force: true,
  pool: fakePool({ failRead: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }),
});
assert.equal(stale.key_version, "v7");
assert.equal(stale.stale, true);

const dryRun = await updateSqlCacheRuntimePolicy({
  expectedRevision: 7,
  patch: { key_version: "v8", max_value_bytes: 393216 },
  updatedBy: "test",
  dryRun: true,
  pool,
});
assert.equal(dryRun.dry_run, true);
assert.equal(dryRun.key_version, "v8");
assert.equal(pool.calls.filter((sql) => /^\s*UPDATE/i.test(sql)).length, 0);

await assert.rejects(
  () => updateSqlCacheRuntimePolicy({ expectedRevision: 6, patch: {}, pool }),
  (error) => error.code === "sql_cache_runtime_policy_revision_conflict"
);
assert.throws(
  () => normalizeSqlCacheRuntimePolicy({ unsupported: true }),
  (error) => error.code === "sql_cache_runtime_policy_unknown_fields"
);

assert.equal(isSafeFalseSecretMetadata("secrets_returned_to_agent", false), true);
assert.equal(isSafeFalseSecretMetadata("secrets_returned_to_agent", 0), true);
assert.equal(isSafeFalseSecretMetadata("secrets_returned_to_agent", "false"), true);
assert.equal(isSafeFalseSecretMetadata("secrets_returned_to_agent", true), false);
assert.doesNotThrow(() =>
  assertNoSecretBearingFields({
    secrets_included: false,
    secrets_returned_to_agent: 0,
    nested: { raw_secret_values_included: "false" },
  })
);
assert.throws(
  () => assertNoSecretBearingFields({ secrets_returned_to_agent: true }),
  /refuses sensitive field/
);

console.log("SQL cache runtime policy tests passed.");
