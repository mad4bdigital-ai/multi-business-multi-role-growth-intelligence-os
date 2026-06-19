import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("scripts/local-connector-device-disable-rotate.mjs", "utf8");

assert(
  source.includes('import { writeExecutionEvidence } from "../executionEvidenceLogger.js"') &&
    source.includes('entryType: "local_connector_device_disable_rotate"') &&
    source.includes('toolKey: "local_connector_device_disable_rotate"') &&
    source.includes("execution_log: executionLog"),
  "apply path must attempt bounded execution_log evidence with a returned trace id"
);

assert(
  source.includes('const CONFIRMATION = "DISABLE_ROTATE_LOCAL_CONNECTOR_DEVICE"') &&
    source.includes("LOCAL_CONNECTOR_DEVICE_DISABLE_CONFIRMATION_REQUIRED"),
  "disable/rotate script must require an exact typed confirmation before apply"
);

assert(
  source.includes("cf_token IS NOT NULL AS cf_token_present") &&
    source.includes("connector_secret IS NOT NULL AS connector_secret_present") &&
    source.includes("connector_local_api_key IS NOT NULL AS connector_local_api_key_present"),
  "readback must expose only credential presence booleans"
);

const readQueryStart = source.indexOf("`SELECT config_id");
const readQueryEnd = source.indexOf("LIMIT 1`", readQueryStart);
assert(readQueryStart >= 0 && readQueryEnd > readQueryStart, "script must have a bounded device readback query");
const readQuery = source.slice(readQueryStart, readQueryEnd);
for (const secretColumn of ["cf_token", "connector_secret", "connector_local_api_key"]) {
  const rawOccurrences = readQuery.match(new RegExp(`\\b${secretColumn}\\b`, "g")) || [];
  assert.equal(rawOccurrences.length, 1, `readback query must mention ${secretColumn} exactly once`);
  assert(
    readQuery.includes(`${secretColumn} IS NOT NULL AS ${secretColumn}_present`),
    `readback query must expose ${secretColumn} only as a presence boolean`
  );
}

assert(
  source.includes("cf_token = NULL") &&
    source.includes("connector_secret = NULL") &&
    source.includes("connector_local_api_key = NULL") &&
    source.includes("is_enabled = 0"),
  "apply path must disable the device and clear stored connector credentials"
);

assert(
  source.includes("await connection.beginTransaction()") &&
    source.includes("await connection.commit()") &&
    source.includes("await connection.rollback()"),
  "apply path must be transactional"
);

assert(
  source.includes("no_provider_call: true") &&
    source.includes("no_external_write: true") &&
    source.includes("no_raw_secret_read: true") &&
    source.includes("secrets_included: false"),
  "script output must declare no-provider/no-external-write/no-secret guarantees"
);

assert(
  source.includes("executionLog.error = { code: err.code || \"execution_log_write_failed\", message: err.message }"),
  "execution_log failure must be reported separately from disable/rotate readback"
);

console.log("local connector device disable/rotate script guard passed");
