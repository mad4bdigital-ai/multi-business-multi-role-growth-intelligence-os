import assert from "node:assert/strict";
import {
  OperationBindingScoringError,
  scoreOperationBindingCandidate,
  scoreOperationBindingCandidates,
} from "./operationBindingScoring.js";

const metrics = {
  quality: 0.8,
  reliability: 0.9,
  privacy: 0.7,
  preference_match: 0.6,
  context_reuse: 0.5,
  estimated_cost: 0.2,
  expected_latency: 0.3,
  saturation: 0.4,
};
const weights = {
  quality: 0.2,
  reliability: 0.2,
  privacy: 0.15,
  preference_match: 0.1,
  context_reuse: 0.1,
  estimated_cost: 0.1,
  expected_latency: 0.1,
  saturation: 0.05,
};

{
  const result = scoreOperationBindingCandidate({
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.alpha",
    eligible: true,
    metrics,
    weights,
  });
  const expected = metrics.quality * weights.quality
    + metrics.reliability * weights.reliability
    + metrics.privacy * weights.privacy
    + metrics.preference_match * weights.preference_match
    + metrics.context_reuse * weights.context_reuse
    + (1 - metrics.estimated_cost) * weights.estimated_cost
    + (1 - metrics.expected_latency) * weights.expected_latency
    + (1 - metrics.saturation) * weights.saturation;
  assert.equal(result.score, Number(expected.toFixed(6)));
  assert.equal(result.dimensions.health.normalized_value, 0.8);
  assert.equal(result.dimensions.capacity.normalized_value, 0.6);
  assert.equal(result.dimensions.cost.normalized_value, 0.8);
  assert.equal(result.dimensions.reliability.normalized_value, 0.9);
  assert.equal(result.dimensions.preference.normalized_value, 0.6);
  assert.equal(result.candidate_selected, false);
  assert.equal(result.selection_authorized, false);
  assert.equal(result.fallback_performed, false);
  assert.equal(result.authority_created, false);
}

{
  const first = scoreOperationBindingCandidate({
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.alpha",
    eligible: true,
    metrics,
    weights,
  });
  const second = scoreOperationBindingCandidate({
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.alpha",
    eligible: true,
    metrics: { ...metrics },
    weights: { ...weights },
  });
  assert.equal(first.evidence_hash, second.evidence_hash);
}

{
  const lowPreference = scoreOperationBindingCandidate({
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.alpha",
    eligible: true,
    metrics: { ...metrics, preference_match: 0 },
    weights,
  });
  const highPreference = scoreOperationBindingCandidate({
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.alpha",
    eligible: true,
    metrics: { ...metrics, preference_match: 1 },
    weights,
  });
  assert.ok(highPreference.score > lowPreference.score);
  assert.equal(highPreference.authority_created, false);
}

assert.throws(
  () => scoreOperationBindingCandidate({
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.ineligible",
    eligible: false,
    metrics,
    weights,
  }),
  (error) => error instanceof OperationBindingScoringError && error.code === "operation_binding_scoring_candidate_ineligible",
);

assert.throws(
  () => scoreOperationBindingCandidate({
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.invalid",
    eligible: true,
    metrics: { ...metrics, reliability: 1.1 },
    weights,
  }),
  (error) => error.code === "operation_binding_scoring_metric_out_of_range",
);

{
  const candidates = [
    { binding_id: "22222222-2222-4222-8222-222222222222", binding_key: "binding.beta", eligible: true, metrics },
    { binding_id: "11111111-1111-4111-8111-111111111111", binding_key: "binding.alpha", eligible: true, metrics },
  ];
  const report = scoreOperationBindingCandidates({ candidates, weights });
  assert.deepEqual(report.candidate_scores.map((entry) => entry.binding_key), ["binding.alpha", "binding.beta"]);
  assert.equal(report.candidate_selected, false);
  assert.equal(report.selection_authorized, false);
  assert.equal(report.fallback_performed, false);
}

console.log("operation binding scoring contract tests passed");
