import assert from "node:assert/strict";
import test from "node:test";

import { readEnvironmentConvergenceRegistry } from "./environmentConvergenceRegistry.js";
import { observeStagingGatewayConvergence } from "./stagingEnvironmentConvergenceObservation.js";

const registry = readEnvironmentConvergenceRegistry();
const profile = registry.profiles.staging.activation_gateway;
const desiredCommit = "a".repeat(40);

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(body); },
  };
}

function healthyBody(overrides = {}) {
  return {
    ok: true,
    service: "activation-gateway",
    policyKey: profile.policy_key,
    policyHash: profile.expected_policy_hash,
    sourceCommit: desiredCommit,
    workerBuildSha: desiredCommit,
    stale: false,
    ...overrides,
  };
}

test("exact live Gateway evidence remains converged", async () => {
  let observedUrl = null;
  let observedRedirect = null;
  const result = await observeStagingGatewayConvergence({
    registry,
    expectedCommit: desiredCommit,
    fetchImpl: async (url, options) => {
      observedUrl = url;
      observedRedirect = options?.redirect;
      return response(healthyBody());
    },
  });
  assert.equal(observedUrl, `https://${profile.public_host}/health`);
  assert.equal(observedRedirect, "error");
  assert.equal(result.observation.reachable, true);
  assert.deepEqual(result.reasons, []);
});

test("live Gateway SHA drift emits gateway_exact_commit", async () => {
  const result = await observeStagingGatewayConvergence({
    registry,
    expectedCommit: desiredCommit,
    fetchImpl: async () => response(healthyBody({
      sourceCommit: "b".repeat(40),
      workerBuildSha: "b".repeat(40),
    })),
  });
  assert.deepEqual(result.reasons, ["gateway_exact_commit"]);
  assert.equal(result.observation.sourceCommit, "b".repeat(40));
});

test("worker build SHA drift emits gateway_exact_commit", async () => {
  const result = await observeStagingGatewayConvergence({
    registry,
    expectedCommit: desiredCommit,
    fetchImpl: async () => response(healthyBody({
      workerBuildSha: "c".repeat(40),
    })),
  });
  assert.deepEqual(result.reasons, ["gateway_exact_commit"]);
  assert.equal(result.observation.sourceCommit, desiredCommit);
  assert.equal(result.observation.workerBuildSha, "c".repeat(40));
});

test("live policy hash drift is observed before not_required", async () => {
  const result = await observeStagingGatewayConvergence({
    registry,
    expectedCommit: desiredCommit,
    fetchImpl: async () => response(healthyBody({ policyHash: "0".repeat(64) })),
  });
  assert.deepEqual(result.reasons, ["gateway_policy_hash_current"]);
});

test("live policy key drift is observed", async () => {
  const result = await observeStagingGatewayConvergence({
    registry,
    expectedCommit: desiredCommit,
    fetchImpl: async () => response(healthyBody({ policyKey: "wrong_staging_profile" })),
  });
  assert.deepEqual(result.reasons, ["gateway_policy_key_current"]);
});

test("stale Gateway produces governed stale-policy reason even on HTTP 503", async () => {
  const result = await observeStagingGatewayConvergence({
    registry,
    expectedCommit: desiredCommit,
    fetchImpl: async () => response(healthyBody({ ok: false, stale: true }), 503),
  });
  assert.deepEqual(result.reasons, ["gateway_policy_not_stale"]);
  assert.equal(result.observation.reachable, true);
  assert.equal(result.observation.httpStatus, 503);
});

test("Gateway dependency failure fails closed as unreachable", async () => {
  const result = await observeStagingGatewayConvergence({
    registry,
    expectedCommit: desiredCommit,
    fetchImpl: async () => { throw new Error("synthetic_network_failure"); },
  });
  assert.equal(result.observation.reachable, false);
  assert.deepEqual(result.reasons, ["gateway_health_reachable"]);
});

test("unexpected service identity is an integrity failure input", async () => {
  const result = await observeStagingGatewayConvergence({
    registry,
    expectedCommit: desiredCommit,
    fetchImpl: async () => response(healthyBody({ service: "unexpected-service" })),
  });
  assert.deepEqual(result.reasons, ["gateway_environment_profile_current"]);
});
