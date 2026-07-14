import assert from "node:assert/strict";
import { loadHostingerSshExecutorGate } from "./hostingerSshDeployExecutor.js";

const targetId = "11111111-1111-4111-8111-111111111111";
const envelopeId = "22222222-2222-4222-8222-222222222222";
const expectedCommitSha = "a".repeat(40);
const future = new Date(Date.now() + 10 * 60_000).toISOString();

function buildPool({ dynamicRows = [], legacyRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("FROM release_gates")) return [dynamicRows];
      if (String(sql).includes("FROM platform_runtime_config")) return [legacyRows];
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
  };
}

const matchingPool = buildPool({
  dynamicRows: [{
    gate_id: "33333333-3333-4333-8333-333333333333",
    operation_id: "44444444-4444-4444-8444-444444444444",
    target_id: targetId,
    expected_commit_sha: expectedCommitSha,
    capability_envelope_id: envelopeId,
    expires_at: future,
    status: "open",
    operation_status: "ready_for_execution",
  }],
  legacyRows: [{ status: "active", config_json: JSON.stringify({ enabled: true }) }],
});
const matching = await loadHostingerSshExecutorGate(matchingPool, {
  targetId,
  expectedCommitSha,
  capabilityEnvelopeId: envelopeId,
  env: {},
});
assert.equal(matching.enabled, true);
assert.equal(matching.source, "release_gates");
assert.equal(matching.reason, "enabled");
assert.equal(matchingPool.calls.filter((call) => call.sql.includes("platform_runtime_config")).length, 0);

const mismatchPool = buildPool({
  dynamicRows: [{
    gate_id: "55555555-5555-4555-8555-555555555555",
    operation_id: "66666666-6666-4666-8666-666666666666",
    target_id: targetId,
    expected_commit_sha: "b".repeat(40),
    capability_envelope_id: envelopeId,
    expires_at: future,
    status: "open",
    operation_status: "ready_for_execution",
  }],
  legacyRows: [{ status: "active", config_json: JSON.stringify({ enabled: true, target_id: targetId }) }],
});
const mismatch = await loadHostingerSshExecutorGate(mismatchPool, {
  targetId,
  expectedCommitSha,
  capabilityEnvelopeId: envelopeId,
  env: {},
});
assert.equal(mismatch.enabled, false);
assert.equal(mismatch.source, "release_gates");
assert.equal(mismatch.reason, "dynamic_gate_commit_mismatch");
assert.equal(mismatchPool.calls.filter((call) => call.sql.includes("platform_runtime_config")).length, 0);

const fallbackPool = buildPool({
  dynamicRows: [],
  legacyRows: [{
    status: "active",
    config_json: JSON.stringify({ enabled: true, target_id: targetId, expires_at: future }),
  }],
});
const fallback = await loadHostingerSshExecutorGate(fallbackPool, {
  targetId,
  expectedCommitSha,
  capabilityEnvelopeId: envelopeId,
  env: {},
});
assert.equal(fallback.enabled, true);
assert.equal(fallback.source, "platform_runtime_config");
assert.equal(fallback.legacy_fallback, true);
assert.equal(fallbackPool.calls.filter((call) => call.sql.includes("platform_runtime_config")).length, 1);

console.log("hostinger dynamic release gate precedence tests passed");
