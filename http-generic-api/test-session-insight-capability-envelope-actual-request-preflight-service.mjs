import assert from "node:assert/strict";
import {
  createSessionInsightCapabilityEnvelopeActualRequestPreflight,
  listSessionInsightCapabilityEnvelopeActualRequestPreflights,
} from "./sessionInsightCapabilityEnvelopeActualRequestPreflightService.js";

function makePool() {
  const state = {
    calls: [],
    insert: null,
    preflight: null,
    dispatch: {
      dispatch_dry_run_id: "capability_dispatch_dry_run_1",
      request_gate_id: "capability_request_gate_1",
      capability_plan_id: "capability_plan_1",
      payload_preview_id: "payload_preview_1",
      apply_request_id: "promo_apply_req_1",
      promotion_id: "promo_1",
      insight_id: "ins_1",
      target_surface: "development_backlog",
      promotion_type: "development_backlog_item",
      capability_key: "session_insight_development_backlog_apply",
      operation_intent: "development_backlog_item",
      runtime_surface: "development_backlog",
      dispatch_status: "dispatch_dry_run_generated",
      dispatch_mode: "dry_run_no_dispatch",
      dispatch_review_status: "dispatch_dry_run_approved",
      dispatch_policy_status: "dispatch_dry_run_approved_but_not_dispatched",
      request_review_status: "request_approved",
      request_policy_status: "request_approved_but_not_dispatched",
      promotion_decision_status: "approved",
      promotion_approval_status: "approved",
      promotion_status: "ready",
      promotion_allowed: 0,
      actual_capability_envelope_requested: 0,
      actual_capability_envelope_id: null,
      approval_hold_created: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      dispatch_payload_json: JSON.stringify({
        dry_run_only: true,
        dispatch_not_called: true,
        app_key: "session_insight",
        actual_capability_envelope_requested: false,
        approval_hold_created: false,
        adapter_apply_executed: false,
        execution_allowed: false,
        target_write_allowed: false,
        secrets_included: false,
      }),
      validation_result_json: JSON.stringify({ valid_for_dispatch_dry_run: true, secrets_included: false }),
      safety_contract_json: JSON.stringify({ dispatch_dry_run_only: true, secrets_included: false }),
      created_by: "gpt_admin",
      reviewed_by: "gpt_admin",
      reviewed_at: "2026-06-11T00:00:00Z",
      secrets_included: 0,
      request_gate_secrets_included: 0,
      promotion_secrets_included: 0,
    },
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT d.*, g.request_review_status")) {
        return [[{ ...state.dispatch }]];
      }
      if (compact.startsWith("SELECT COUNT(*) AS count FROM capability_resolution_envelope_ledger")) {
        return [[{ count: 0 }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_actual_request_preflights")) {
        assert(compact.includes("'actual_request_preflight_passed'"), "preflight status must pass only after validation");
        assert(compact.includes("'ready_for_actual_capability_envelope_request'"), "preflight policy must be ready only after validation");
        assert(compact.includes("0, NULL, 0, 0, 0"), "preflight insert must not request envelope, approval hold, execution, or target writes");
        const result = JSON.parse(params[16]);
        const safety = JSON.parse(params[17]);
        assert.equal(result.valid_for_actual_request_preflight, true);
        assert.equal(result.actual_capability_envelope_requested, false);
        assert.equal(result.approval_hold_created, false);
        assert.equal(result.adapter_apply_executed, false);
        assert.equal(result.execution_allowed, false);
        assert.equal(result.target_write_allowed, false);
        assert.equal(result.secrets_included, false);
        assert.equal(safety.actual_request_preflight_only, true);
        assert.equal(safety.calls_capability_resolution, false);
        assert.equal(safety.provider_call_executed, false);
        assert.equal(safety.external_write_executed, false);
        assert.equal(safety.secrets_included, false);
        state.preflight = {
          actual_request_preflight_id: params[0],
          dispatch_dry_run_id: params[1],
          request_gate_id: params[2],
          capability_plan_id: params[3],
          payload_preview_id: params[4],
          apply_request_id: params[5],
          promotion_id: params[6],
          insight_id: params[7],
          target_surface: params[8],
          promotion_type: params[9],
          capability_key: params[10],
          operation_intent: params[11],
          runtime_surface: params[12],
          preflight_status: "actual_request_preflight_passed",
          preflight_policy_status: "ready_for_actual_capability_envelope_request",
          actual_capability_envelope_requested: 0,
          actual_capability_envelope_id: null,
          approval_hold_created: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          source_dispatch_payload_sha256: params[13],
          source_validation_sha256: params[14],
          duplicate_live_envelope_count: params[15],
          preflight_result_json: params[16],
          safety_contract_json: params[17],
          created_by: params[18],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_actual_request_preflights WHERE actual_request_preflight_id")) {
        return [[{ ...state.preflight }]];
      }
      if (compact.startsWith("SELECT p.* FROM session_insight_capability_envelope_actual_request_preflights")) {
        return [[{ ...state.preflight }]];
      }
      if (compact.startsWith("SELECT preflight_status")) {
        return [[{
          preflight_status: "actual_request_preflight_passed",
          preflight_policy_status: "ready_for_actual_capability_envelope_request",
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
  const result = await createSessionInsightCapabilityEnvelopeActualRequestPreflight({
    pool,
    input: { dispatch_dry_run_id: "capability_dispatch_dry_run_1", created_by: "gpt_admin" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.actual_request_preflight.dispatch_dry_run_id, "capability_dispatch_dry_run_1");
  assert.equal(result.actual_request_preflight.preflight_status, "actual_request_preflight_passed");
  assert.equal(result.actual_request_preflight.preflight_policy_status, "ready_for_actual_capability_envelope_request");
  assert.equal(result.actual_request_preflight.actual_capability_envelope_requested, false);
  assert.equal(result.actual_request_preflight.actual_capability_envelope_id, null);
  assert.equal(result.actual_request_preflight.approval_hold_created, false);
  assert.equal(result.actual_request_preflight.execution_allowed, false);
  assert.equal(result.actual_request_preflight.target_write_allowed, false);
  assert.equal(result.actual_request_preflight.preflight_result_json.valid_for_actual_request_preflight, true);
  assert.equal(result.safety_contract.actual_request_preflight_only, true);
  assert.equal(result.safety_contract.calls_capability_resolution, false);
  assert.equal(result.safety_contract.provider_call_executed, false);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await createSessionInsightCapabilityEnvelopeActualRequestPreflight({ pool, input: { dispatch_dry_run_id: "capability_dispatch_dry_run_1" } });
  const result = await listSessionInsightCapabilityEnvelopeActualRequestPreflights({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.actual_request_preflights[0].actual_capability_envelope_requested, false);
  assert.equal(result.actual_request_preflights[0].approval_hold_created, false);
  assert.equal(result.actual_request_preflights[0].execution_allowed, false);
  assert.equal(result.actual_request_preflights[0].target_write_allowed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.actual_request_preflight_policy.preflight_only, true);
  assert.equal(result.actual_request_preflight_policy.calls_capability_resolution, false);
  assert.equal(result.actual_request_preflight_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeActualRequestPreflight({ pool, input: {} }),
    /dispatch_dry_run_id is required/
  );
}

{
  const pool = makePool();
  pool.state.dispatch.dispatch_review_status = "dispatch_dry_run_review_required";
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeActualRequestPreflight({ pool, input: { dispatch_dry_run_id: "capability_dispatch_dry_run_1" } }),
    /actual capability envelope request preflight failed/
  );
}

console.log("session insight capability envelope actual request preflight service tests passed");
