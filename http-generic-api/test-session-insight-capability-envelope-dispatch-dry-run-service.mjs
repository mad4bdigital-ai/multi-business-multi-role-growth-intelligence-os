import assert from "node:assert/strict";
import {
  createSessionInsightCapabilityEnvelopeDispatchDryRun,
  listSessionInsightCapabilityEnvelopeDispatchDryRuns,
} from "./sessionInsightCapabilityEnvelopeDispatchDryRunService.js";

function makePool() {
  const state = {
    calls: [],
    insert: null,
    dryRun: null,
    gate: {
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
      request_review_status: "request_approved",
      request_policy_status: "request_approved_but_not_dispatched",
      actual_capability_envelope_requested: 0,
      actual_capability_envelope_id: null,
      approval_hold_created: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      request_payload_json: JSON.stringify({
        mode: "platform_managed_fallback",
        app_key: "session_insight",
        workspace_key: "workspace-1",
        secrets_included: false,
      }),
      secrets_included: 0,
    },
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_request_gates")) {
        return [[{ ...state.gate }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_dispatch_dry_runs")) {
        assert(compact.includes("'dispatch_dry_run_generated'"), "dry run status must be generated");
        assert(compact.includes("'dry_run_no_dispatch'"), "dry run mode must avoid dispatch");
        assert(compact.includes("0, NULL, 0, 0, 0"), "dry run insert must not request envelope, approval hold, execution, or target writes");
        const payload = JSON.parse(params[12]);
        const validation = JSON.parse(params[13]);
        const safety = JSON.parse(params[14]);
        assert.equal(payload.dry_run_only, true);
        assert.equal(payload.dispatch_not_called, true);
        assert.equal(payload.actual_capability_envelope_requested, false);
        assert.equal(payload.actual_capability_envelope_id, null);
        assert.equal(payload.approval_hold_created, false);
        assert.equal(payload.adapter_apply_executed, false);
        assert.equal(payload.execution_allowed, false);
        assert.equal(payload.target_write_allowed, false);
        assert.equal(validation.valid_for_dispatch_dry_run, true);
        assert.equal(safety.dispatch_dry_run_only, true);
        assert.equal(safety.provider_call_executed, false);
        assert.equal(safety.external_write_executed, false);
        assert.equal(safety.secrets_included, false);
        state.dryRun = {
          dispatch_dry_run_id: params[0],
          request_gate_id: params[1],
          capability_plan_id: params[2],
          payload_preview_id: params[3],
          apply_request_id: params[4],
          promotion_id: params[5],
          insight_id: params[6],
          target_surface: params[7],
          promotion_type: params[8],
          capability_key: params[9],
          operation_intent: params[10],
          runtime_surface: params[11],
          dispatch_status: "dispatch_dry_run_generated",
          dispatch_mode: "dry_run_no_dispatch",
          actual_capability_envelope_requested: 0,
          actual_capability_envelope_id: null,
          approval_hold_created: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          dispatch_payload_json: params[12],
          validation_result_json: params[13],
          safety_contract_json: params[14],
          created_by: params[15],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_dispatch_dry_runs WHERE dispatch_dry_run_id")) {
        return [[{ ...state.dryRun }]];
      }
      if (compact.startsWith("SELECT d.* FROM session_insight_capability_envelope_dispatch_dry_runs")) {
        return [[{ ...state.dryRun }]];
      }
      if (compact.startsWith("SELECT dispatch_status")) {
        return [[{
          dispatch_status: "dispatch_dry_run_generated",
          dispatch_mode: "dry_run_no_dispatch",
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
  const result = await createSessionInsightCapabilityEnvelopeDispatchDryRun({
    pool,
    input: { request_gate_id: "capability_request_gate_1", created_by: "gpt_admin" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dispatch_dry_run.request_gate_id, "capability_request_gate_1");
  assert.equal(result.dispatch_dry_run.dispatch_status, "dispatch_dry_run_generated");
  assert.equal(result.dispatch_dry_run.dispatch_mode, "dry_run_no_dispatch");
  assert.equal(result.dispatch_dry_run.actual_capability_envelope_requested, false);
  assert.equal(result.dispatch_dry_run.actual_capability_envelope_id, null);
  assert.equal(result.dispatch_dry_run.approval_hold_created, false);
  assert.equal(result.dispatch_dry_run.execution_allowed, false);
  assert.equal(result.dispatch_dry_run.target_write_allowed, false);
  assert.equal(result.dispatch_dry_run.validation_result_json.valid_for_dispatch_dry_run, true);
  assert.equal(result.safety_contract.dispatch_dry_run_only, true);
  assert.equal(result.safety_contract.provider_call_executed, false);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await createSessionInsightCapabilityEnvelopeDispatchDryRun({ pool, input: { request_gate_id: "capability_request_gate_1" } });
  const result = await listSessionInsightCapabilityEnvelopeDispatchDryRuns({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.dispatch_dry_runs[0].actual_capability_envelope_requested, false);
  assert.equal(result.dispatch_dry_runs[0].approval_hold_created, false);
  assert.equal(result.dispatch_dry_runs[0].execution_allowed, false);
  assert.equal(result.dispatch_dry_runs[0].target_write_allowed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.dispatch_dry_run_policy.dry_run_only, true);
  assert.equal(result.dispatch_dry_run_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeDispatchDryRun({ pool, input: {} }),
    /request_gate_id is required/
  );
}

console.log("session insight capability envelope dispatch dry-run service tests passed");
