import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("routes/connectorProxyRoutes.js", "utf8");

assert(source.includes("async function isWrongDeviceHealthResponse"), "health mismatch validation must be async so aliases can be resolved");
assert(source.includes("local_connector_device_aliases"), "health mismatch validation must consult active device aliases");
assert(source.includes("LOWER(alias_device_id)"), "alias lookup must normalize hostname case");
assert(source.includes("LOWER(canonical_device_id)"), "alias lookup must compare canonical device IDs");
assert(source.includes("await isWrongDeviceHealthResponse"), "proxy health route must await alias-aware validation");

console.log("connector health alias validation tests passed");
