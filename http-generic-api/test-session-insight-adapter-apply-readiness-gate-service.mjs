import assert from "node:assert/strict";
import { listSessionInsightAdapterApplyReadinessGate } from "./sessionInsightAdapterApplyReadinessGateService.js";

function makePool() {
  const state = { calls: [] };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT g.* FROM v_session_insight_adapter_apply_readiness_gate")) {
        assert(compact.includes("g.secrets_included = 0"), "gate list must exclude secret flagged rows");
        return [[{
          payload_preview_id: "payload_preview_1",
          apply_request_id: "promo_apply_req_1",
          promotion_id: "promo_1",
          insight_id: "ins_1",
          promotion_type: "development_backlog_item",
          target_surface: "development_backlog",
          adapter_key: "session_insight.development_backlog.skeleton_adapter",
          contract_key: "session_insight.development_backlog.dry_run_contract.v1",
          promotion_approval_status: "approved",
          promotion_status: "ready",
          payload_review_status: "approved",
          payload_decision_status: "approved",
          request_status: "blocked_requires_capability_envelope",
          adapter_implementation_status: "skeleton",
          capability_envelope_required: 1,
          capability_envelope_id: null,
          target_adapter_key: null,
          promotion_allowed: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          adapter_apply_supported: 0,
          contract_apply_supported: 0,
          contract_execution_allowed: 0,
          valid_for_dry_run_contract: 1,
          gate_status: "ready_but_blocked_requires_capability_envelope_and_apply_adapter",
          blockers_json: JSON.stringify([
            "capability_envelope_required_before_apply",
            "target_adapter_apply_implementation_required",
            "promotion_allowed_must_remain_false_in_readiness_gate",
          ]),
          readiness_evidence_json: JSON.stringify({
            payload_approved: true,
            promotion_approved: true,
            adapter_skeleton: true,
            capability_envelope_required: true,
            promotion_allowed: false,
            execution_allowed: false,
            target_write_allowed: false,
            adapter_apply_executed: false,
            secrets_included: false,
          }),
          secrets_included: 0,
        }]];
      }
      if (compact.startsWith("SELECT gate_status")) {
        return [[{
          gate_status: "ready_but_blocked_requires_capability_envelope_and_apply_adapter",
          target_surface: "development_backlog",
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
  const result = await listSessionInsightAdapterApplyReadinessGate({
    pool,
    filters: { limit: 5, target_surface: "development_backlog" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  const gate = result.gates[0];
  assert.equal(gate.gate_status, "ready_but_blocked_requires_capability_envelope_and_apply_adapter");
  assert.equal(gate.promotion_allowed, false);
  assert.equal(gate.execution_allowed, false);
  assert.equal(gate.target_write_allowed, false);
  assert.equal(gate.adapter_apply_supported, false);
  assert.equal(gate.contract_apply_supported, false);
  assert.equal(gate.contract_execution_allowed, false);
  assert.equal(gate.valid_for_dry_run_contract, true);
  assert(gate.blockers.includes("target_adapter_apply_implementation_required"));
  assert.equal(gate.readiness_evidence.adapter_apply_executed, false);
  assert.equal(gate.readiness_evidence.secrets_included, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.gate_policy.read_only_gate, true);
  assert.equal(result.gate_policy.adapter_apply_executed, false);
  assert.equal(result.gate_policy.approval_sets_execution_allowed, false);
  assert.equal(result.gate_policy.approval_sets_target_write_allowed, false);
  assert.equal(result.gate_policy.secrets_included, false);
}

console.log("session insight adapter apply readiness gate service tests passed");
