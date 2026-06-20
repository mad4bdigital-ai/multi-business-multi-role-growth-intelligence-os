import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_DEVICE_HEARTBEAT_MAX_AGE_MS,
  evaluateLocalConnectorDeviceTrust,
  assertLocalConnectorDeviceTrust,
} from "./localConnectorDeviceTrust.js";

const now = Date.parse("2026-06-20T00:00:00.000Z");
const trustedConfig = {
  config_id: "config-1",
  user_id: "user-1",
  tenant_id: "tenant-1",
  device_id: "device-1",
  is_enabled: 1,
  lifecycle_state: "active",
  connector_secret: "not-returned-by-evaluator",
  last_health_at: new Date(now - 60_000).toISOString(),
};
const base = {
  config: trustedConfig,
  userId: "user-1",
  tenantId: "tenant-1",
  deviceId: "device-1",
  capabilityKey: "shell:node_ver",
  capabilitySupported: true,
  now,
};

const cases = [
  ["missing_device_id", { ...base, deviceId: "" }],
  ["local_device_not_found", { ...base, config: null }],
  ["local_device_identity_mismatch", { ...base, config: { ...trustedConfig, device_id: "other-device" } }],
  ["local_device_tenant_mismatch", { ...base, config: { ...trustedConfig, tenant_id: "other-tenant" } }],
  ["local_device_user_mismatch", { ...base, config: { ...trustedConfig, user_id: "other-user" } }],
  ["local_device_disabled", { ...base, config: { ...trustedConfig, is_enabled: 0 } }],
  ["local_device_connector_identity_missing", { ...base, config: { ...trustedConfig, connector_secret: null } }],
  ["local_device_heartbeat_missing", { ...base, config: { ...trustedConfig, last_health_at: null } }],
  ["local_device_heartbeat_invalid", { ...base, config: { ...trustedConfig, last_health_at: "not-a-date" } }],
  ["local_device_heartbeat_stale", {
    ...base,
    config: { ...trustedConfig, last_health_at: new Date(now - DEFAULT_DEVICE_HEARTBEAT_MAX_AGE_MS - 1).toISOString() },
  }],
  ["local_device_capability_unsupported", { ...base, capabilitySupported: false }],
];

for (const [expectedCode, input] of cases) {
  const decision = evaluateLocalConnectorDeviceTrust(input);
  assert.equal(decision.ok, false, `${expectedCode} must deny execution`);
  assert.equal(decision.code, expectedCode);
  assert.equal(decision.evidence.secrets_included, false);
  assert.equal(JSON.stringify(decision).includes(trustedConfig.connector_secret), false, "trust decisions must not expose connector secrets");
}

const allowed = evaluateLocalConnectorDeviceTrust(base);
assert.equal(allowed.ok, true);
assert.equal(allowed.code, "local_device_trusted");
assert.equal(allowed.evidence.device_id, "device-1");
assert.equal(allowed.evidence.heartbeat_age_ms, 60_000);
assert.equal(allowed.evidence.secrets_included, false);
assert.equal(JSON.stringify(allowed).includes(trustedConfig.connector_secret), false);

assert.throws(
  () => assertLocalConnectorDeviceTrust({ ...base, capabilitySupported: false }),
  (error) => error.code === "local_device_capability_unsupported" && error.status === 403,
);

const orchestrator = readFileSync("services/localConnectorOrchestrator.js", "utf8");
assert(orchestrator.includes('assertLocalConnectorDeviceTrust'), "local connector orchestrator must enforce device trust");
assert(orchestrator.includes('capabilityKey: `shell:${alias}`'), "shell execution must bind trust to the requested alias");
assert(orchestrator.includes('capabilityKey: "file:read"'), "file read must require device capability support");
assert(orchestrator.includes('capabilityKey: "file:write"'), "file write must require device capability support");
assert(orchestrator.includes('err.code || "local_command_execution_failed"'), "device trust reason codes must survive shell error mapping");
assert(orchestrator.includes('err.code || "local_file_read_failed"'), "device trust reason codes must survive file read error mapping");
assert(orchestrator.includes('err.code || "local_file_write_failed"'), "device trust reason codes must survive file write error mapping");

console.log("local connector device trust matrix passed");
