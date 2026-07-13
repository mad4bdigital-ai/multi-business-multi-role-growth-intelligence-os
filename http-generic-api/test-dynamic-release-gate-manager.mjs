import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReleaseGateCompatibilityConfig,
  classifyCapabilityEnvelopeForReleaseGate,
  classifyReleaseGateReadback,
  normalizeReleaseGateOpenInput,
} from "./releaseGateManagerService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adapter = {
  adapter_key: "hostinger_ssh_executor",
  config_key: "remote_runtime_hostinger_ssh_executor_enabled",
  gate_key: "release_execution",
  app_key: "hostinger",
  capability_key: "remote_runtime_hostinger_deploy_release",
  default_ttl_minutes: 30,
  max_ttl_minutes: 120,
};

const normalized = normalizeReleaseGateOpenInput({
  operation_id: "11111111-1111-4111-8111-111111111111",
  target_id: "22222222-2222-4222-8222-222222222222",
  expected_commit_sha: "a".repeat(40),
  capability_envelope_id: "33333333-3333-4333-8333-333333333333",
  ttl_minutes: 45,
  reason: "Open a bounded release gate for verified deploy workflow.",
}, adapter);
assert.equal(normalized.adapter_key, "hostinger_ssh_executor");
assert.equal(normalized.ttl_minutes, 45);
assert.equal(normalized.app_key, "hostinger");

const gate = {
  gate_id: "44444444-4444-4444-8444-444444444444",
  operation_id: normalized.operation_id,
  adapter_key: adapter.adapter_key,
  target_id: normalized.target_id,
  app_key: normalized.app_key,
  expected_commit_sha: normalized.expected_commit_sha,
  capability_envelope_id: normalized.capability_envelope_id,
  status: "open",
  expires_at: new Date(Date.now() + 30 * 60_000),
};
const config = buildReleaseGateCompatibilityConfig({ gate, adapter, enabled: true, event: "opened" });
assert.equal(config.enabled, true);
assert.equal(config.gate_id, gate.gate_id);
assert.equal(config.provider_dispatch_allowed, false);
assert.equal(config.secrets_included, false);

const openReadback = classifyReleaseGateReadback({
  gate,
  adapter,
  configRow: { status: "active", config_json: JSON.stringify(config) },
});
assert.equal(openReadback.status, "verified");
assert.equal(openReadback.should_be_open, true);

const closedGate = { ...gate, status: "closed" };
const closedConfig = buildReleaseGateCompatibilityConfig({ gate: closedGate, adapter, enabled: false, event: "closed" });
const closedReadback = classifyReleaseGateReadback({ gate: closedGate, adapter, configRow: { status: "disabled", config_json: JSON.stringify(closedConfig) } });
assert.equal(closedReadback.status, "verified");
assert.equal(closedReadback.should_be_open, false);

const expiredGate = { ...gate, expires_at: new Date(Date.now() - 60_000) };
const expiredReadback = classifyReleaseGateReadback({ gate: expiredGate, adapter, configRow: { status: "active", config_json: JSON.stringify(config) } });
assert.equal(expiredReadback.status, "expired_open_gate");

const migration = fs.readFileSync(path.join(__dirname, "migrations", "20260713_dynamic_release_gate_manager.sql"), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS release_gate_adapters/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS release_gates/);
assert.match(migration, /hostinger_ssh_executor/);
for (const toolKey of ["release_gate_open", "release_gate_close", "release_gate_expire", "release_gate_hard_disable", "release_gate_get", "release_gate_list", "release_gate_reconcile"]) assert.match(migration, new RegExp(toolKey));
assert.match(migration, /dynamic_release_gate_manager_policy_v1/);
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);

const openapi = fs.readFileSync(path.join(__dirname, "openapi", "release-gates.yaml"), "utf8");
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /operationId: openReleaseGate/);
assert.match(openapi, /operationId: closeReleaseGate/);
assert.match(openapi, /operationId: reconcileReleaseGates/);

console.log("dynamic release gate manager tests passed");
