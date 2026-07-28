import assert from "node:assert/strict";
import {
  OperationBindingResolverExplainError,
  buildOperationBindingResolverExplain,
} from "./operationBindingResolverExplain.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const HASH_E = "e".repeat(64);

function evidence(overrides = {}) {
  return {
    binding_id: "11111111-1111-4111-8111-111111111111",
    binding_key: "binding.primary",
    binding_scope_type: "resource",
    provider_family: "github",
    eligible: true,
    selected: true,
    exclusion_reasons: [],
    rank: [4, 2, 1, 200, 0, 0.91],
    score: 0.91,
    revision_hash: HASH_B,
    ...overrides,
  };
}

function explainInput(overrides = {}) {
  const primary = evidence();
  const fallback = evidence({
    binding_id: "22222222-2222-4222-8222-222222222222",
    binding_key: "binding.fallback",
    binding_scope_type: "workspace",
    selected: false,
    rank: [3, 2, 1, 150, -1, 0.88],
    score: 0.88,
    revision_hash: HASH_C,
  });
  const overflow = evidence({
    binding_id: "33333333-3333-4333-8333-333333333333",
    binding_key: "binding.overflow",
    binding_scope_type: "tenant",
    selected: false,
    rank: [2, 2, 1, 100, -2, 0.85],
    score: 0.85,
    revision_hash: HASH_D,
  });
  const excluded = evidence({
    binding_id: "44444444-4444-4444-8444-444444444444",
    binding_key: "binding.excluded",
    binding_scope_type: "platform",
    provider_family: null,
    eligible: false,
    selected: false,
    exclusion_reasons: ["adapter_kill_switch_enabled", "policy_denied"],
    rank: null,
    score: null,
    revision_hash: HASH_E,
  });
  return {
    operation_key: "repo.change.preview",
    operation_version: 1,
    source_revision_hash: HASH_A,
    kill_switch_policy_hash: HASH_B,
    selected_binding_id: primary.binding_id,
    fallback_binding_ids: [fallback.binding_id],
    overflow_binding_ids: [overflow.binding_id],
    typed_exclusions: [
      { binding_id: overflow.binding_id, binding_key: overflow.binding_key, exclusion_type: "fallback_limit", reason_codes: ["fallback_limit_exceeded"] },
      { binding_id: excluded.binding_id, binding_key: excluded.binding_key, exclusion_type: "hard_constraint", reason_codes: ["adapter_kill_switch_enabled", "policy_denied"] },
    ],
    candidate_evidence: [excluded, overflow, fallback, primary],
    ...overrides,
  };
}

{
  const forward = buildOperationBindingResolverExplain(explainInput());
  const reverseInput = explainInput();
  reverseInput.candidate_evidence.reverse();
  reverseInput.typed_exclusions.reverse();
  const reverse = buildOperationBindingResolverExplain(reverseInput);
  assert.equal(forward.explain_hash, reverse.explain_hash);
  assert.equal(forward.selected_binding_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(forward.summary.disposition_counts.selected, 1);
  assert.equal(forward.summary.disposition_counts.fallback, 1);
  assert.equal(forward.summary.disposition_counts.overflow, 1);
  assert.equal(forward.summary.disposition_counts.excluded, 1);
  assert.equal(forward.explanation_only, true);
  assert.equal(forward.selection_authorized, false);
  assert.equal(forward.dispatch_authorized, false);
  assert.equal(forward.authority_created, false);
}

{
  const report = buildOperationBindingResolverExplain(explainInput());
  const selected = report.candidate_evidence.find((candidate) => candidate.disposition === "selected");
  const fallback = report.candidate_evidence.find((candidate) => candidate.disposition === "fallback");
  const overflow = report.candidate_evidence.find((candidate) => candidate.disposition === "overflow");
  const excluded = report.candidate_evidence.find((candidate) => candidate.disposition === "excluded");
  assert.deepEqual(selected.decision_reason_codes, ["hard_constraints_satisfied", "highest_effective_rank"]);
  assert.equal(selected.rank_dimensions.scope_specificity, 4);
  assert.equal(selected.rank_dimensions.priority, 200);
  assert.equal(selected.rank_dimensions.score, 0.91);
  assert.equal(fallback.fallback_position, 1);
  assert.deepEqual(fallback.decision_reason_codes, ["eligible_ordered_fallback"]);
  assert.equal(overflow.typed_exclusion_type, "fallback_limit");
  assert.deepEqual(overflow.decision_reason_codes, ["fallback_limit_exceeded"]);
  assert.equal(excluded.typed_exclusion_type, "hard_constraint");
  assert.deepEqual(excluded.decision_reason_codes, ["adapter_kill_switch_enabled", "policy_denied"]);
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes("scope_ref"));
  assert.ok(!serialized.includes("metrics"));
  assert.equal(report.credential_payloads_read, false);
  assert.ok(!serialized.includes("access_token"));
  assert.ok(!serialized.includes("refresh_token"));
  assert.ok(!serialized.includes("authorization"));
}

assert.throws(
  () => buildOperationBindingResolverExplain(explainInput({
    candidate_evidence: explainInput().candidate_evidence.map((candidate) => ({ ...candidate, selected: false })),
  })),
  (error) => error instanceof OperationBindingResolverExplainError && error.code === "operation_binding_explain_selected_candidate_invalid",
);

assert.throws(
  () => buildOperationBindingResolverExplain(explainInput({ fallback_binding_ids: ["33333333-3333-4333-8333-333333333333"] })),
  (error) => error.code === "operation_binding_explain_disposition_overlap",
);

console.log("operation binding resolver explain tests passed");
