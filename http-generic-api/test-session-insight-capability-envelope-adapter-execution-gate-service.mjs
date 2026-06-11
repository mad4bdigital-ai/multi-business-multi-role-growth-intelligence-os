import assert from "node:assert/strict";
import {
  createSessionInsightCapabilityEnvelopeAdapterExecutionGate,
  listSessionInsightCapabilityEnvelopeAdapterExecutionGates,
} from "./sessionInsightCapabilityEnvelopeAdapterExecutionGateService.js";

const REQUIRED_TYPED_CONFIRM = "OPEN_ADAPTER_EXECUTION_GATE_NO_APPLY";

function makePool() {
  const state = {
    calls: [],
    insert: null,
    gate: null,
    readback: {
      dispatch_readback_id: "dispatch_readback_1",
      approval_decision_id: "approval_decision_1",
      actual_request_id: "actual_request_1",
      actual_request_preflight_id: "actual_preflight_1",
      dispatch_dry_run_id: "dispatch_dry_run_1",
      request_gate_id: "request_gate_1",
      capability_plan_id: "capability_plan_1",
      promotion_id: "promo_1",
      insight_id: "ins_1",
      capability_key: "session_insight_development_backlog_apply",
      operation_intent: "development_backlog_item",
      runtime_surface: "development_backlog",
      actual_capability_envelope_id: "actual_envelope_1",
      dispatch_readback_status: "dispatch_readback_passed",
      dispatch_readback_policy_status: "ready_for_adapter_execution_gate",
      adapter_apply_executed: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      envelope_status: "ready_for_dispatch",
      envelope_decision: "ready_for_dispatch",
      readback_result_json: JSON.stringify({ valid_for_dispatch_readback: true, secrets_included: false }),
      secrets_included: 0,
      ledger_envelope_status: "ready_for_dispatch",
      ledger_decision: "ready_for_dispatch",
      ledger_dispatch_allowed: 1,
      ledger_blocking_gap_count: 0,
      ledger_secrets_included: 0,
    },
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT r.*, e.envelope_status")) {
        return [[{ ...state.readback }]];
      }
      if (compact.startsWith("SELECT COUNT(*) AS count FROM session_insight_capability_envelope_adapter_execution_gates")) {
        return [[{ count: state.gate ? 1 : 0 }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_adapter_execution_gates")) {
        assert(compact.includes("'adapter_execution_gate_ready'"), "gate must only mark gate-ready");
        assert(compact.includes("'ready_for_adapter_apply_dispatch'"), "gate must stage future adapter apply dispatch");
        assert(compact.includes("0, 0, 0, 0, 0"), "gate must not request/apply adapter, execute, target-write, or promote");
        const gateResult = JSON.parse(params[16]);
        const safety = JSON.parse(params[17]);
        assert.equal(params[14], REQUIRED_TYPED_CONFIRM);
        assert.equal(gateResult.valid_for_adapter_execution_gate, true);
        assert.equal(gateResult.adapter_apply_requested, false);
        assert.equal(gateResult.adapter_apply_executed, false);
        assert.equal(gateResult.execution_allowed, false);
        assert.equal(gateResult.target_write_allowed, false);
        assert.equal(gateResult.promotion_allowed, false);
        assert.equal(gateResult.secrets_included, false);
        assert.equal(safety.adapter_execution_gate_only, true);
        assert.equal(safety.adapter_apply_dispatch_not_implemented, true);
        assert.equal(safety.adapter_apply_requested, false);
        assert.equal(safety.adapter_apply_executed, false);
        assert.equal(safety.execution_allowed, false);
        assert.equal(safety.target_write_allowed, false);
        assert.equal(safety.secrets_included, false);
        state.gate = {
          adapter_execution_gate_id: params[0],
          dispatch_readback_id: params[1],
          approval_decision_id: params[2],
          actual_request_id: params[3],
          actual_request_preflight_id: params[4],
          dispatch_dry_run_id: params[5],
          request_gate_id: params[6],
          capability_plan_id: params[7],
          promotion_id: params[8],
          insight_id: params[9],
          capability_key: params[10],
          operation_intent: params[11],
          runtime_surface: params[12],
          actual_capability_envelope_id: params[13],
          adapter_execution_gate_status: "adapter_execution_gate_ready",
          adapter_execution_policy_status: "ready_for_adapter_apply_dispatch",
          typed_confirm: params[14],
          adapter_apply_requested: 0,
          adapter_apply_executed: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          promotion_allowed: 0,
          source_dispatch_readback_sha256: params[15],
          gate_result_json: params[16],
          safety_contract_json: params[17],
          created_by: params[18],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_adapter_execution_gates WHERE adapter_execution_gate_id")) {
        return [[{ ...state.gate }]];
      }
      if (compact.startsWith("SELECT g.* FROM session_insight_capability_envelope_adapter_execution_gates")) {
        return [[{ ...state.gate }]];
      }
      if (compact.startsWith("SELECT adapter_execution_gate_status")) {
        return [[{
          adapter_execution_gate_status: "adapter_execution_gate_ready",
          adapter_execution_policy_status: "ready_for_adapter_apply_dispatch",
          adapter_apply_requested: 0,
          adapter_apply_executed: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
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
  const result = await createSessionInsightCapabilityEnvelopeAdapterExecutionGate({
    pool,
    input: { dispatch_readback_id: "dispatch_readback_1", typed_confirm: REQUIRED_TYPED_CONFIRM, created_by: "gpt_admin" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.adapter_execution_gate.dispatch_readback_id, "dispatch_readback_1");
  assert.equal(result.adapter_execution_gate.adapter_execution_gate_status, "adapter_execution_gate_ready");
  assert.equal(result.adapter_execution_gate.adapter_execution_policy_status, "ready_for_adapter_apply_dispatch");
  assert.equal(result.adapter_execution_gate.adapter_apply_requested, false);
  assert.equal(result.adapter_execution_gate.adapter_apply_executed, false);
  assert.equal(result.adapter_execution_gate.execution_allowed, false);
  assert.equal(result.adapter_execution_gate.target_write_allowed, false);
  assert.equal(result.adapter_execution_gate.promotion_allowed, false);
  assert.equal(result.safety_contract.adapter_execution_gate_only, true);
  assert.equal(result.safety_contract.adapter_apply_dispatch_not_implemented, true);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await createSessionInsightCapabilityEnvelopeAdapterExecutionGate({ pool, input: { dispatch_readback_id: "dispatch_readback_1", typed_confirm: REQUIRED_TYPED_CONFIRM } });
  const result = await listSessionInsightCapabilityEnvelopeAdapterExecutionGates({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.adapter_execution_gates[0].adapter_apply_requested, false);
  assert.equal(result.adapter_execution_gates[0].adapter_apply_executed, false);
  assert.equal(result.adapter_execution_gates[0].execution_allowed, false);
  assert.equal(result.adapter_execution_gates[0].target_write_allowed, false);
  assert.equal(result.adapter_execution_gates[0].promotion_allowed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.adapter_execution_gate_policy.requires_typed_confirm, REQUIRED_TYPED_CONFIRM);
  assert.equal(result.adapter_execution_gate_policy.adapter_apply_dispatch_not_implemented, true);
  assert.equal(result.adapter_execution_gate_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeAdapterExecutionGate({ pool, input: { dispatch_readback_id: "dispatch_readback_1", typed_confirm: "WRONG" } }),
    /typed_confirm must equal OPEN_ADAPTER_EXECUTION_GATE_NO_APPLY/
  );
}

{
  const pool = makePool();
  pool.state.readback.dispatch_readback_status = "dispatch_readback_blocked";
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeAdapterExecutionGate({ pool, input: { dispatch_readback_id: "dispatch_readback_1", typed_confirm: REQUIRED_TYPED_CONFIRM } }),
    /adapter execution gate validation failed/
  );
}

console.log("session insight capability envelope adapter execution gate service tests passed");
