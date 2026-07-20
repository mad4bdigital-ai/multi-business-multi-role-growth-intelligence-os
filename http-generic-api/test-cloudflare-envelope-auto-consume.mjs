import assert from "node:assert/strict";
import { finalizeCloudflareEnvelopeLifecycle, verifyCloudflareReadback } from "./cloudflareEnvelopeLifecycle.js";

const matchingReadback = {
  ok: true,
  status: 200,
  data: {
    success: true,
    result: {
      id: "ruleset-1",
      version: "3",
      rules: [{ id: "rule-1", expression: "http.host eq \"dev.mad4b.com\"" }],
    },
  },
};

assert.equal(verifyCloudflareReadback(matchingReadback, {
  expected_rule_id: "rule-1",
  expected_expression: "http.host eq \"dev.mad4b.com\"",
}).ok, true);
assert.equal(verifyCloudflareReadback(matchingReadback, {}).reason_code, "cloudflare_readback_expectation_missing");
assert.equal(verifyCloudflareReadback(matchingReadback, {
  expected_rule_id: "rule-1",
  expected_expression: "http.host eq \"auth.mad4b.com\"",
}).reason_code, "cloudflare_readback_expression_mismatch");

let consumeCalls = 0;
const consumeEnvelope = async ({ envelopeId, executionRef }) => {
  consumeCalls += 1;
  return { envelope_id: envelopeId, execution_ref: executionRef, execution_status: "executed" };
};

const readOnly = await finalizeCloudflareEnvelopeLifecycle({
  body: { method: "GET", capability_envelope_id: "env-1" },
  mutationResult: { ok: true, data: { success: true } },
  executeReadback: async () => matchingReadback,
  consumeEnvelope,
});
assert.equal(readOnly.consumed, false);
assert.equal(consumeCalls, 0);

const providerFailure = await finalizeCloudflareEnvelopeLifecycle({
  body: { method: "PUT", capability_envelope_id: "env-1", readback_plan: { path: "/ruleset" } },
  mutationResult: { ok: false },
  executeReadback: async () => matchingReadback,
  consumeEnvelope,
});
assert.equal(providerFailure.consumed, false);
assert.equal(consumeCalls, 0);

const readbackFailure = await finalizeCloudflareEnvelopeLifecycle({
  body: {
    method: "PUT",
    capability_envelope_id: "env-1",
    readback_plan: { path: "/ruleset", expected_rule_id: "rule-1", expected_expression: "mismatch" },
  },
  mutationResult: { ok: true, data: { success: true } },
  executeReadback: async () => matchingReadback,
  consumeEnvelope,
});
assert.equal(readbackFailure.consumed, false);
assert.equal(readbackFailure.readback_verified, false);
assert.equal(readbackFailure.retry_provider_mutation, false);
assert.equal(consumeCalls, 0);

const success = await finalizeCloudflareEnvelopeLifecycle({
  body: {
    method: "PUT",
    path: "/client/v4/zones/zone/rulesets/ruleset-1",
    capability_envelope_id: "env-1",
    readback_plan: {
      path: "/client/v4/zones/zone/rulesets/ruleset-1",
      expected_rule_id: "rule-1",
      expected_expression: "http.host eq \"dev.mad4b.com\"",
    },
  },
  mutationResult: { ok: true, data: { success: true } },
  executeReadback: async () => matchingReadback,
  consumeEnvelope,
});
assert.equal(success.consumed, true);
assert.equal(success.readback_verified, true);
assert.equal(success.reconciliation_required, false);
assert.equal(success.retry_provider_mutation, false);
assert.equal(consumeCalls, 1);
assert.match(success.execution_ref, /version3$/);

const lifecycleFailure = await finalizeCloudflareEnvelopeLifecycle({
  body: {
    method: "PATCH",
    path: "/client/v4/zones/zone/rulesets/ruleset-1",
    capability_envelope_id: "env-2",
    readback_plan: {
      path: "/client/v4/zones/zone/rulesets/ruleset-1",
      expected_rule_id: "rule-1",
      expected_expression: "http.host eq \"dev.mad4b.com\"",
    },
  },
  mutationResult: { ok: true, data: { success: true } },
  executeReadback: async () => matchingReadback,
  consumeEnvelope: async () => {
    const error = new Error("lifecycle unavailable");
    error.code = "capability_envelope_transition_failed";
    throw error;
  },
});
assert.equal(lifecycleFailure.consumed, false);
assert.equal(lifecycleFailure.readback_verified, true);
assert.equal(lifecycleFailure.reconciliation_required, true);
assert.equal(lifecycleFailure.retry_provider_mutation, false);
assert.equal(lifecycleFailure.lifecycle_error_code, "capability_envelope_transition_failed");

console.log("cloudflare envelope auto-consume tests passed");
