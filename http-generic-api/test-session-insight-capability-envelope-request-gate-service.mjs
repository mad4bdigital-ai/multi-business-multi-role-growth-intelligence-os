import assert from "node:assert/strict";
import {
  createSessionInsightCapabilityEnvelopeRequestGate,
  listSessionInsightCapabilityEnvelopeRequestGates,
} from "./sessionInsightCapabilityEnvelopeRequestGateService.js";

function makePool() {
  const state = { calls: [], insert: null, gate: null };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT p.* FROM session_insight_capability_envelope_plans")) {
        return [[{
          capability_plan_id: "capability_plan_1",
          payload_preview_id: "payload_preview_1",
          apply_request_id: "promo_apply_req_1",
          promotion_id: "promo_1",
          insight_id: "ins_1",
          target_surface: "development_backlog",
          promotion_type: "development_backlog_item",
          adapter_key: "session_insight.development_backlog.skeleton_adapter",
          contract_key: "session_insight.development_backlog.dry_run_contract.v1",
          plan_status: "planned_not_requested",
          gate_status: "ready_but_blocked_requires_capability_envelope_and_apply_adapter",
          capability_key: "session_insight_development_backlog_apply",
          operation_intent: "development_backlog_item",
          runtime_surface: "development_backlog",
          actual_capability_envelope_requested: 0,
          actual_capability_envelope_id: null,
          execution_allowed: 0,
          target_write_allowed: 0,
          plan_json: JSON.stringify({ app_key: "session_insight", workspace_key: "workspace-1", secrets_included: false }),
          safety_contract_json: JSON.stringify({ capability_plan_only: true, secrets_included: false }),
          secrets_included: 0,
        }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_request_gates")) {
        assert(compact.includes("'request_gate_created_requires_review'"), "request gate must require review");
        assert(compact.includes("0, NULL, 0, 0, 0"), "request gate must not request envelope or allow execution/target write");
        const requestPayload = JSON.parse(params[11]);
        const safety = JSON.parse(params[12]);
        assert.equal(requestPayload.capability_key, "session_insight_development_backlog_apply");
        assert.equal(requestPayload.actual_capability_envelope_requested, false);
        assert.equal(requestPayload.approval_hold_created, false);
        assert.equal(requestPayload.execution_allowed, false);
        assert.equal(requestPayload.target_write_allowed, false);
        assert.equal(safety.request_gate_only, true);
        assert.equal(safety.request_review_required, true);
        assert.equal(safety.actual_capability_envelope_requested, false);
        assert.equal(safety.approval_hold_created, false);
        assert.equal(safety.adapter_apply_executed, false);
        assert.equal(safety.provider_call_executed, false);
        assert.equal(safety.secrets_included, false);
        state.gate = {
          request_gate_id: params[0],
          capability_plan_id: params[1],
          payload_preview_id: params[2],
          apply_request_id: params[3],
          promotion_id: params[4],
          insight_id: params[5],
          target_surface: params[6],
          promotion_type: params[7],
          capability_key: params[8],
          operation_intent: params[9],
          runtime_surface: params[10],
          request_gate_status: "request_gate_created_requires_review",
          request_review_status: "request_review_required",
          request_policy_status: "blocked_until_request_gate_approved",
          actual_capability_envelope_requested: 0,
          actual_capability_envelope_id: null,
          approval_hold_created: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          request_payload_json: params[11],
          safety_contract_json: params[12],
          created_by: params[13],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_request_gates WHERE request_gate_id")) {
        return [[{ ...state.gate }]];
      }
      if (compact.startsWith("SELECT g.* FROM session_insight_capability_envelope_request_gates")) {
        return [[{ ...state.gate }]];
      }
      if (compact.startsWith("SELECT request_gate_status")) {
        return [[{
          request_gate_status: "request_gate_created_requires_review",
          request_review_status: "request_review_required",
          request_policy_status: "blocked_until_request_gate_approved",
          actual_capability_envelope_requested: 0,
          approval_hold_created: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
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
  const result = await createSessionInsightCapabilityEnvelopeRequestGate({
    pool,
    input: { capability_plan_id: "capability_plan_1", created_by: "gpt_admin" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.request_gate.capability_plan_id, "capability_plan_1");
  assert.equal(result.request_gate.request_gate_status, "request_gate_created_requires_review");
  assert.equal(result.request_gate.request_review_status, "request_review_required");
  assert.equal(result.request_gate.actual_capability_envelope_requested, false);
  assert.equal(result.request_gate.actual_capability_envelope_id, null);
  assert.equal(result.request_gate.approval_hold_created, false);
  assert.equal(result.request_gate.execution_allowed, false);
  assert.equal(result.request_gate.target_write_allowed, false);
  assert.equal(result.safety_contract.request_gate_only, true);
  assert.equal(result.safety_contract.approval_hold_created, false);
  assert.equal(result.safety_contract.adapter_apply_executed, false);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await createSessionInsightCapabilityEnvelopeRequestGate({ pool, input: { capability_plan_id: "capability_plan_1" } });
  const result = await listSessionInsightCapabilityEnvelopeRequestGates({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.request_gates[0].actual_capability_envelope_requested, false);
  assert.equal(result.request_gates[0].approval_hold_created, false);
  assert.equal(result.request_gates[0].execution_allowed, false);
  assert.equal(result.request_gates[0].target_write_allowed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.request_gate_policy.creates_actual_capability_envelope, false);
  assert.equal(result.request_gate_policy.creates_approval_hold, false);
  assert.equal(result.request_gate_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeRequestGate({ pool, input: {} }),
    /capability_plan_id is required/
  );
}

console.log("session insight capability envelope request gate service tests passed");
