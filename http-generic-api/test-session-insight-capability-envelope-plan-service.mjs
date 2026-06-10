import assert from "node:assert/strict";
import {
  createSessionInsightCapabilityEnvelopePlan,
  listSessionInsightCapabilityEnvelopePlans,
} from "./sessionInsightCapabilityEnvelopePlanService.js";

function makePool() {
  const state = { calls: [], insert: null, plan: null };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT * FROM v_session_insight_adapter_apply_readiness_gate")) {
        return [[{
          payload_preview_id: "payload_preview_1",
          apply_request_id: "promo_apply_req_1",
          promotion_id: "promo_1",
          insight_id: "ins_1",
          promotion_type: "development_backlog_item",
          target_surface: "development_backlog",
          adapter_key: "session_insight.development_backlog.skeleton_adapter",
          contract_key: "session_insight.development_backlog.dry_run_contract.v1",
          gate_status: "ready_but_blocked_requires_capability_envelope_and_apply_adapter",
          promotion_allowed: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          readiness_evidence_json: JSON.stringify({ workspace_key: "workspace-1", secrets_included: false }),
          secrets_included: 0,
        }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_plans")) {
        assert(compact.includes("'planned_not_requested'"), "plan insert must be planned_not_requested");
        assert(compact.includes("0, NULL, 0, 0"), "plan insert must not request envelope or allow execution/target writes");
        const plan = JSON.parse(params[13]);
        const safety = JSON.parse(params[14]);
        assert.equal(plan.capability_key, "session_insight_development_backlog_apply");
        assert.equal(plan.operation_intent, "development_backlog_item");
        assert.equal(plan.runtime_surface, "development_backlog");
        assert.equal(plan.actual_capability_envelope_requested, false);
        assert.equal(plan.execution_allowed, false);
        assert.equal(plan.target_write_allowed, false);
        assert.equal(safety.capability_plan_only, true);
        assert.equal(safety.actual_capability_envelope_requested, false);
        assert.equal(safety.approval_hold_created, false);
        assert.equal(safety.adapter_apply_executed, false);
        assert.equal(safety.provider_call_executed, false);
        assert.equal(safety.secrets_included, false);
        state.plan = {
          capability_plan_id: params[0],
          payload_preview_id: params[1],
          apply_request_id: params[2],
          promotion_id: params[3],
          insight_id: params[4],
          target_surface: params[5],
          promotion_type: params[6],
          adapter_key: params[7],
          contract_key: params[8],
          plan_status: "planned_not_requested",
          gate_status: params[9],
          capability_key: params[10],
          operation_intent: params[11],
          runtime_surface: params[12],
          actual_capability_envelope_requested: 0,
          actual_capability_envelope_id: null,
          execution_allowed: 0,
          target_write_allowed: 0,
          plan_json: params[13],
          safety_contract_json: params[14],
          created_by: params[15],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_plans WHERE capability_plan_id")) {
        return [[{ ...state.plan }]];
      }
      if (compact.startsWith("SELECT p.* FROM session_insight_capability_envelope_plans")) {
        return [[{ ...state.plan }]];
      }
      if (compact.startsWith("SELECT plan_status")) {
        return [[{
          plan_status: "planned_not_requested",
          target_surface: "development_backlog",
          actual_capability_envelope_requested: 0,
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
  const result = await createSessionInsightCapabilityEnvelopePlan({
    pool,
    input: { payload_preview_id: "payload_preview_1", created_by: "gpt_admin" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.capability_plan.payload_preview_id, "payload_preview_1");
  assert.equal(result.capability_plan.plan_status, "planned_not_requested");
  assert.equal(result.capability_plan.capability_key, "session_insight_development_backlog_apply");
  assert.equal(result.capability_plan.actual_capability_envelope_requested, false);
  assert.equal(result.capability_plan.actual_capability_envelope_id, null);
  assert.equal(result.capability_plan.execution_allowed, false);
  assert.equal(result.capability_plan.target_write_allowed, false);
  assert.equal(result.safety_contract.capability_plan_only, true);
  assert.equal(result.safety_contract.actual_capability_envelope_requested, false);
  assert.equal(result.safety_contract.adapter_apply_executed, false);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await createSessionInsightCapabilityEnvelopePlan({ pool, input: { apply_request_id: "promo_apply_req_1" } });
  const result = await listSessionInsightCapabilityEnvelopePlans({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.capability_plans[0].actual_capability_envelope_requested, false);
  assert.equal(result.capability_plans[0].execution_allowed, false);
  assert.equal(result.capability_plans[0].target_write_allowed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.plan_policy.plan_only, true);
  assert.equal(result.plan_policy.actual_capability_envelope_requested, false);
  assert.equal(result.plan_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopePlan({ pool, input: {} }),
    /payload_preview_id or apply_request_id is required/
  );
}

console.log("session insight capability envelope plan service tests passed");
