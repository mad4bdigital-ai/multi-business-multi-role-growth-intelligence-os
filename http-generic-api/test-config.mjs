import "./test-runtime-registry-authority.mjs";
import { positiveNumberEnv } from "./config.js";

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

function withEnv(name, value, fn) {
  const hadOriginal = Object.prototype.hasOwnProperty.call(process.env, name);
  const original = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    fn();
  } finally {
    if (hadOriginal) {
      process.env[name] = original;
    } else {
      delete process.env[name];
    }
  }
}

console.log("== config env parsing ==");

withEnv("MAX_TIMEOUT_SECONDS", "900", () => {
  assert(
    "positiveNumberEnv accepts numeric strings",
    positiveNumberEnv("MAX_TIMEOUT_SECONDS", 300, { max: 3600 }) === 900
  );
});

withEnv("MAX_TIMEOUT_SECONDS", "900s", () => {
  assert(
    "positiveNumberEnv falls back on malformed manual env values",
    positiveNumberEnv("MAX_TIMEOUT_SECONDS", 300, { max: 3600 }) === 300
  );
});

withEnv("MAX_TIMEOUT_SECONDS", "   ", () => {
  assert(
    "positiveNumberEnv falls back on blank manual env values",
    positiveNumberEnv("MAX_TIMEOUT_SECONDS", 300, { max: 3600 }) === 300
  );
});

withEnv("MAX_TIMEOUT_SECONDS", "-5", () => {
  assert(
    "positiveNumberEnv falls back below minimum",
    positiveNumberEnv("MAX_TIMEOUT_SECONDS", 300, { max: 3600 }) === 300
  );
});

withEnv("MAX_TIMEOUT_SECONDS", "7200", () => {
  assert(
    "positiveNumberEnv caps above maximum",
    positiveNumberEnv("MAX_TIMEOUT_SECONDS", 300, { max: 3600 }) === 3600
  );
});

withEnv("REGISTRY_CACHE_TTL_SECONDS", "0", () => {
  assert(
    "positiveNumberEnv can allow zero when min is zero",
    positiveNumberEnv("REGISTRY_CACHE_TTL_SECONDS", 600, { min: 0 }) === 0
  );
});

console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
