process.env.REDIS_URL = "rediss://default:secret-token@example.invalid:6379";
process.env.QUEUE_WORKER_ENABLED = "TRUE";

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
  redis
} = await import("./queue.js");

const status = getRedisRuntimeStatus();
const serialized = JSON.stringify(status);

assert("Redis status marks URL as configured", status.url_configured === true, serialized);
assert("Redis status returns a redacted URL marker", status.url_redacted === "<redacted>", serialized);
assert("Redis status does not expose legacy raw url field", !Object.prototype.hasOwnProperty.call(status, "url"), serialized);
assert(
  "Redis status serialization does not include connection secrets",
  SECRET_PARTS.every(part => !serialized.includes(part)),
  serialized
);

redis?.disconnect?.();
await jobQueue?.close?.().catch(() => {});

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
