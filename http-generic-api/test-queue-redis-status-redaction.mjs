process.env.REDIS_URL = "rediss://default:secret-token@example.invalid:6379";
process.env.QUEUE_WORKER_ENABLED = "TRUE";
process.env.SQL_CACHE_ENABLED = "TRUE";
process.env.SQL_CACHE_MAX_VALUE_BYTES = "1048576";
process.env.SQL_CACHE_KEY_VERSION = "v2";
process.env.SQL_CACHE_TABLE_POLICIES_JSON =
  '{"workflows":{"enabled":true,"ttl_seconds":120,"max_value_bytes":262144}}';

const SECRET_PARTS = ["secret-token", "example.invalid", process.env.REDIS_URL];

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

const {
  getRedisRuntimeStatus,
  jobQueue,
  redis,
} = await import("./queue.js");

const {
  getSqlCacheRuntimeStatus,
  resetSqlCacheRuntimeStateForTests,
  setSqlCacheWithOutcome,
  sqlCacheKey,
} = await import("./sqlCache.js");

const {
  parseSqlCacheTablePolicies,
  prepareSqlCacheValue,
  resolveSqlCacheTablePolicy,
} = await import("./sqlCachePolicy.js");

console.log("== Redis status redaction ==");

const status = getRedisRuntimeStatus();
const serialized = JSON.stringify(status);

assert("Redis status marks URL as configured", status.url_configured === true, serialized);
assert(
  "Redis status returns a redacted URL marker",
  status.url_redacted === "<redacted>",
  serialized
);
assert(
  "Redis status does not expose legacy raw url field",
  !Object.prototype.hasOwnProperty.call(status, "url"),
  serialized
);
assert(
  "Redis status serialization does not include connection secrets",
  SECRET_PARTS.every((part) => !serialized.includes(part)),
  serialized
);

console.log("== Dynamic SQL cache policy ==");

const workflowPolicy = resolveSqlCacheTablePolicy("workflows", {
  requestedTtlSeconds: 60,
  policySource:
    '{"workflows":{"enabled":true,"ttl_seconds":120,"max_value_bytes":262144}}',
});
assert("Per-table policy enables workflow cache", workflowPolicy.enabled === true);
assert("Per-table policy overrides TTL", workflowPolicy.ttl_seconds === 120);
assert(
  "Per-table policy overrides maximum bytes",
  workflowPolicy.max_value_bytes === 262144
);

const deniedPolicy = resolveSqlCacheTablePolicy("hosting_accounts", {
  requestedTtlSeconds: 60,
  allowlistSource: "hosting_accounts",
  policySource: '{"hosting_accounts":{"enabled":true}}',
});
assert(
  "Security denylist cannot be overridden by configuration",
  deniedPolicy.enabled === false && deniedPolicy.reason === "security_denylist",
  JSON.stringify(deniedPolicy)
);

const invalidPolicy = parseSqlCacheTablePolicies("{not-json");
assert(
  "Malformed table policy JSON fails closed",
  invalidPolicy.valid === false &&
    invalidPolicy.error_code === "sql_cache_policy_json_invalid"
);

assert(
  "Cache keys use the configured version namespace",
  sqlCacheKey("table", "workflows", "rows") === "sql:v2:table:workflows:rows"
);

console.log("== SQL cache value safety ==");

const oversizedValue = { payload: "x".repeat(17_000_000) };
const preparedOversize = prepareSqlCacheValue(oversizedValue, 1_048_576);
assert(
  "17 MB value is rejected before transport",
  preparedOversize.status === "skipped_oversize" &&
    preparedOversize.bytes > preparedOversize.max_bytes,
  JSON.stringify({
    status: preparedOversize.status,
    bytes: preparedOversize.bytes,
    max_bytes: preparedOversize.max_bytes,
  })
);

const unicodeValue = { payload: "😀".repeat(300) };
const preparedUnicode = prepareSqlCacheValue(unicodeValue, 1_024);
assert(
  "Unicode size enforcement uses UTF-8 bytes",
  preparedUnicode.status === "skipped_oversize",
  JSON.stringify({
    status: preparedUnicode.status,
    bytes: preparedUnicode.bytes,
    max_bytes: preparedUnicode.max_bytes,
  })
);

resetSqlCacheRuntimeStateForTests();
let setCalls = 0;
const fakeRedis = {
  async set() {
    setCalls += 1;
    return "OK";
  },
};

const oversizeOutcome = await setSqlCacheWithOutcome(
  "sql:v2:test:oversize",
  oversizedValue,
  60,
  {
    client: fakeRedis,
    availableOverride: true,
    maxValueBytes: 1_048_576,
    oversizeCooldownSeconds: 300,
  }
);
assert(
  "Oversized value returns a structured skip outcome",
  oversizeOutcome.status === "skipped_oversize"
);
assert("Oversized value never calls Redis SET", setCalls === 0, String(setCalls));

const storedOutcome = await setSqlCacheWithOutcome(
  "sql:v2:test:small",
  { ok: true },
  60,
  {
    client: fakeRedis,
    availableOverride: true,
    maxValueBytes: 1_048_576,
  }
);
assert("Small value is stored", storedOutcome.status === "stored");
assert("Small value calls Redis SET exactly once", setCalls === 1, String(setCalls));

const sqlStatus = getSqlCacheRuntimeStatus();
const sqlStatusSerialized = JSON.stringify(sqlStatus);
assert(
  "SQL cache status exposes dynamic policy metadata",
  sqlStatus.policy?.key_version === "v2" &&
    sqlStatus.policy?.max_value_bytes === 1_048_576
);
assert(
  "SQL cache status does not expose connection secrets",
  SECRET_PARTS.every((part) => !sqlStatusSerialized.includes(part)),
  sqlStatusSerialized
);

redis?.disconnect?.();
await jobQueue?.close?.().catch(() => {});

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
