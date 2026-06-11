import assert from "node:assert/strict";
import { decideSessionInsightCapabilityEnvelopeDispatchDryRunReview } from "./sessionInsightCapabilityEnvelopeDispatchDryRunReviewService.js";

function makePool() {
  const state = {
    calls: [],
    events: [],
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
      dispatch_review_status: "dispatch_dry_run_review_required",
      dispatch_policy_status: "blocked_until_dispatch_dry_run_approved",
      request_review_status: "request_approved",
      request_policy_status: "request_approved_but_not_dispatched",
      actual_capability_envelope_requested: 0,
      actual_capability_envelope_id: null,
      approval_hold_created: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      dispatch_payload_json: JSON.stringify({ dispatch_not_called: true, secrets_included: false }),
      validation_result_json: JSON.stringify({ valid_for_dispatch_dry_run: true, secrets_included: false }),
      safety_contract_json: JSON.stringify({ dispatch_dry_run_only: true, secrets_included: false }),
      created_by: "gpt_admin",
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      secrets_included: 0,
      request_gate_secrets_included: 0,
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
      if (compact.startsWith("UPDATE session_insight_capability_envelope_dispatch_dry_runs")) {
        assert(compact.includes("actual_capability_envelope_requested = 0"), "review must not request actual envelope");
        assert(compact.includes("actual_capability_envelope_id = NULL"), "review must not set actual envelope id");
        assert(compact.includes("approval_hold_created = 0"), "review must not create approval hold");
        assert(compact.includes("execution_allowed = 0"), "review must keep execution disabled");
        assert(compact.includes("target_write_allowed = 0"), "review must keep target writes disabled");
        state.dispatch = {
          ...state.dispatch,
          dispatch_status: params[0],
          dispatch_review_status: params[1],
          dispatch_policy_status: params[2],
          reviewed_by: params[3],
          review_notes: params[4],
          actual_capability_envelope_requested: 0,
          actual_capability_envelope_id: null,
          approval_hold_created: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_dispatch_review_events")) {
        const evidence = JSON.parse(params.at(-1));
        assert.equal(evidence.dispatch_review_only, true);
        assert.equal(evidence.dispatch_not_called_after_review, true);
        assert.equal(evidence.actual_capability_envelope_requested_after_review, false);
        assert.equal(evidence.actual_capability_envelope_id_after_review, null);
        assert.equal(evidence.approval_hold_created_after_review, false);
        assert.equal(evidence.execution_allowed_after_review, false);
        assert.equal(evidence.target_write_allowed_after_review, false);
        assert.equal(evidence.adapter_apply_executed, false);
        assert.equal(evidence.secrets_included, false);
        state.events.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await decideSessionInsightCapabilityEnvelopeDispatchDryRunReview({
    pool,
    input: {
      dispatch_dry_run_id: "capability_dispatch_dry_run_1",
      decision: "approve",
      reviewed_by: "gpt_admin",
      review_notes: "Approve dispatch dry-run only.",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "approve");
  assert.equal(result.after.dispatch_review_status, "dispatch_dry_run_approved");
  assert.equal(result.after.dispatch_policy_status, "dispatch_dry_run_approved_but_not_dispatched");
  assert.equal(result.after.dispatch_status, "dispatch_dry_run_generated");
  assert.equal(result.dispatch_dry_run.actual_capability_envelope_requested, false);
  assert.equal(result.dispatch_dry_run.actual_capability_envelope_id, null);
  assert.equal(result.dispatch_dry_run.approval_hold_created, false);
  assert.equal(result.dispatch_dry_run.execution_allowed, false);
  assert.equal(result.dispatch_dry_run.target_write_allowed, false);
  assert.equal(result.safety_contract.dispatch_dry_run_review_only, true);
  assert.equal(result.safety_contract.adapter_apply_executed, false);
  assert.equal(result.safety_contract.secrets_included, false);
  assert.equal(pool.state.events.length, 1);
}

{
  const pool = makePool();
  const result = await decideSessionInsightCapabilityEnvelopeDispatchDryRunReview({
    pool,
    input: {
      dispatch_dry_run_id: "capability_dispatch_dry_run_1",
      decision: "reject",
      reviewed_by: "gpt_admin",
      review_notes: "Reject dispatch dry-run.",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "reject");
  assert.equal(result.after.dispatch_review_status, "dispatch_dry_run_rejected");
  assert.equal(result.after.dispatch_policy_status, "rejected");
  assert.equal(result.after.dispatch_status, "rejected");
  assert.equal(result.dispatch_dry_run.actual_capability_envelope_requested, false);
  assert.equal(result.dispatch_dry_run.approval_hold_created, false);
  assert.equal(result.dispatch_dry_run.execution_allowed, false);
  assert.equal(result.dispatch_dry_run.target_write_allowed, false);
  assert.equal(pool.state.events.length, 1);
}

{
  const pool = makePool();
  await assert.rejects(
    () => decideSessionInsightCapabilityEnvelopeDispatchDryRunReview({ pool, input: { dispatch_dry_run_id: "capability_dispatch_dry_run_1", decision: "dispatch" } }),
    /decision must be approve or reject/
  );
}

console.log("session insight capability envelope dispatch dry-run review service tests passed");
