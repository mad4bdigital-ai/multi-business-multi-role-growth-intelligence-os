import assert from "node:assert/strict";
import {
  OperationBindingFallbackError,
  buildOperationBindingFallbackPlan,
  compareOperationBindingRank,
  sameOperationBindingRank,
} from "./operationBindingFallback.js";

function eligible(bindingId, bindingKey, rank, score = 0.5) {
  return {
    binding_id: bindingId,
    binding_key: bindingKey,
    eligible: true,
    rank,
    score,
    exclusion_reasons: [],
  };
}

function excluded(bindingId, bindingKey, reasons) {
  return {
    binding_id: bindingId,
    binding_key: bindingKey,
    eligible: false,
    rank: null,
    score: null,
    exclusion_reasons: reasons,
  };
}

const primary = eligible("11111111-1111-4111-8111-111111111111", "binding.primary", [4, 2, 1, 100, 0, 0.9], 0.9);
const firstFallback = eligible("22222222-2222-4222-8222-222222222222", "binding.fallback.first", [3, 2, 1, 100, 0, 0.95], 0.95);
const overflow = eligible("33333333-3333-4333-8333-333333333333", "binding.fallback.overflow", [2, 2, 1, 100, 0, 1], 1);
const hardExcluded = excluded("44444444-4444-4444-8444-444444444444", "binding.excluded", ["policy_denied", "credential_not_ready"]);

{
  const forward = buildOperationBindingFallbackPlan({ candidates: [overflow, hardExcluded, primary, firstFallback], max_fallbacks: 1 });
  const reverse = buildOperationBindingFallbackPlan({ candidates: [firstFallback, primary, hardExcluded, overflow], max_fallbacks: 1 });
  assert.equal(forward.report_hash, reverse.report_hash);
  assert.equal(forward.primary_binding_id, primary.binding_id);
  assert.deepEqual(forward.ordered_binding_ids, [primary.binding_id, firstFallback.binding_id, overflow.binding_id]);
  assert.deepEqual(forward.fallback_binding_ids, [firstFallback.binding_id]);
  assert.deepEqual(forward.overflow_binding_ids, [overflow.binding_id]);
  assert.equal(forward.summary.fallback_truncated, true);
  assert.equal(forward.fallback_executed, false);
  assert.equal(forward.dispatch_authorized, false);
  assert.equal(forward.authority_created, false);
  const hard = forward.typed_exclusions.find((entry) => entry.binding_id === hardExcluded.binding_id);
  assert.equal(hard.exclusion_type, "hard_constraint");
  assert.deepEqual(hard.reason_codes, ["credential_not_ready", "policy_denied"]);
  const bounded = forward.typed_exclusions.find((entry) => entry.binding_id === overflow.binding_id);
  assert.equal(bounded.exclusion_type, "fallback_limit");
  assert.deepEqual(bounded.reason_codes, ["fallback_limit_exceeded"]);
}

{
  const plan = buildOperationBindingFallbackPlan({ candidates: [hardExcluded], max_fallbacks: 25 });
  assert.equal(plan.primary_binding_id, null);
  assert.deepEqual(plan.ordered_binding_ids, []);
  assert.deepEqual(plan.fallback_binding_ids, []);
  assert.equal(plan.summary.hard_excluded_count, 1);
}

{
  const left = eligible("55555555-5555-4555-8555-555555555555", "binding.tie.alpha", [1, 1, 1], 0.5);
  const right = eligible("66666666-6666-4666-8666-666666666666", "binding.tie.beta", [1, 1, 1], 0.5);
  assert.equal(sameOperationBindingRank(left, right), true);
  assert.ok(compareOperationBindingRank(left, right) < 0);
  const plan = buildOperationBindingFallbackPlan({ candidates: [right, left], max_fallbacks: 1 });
  assert.deepEqual(plan.ordered_binding_ids, [left.binding_id, right.binding_id]);
}

assert.throws(
  () => buildOperationBindingFallbackPlan({ candidates: [primary, { ...primary, binding_key: "binding.duplicate" }] }),
  (error) => error instanceof OperationBindingFallbackError && error.code === "operation_binding_fallback_duplicate_id",
);

assert.throws(
  () => buildOperationBindingFallbackPlan({ candidates: [excluded("77777777-7777-4777-8777-777777777777", "binding.invalid", [])] }),
  (error) => error.code === "operation_binding_fallback_reason_codes_required",
);

assert.throws(
  () => buildOperationBindingFallbackPlan({ candidates: [primary], max_fallbacks: 101 }),
  (error) => error.code === "operation_binding_fallback_invalid_integer",
);

console.log("operation binding fallback contract tests passed");
