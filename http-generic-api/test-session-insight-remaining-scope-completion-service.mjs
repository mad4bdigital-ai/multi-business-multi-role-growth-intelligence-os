import assert from "node:assert/strict";
import {
  createSessionInsightRemainingScopeCompletion,
  listSessionInsightRemainingScopeCompletions,
} from "./sessionInsightRemainingScopeCompletionService.js";

const REQUIRED_TYPED_CONFIRM = "COMPLETE_REMAINING_SCOPE_AS_GATED_NO_EXECUTION";

function makePool() {
  const state = {
    insert: null,
    completion: null,
    gate: {
      adapter_execution_gate_id: "adapter_gate_1",
      dispatch_readback_id: "dispatch_readback_1",
      approval_decision_id: "approval_decision_1",
      actual_request_id: "actual_request_1",
      promotion_id: "promo_1",
      insight_id: "ins_1",
      capability_key: "session_insight_development_backlog_apply",
      operation_intent: "development_backlog_item",
      runtime_surface: "development_backlog",
      actual_capability_envelope_id: "actual_envelope_1",
      adapter_execution_gate_status: "adapter_execution_gate_ready",
      adapter_execution_policy_status: "ready_for_adapter_apply_dispatch",
      adapter_apply_requested: 0,
      adapter_apply_executed: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      promotion_allowed: 0,
      gate_result_json: JSON.stringify({ valid_for_adapter_execution_gate: true, secrets_included: false }),
      secrets_included: 0,
    },
  };
  return {
    state,
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT g.* FROM session_insight_capability_envelope_adapter_execution_gates")) {
        return [[{ ...state.gate }]];
      }
      if (compact.startsWith("SELECT COUNT(*) AS count FROM session_insight_capability_envelope_remaining_scope_completions")) {
        return [[{ count: state.completion ? 1 : 0 }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_remaining_scope_completions")) {
        assert(compact.includes("'remaining_scope_completed_as_gated_no_execution'"));
        assert(compact.includes("'all_remaining_stages_gated_no_execution'"));
        assert(compact.includes("0, 0, 0, 0, 0, 0"), "completion must not apply, execute, target-write, or promote");
        const result = JSON.parse(params[13]);
        const safety = JSON.parse(params[14]);
        assert.equal(params[11], REQUIRED_TYPED_CONFIRM);
        assert.equal(result.valid_for_remaining_scope_completion, true);
        assert.equal(result.adapter_apply_requested, false);
        assert.equal(result.adapter_apply_executed, false);
        assert.equal(result.execution_allowed, false);
        assert.equal(result.target_write_allowed, false);
        assert.equal(result.target_write_executed, false);
        assert.equal(result.promotion_allowed, false);
        assert.equal(result.secrets_included, false);
        assert.equal(safety.remaining_scope_completion_only, true);
        assert.equal(safety.adapter_apply_dispatch_gate_ready, true);
        assert.equal(safety.adapter_apply_dispatch_requested, false);
        assert.equal(safety.target_write_allowed, false);
        assert.equal(safety.target_write_executed, false);
        assert.equal(safety.rollback_plan_required_before_target_write, true);
        assert.equal(safety.ui_review_queue_ready_for_admin_surface, true);
        assert.equal(safety.orchestration_tests_ready_for_no_write_e2e, true);
        assert.equal(safety.secrets_included, false);
        state.completion = {
          remaining_scope_completion_id: params[0],
          adapter_execution_gate_id: params[1],
          dispatch_readback_id: params[2],
          approval_decision_id: params[3],
          actual_request_id: params[4],
          promotion_id: params[5],
          insight_id: params[6],
          capability_key: params[7],
          operation_intent: params[8],
          runtime_surface: params[9],
          actual_capability_envelope_id: params[10],
          completion_status: "remaining_scope_completed_as_gated_no_execution",
          completion_policy_status: "all_remaining_stages_gated_no_execution",
          typed_confirm: params[11],
          adapter_apply_dispatch_gate_status: "ready_but_not_requested",
          adapter_apply_readback_status: "blocked_until_adapter_apply_dispatch",
          target_write_gate_status: "blocked_until_adapter_apply_readback",
          target_write_readback_status: "blocked_until_target_write",
          rollback_plan_status: "required_before_target_write",
          generalized_registry_status: "ready_for_multi_target_extension",
          ui_review_queue_status: "ready_for_admin_queue_surface",
          orchestration_test_status: "ready_for_e2e_no_write_tests",
          adapter_apply_requested: 0,
          adapter_apply_executed: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          target_write_executed: 0,
          promotion_allowed: 0,
          source_adapter_execution_gate_sha256: params[12],
          completion_result_json: params[13],
          safety_contract_json: params[14],
          created_by: params[15],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_remaining_scope_completions WHERE remaining_scope_completion_id")) {
        return [[{ ...state.completion }]];
      }
      if (compact.startsWith("SELECT c.* FROM session_insight_capability_envelope_remaining_scope_completions")) {
        return [[{ ...state.completion }]];
      }
      if (compact.startsWith("SELECT completion_status")) {
        return [[{
          completion_status: "remaining_scope_completed_as_gated_no_execution",
          completion_policy_status: "all_remaining_stages_gated_no_execution",
          adapter_apply_requested: 0,
          adapter_apply_executed: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          target_write_executed: 0,
          promotion_allowed: 0,
          count: 1,
        }]];
      }
      if (compact.startsWith("SELECT issue_code")) {
        return [[]];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await createSessionInsightRemainingScopeCompletion({
    pool,
    input: { adapter_execution_gate_id: "adapter_gate_1", typed_confirm: REQUIRED_TYPED_CONFIRM, created_by: "gpt_admin" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.remaining_scope_completion.completion_status, "remaining_scope_completed_as_gated_no_execution");
  assert.equal(result.remaining_scope_completion.adapter_apply_dispatch_gate_status, "ready_but_not_requested");
  assert.equal(result.remaining_scope_completion.adapter_apply_executed, false);
  assert.equal(result.remaining_scope_completion.target_write_allowed, false);
  assert.equal(result.remaining_scope_completion.target_write_executed, false);
  assert.equal(result.remaining_scope_completion.promotion_allowed, false);
  assert.equal(result.safety_contract.remaining_scope_completion_only, true);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await createSessionInsightRemainingScopeCompletion({ pool, input: { adapter_execution_gate_id: "adapter_gate_1", typed_confirm: REQUIRED_TYPED_CONFIRM } });
  const result = await listSessionInsightRemainingScopeCompletions({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.remaining_scope_completions[0].adapter_apply_requested, false);
  assert.equal(result.remaining_scope_completions[0].adapter_apply_executed, false);
  assert.equal(result.remaining_scope_completions[0].target_write_allowed, false);
  assert.equal(result.remaining_scope_completions[0].target_write_executed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.remaining_scope_policy.requires_typed_confirm, REQUIRED_TYPED_CONFIRM);
  assert.equal(result.remaining_scope_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightRemainingScopeCompletion({ pool, input: { adapter_execution_gate_id: "adapter_gate_1", typed_confirm: "WRONG" } }),
    /typed_confirm must equal COMPLETE_REMAINING_SCOPE_AS_GATED_NO_EXECUTION/
  );
}

{
  const pool = makePool();
  pool.state.gate.adapter_execution_gate_status = "adapter_execution_gate_blocked";
  await assert.rejects(
    () => createSessionInsightRemainingScopeCompletion({ pool, input: { adapter_execution_gate_id: "adapter_gate_1", typed_confirm: REQUIRED_TYPED_CONFIRM } }),
    /remaining scope completion validation failed/
  );
}

console.log("session insight remaining scope completion service tests passed");
