import assert from "node:assert/strict";
import {
  decideSessionInsightCapabilityEnvelopeApproval,
  listSessionInsightCapabilityEnvelopeApprovals,
} from "./sessionInsightCapabilityEnvelopeApprovalService.js";

const REQUIRED_TYPED_CONFIRM = "APPROVE_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION";

function makePool() {
  const state = {
    calls: [],
    insert: null,
    approval: null,
    actualRequest: {
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
      actual_request_status: "actual_envelope_requested",
      actual_request_policy_status: "actual_envelope_requested_but_not_approved",
      actual_capability_envelope_requested: 1,
      actual_capability_envelope_id: "actual_envelope_1",
      approval_hold_created: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      request_result_json: JSON.stringify({ envelope_id: "actual_envelope_1", envelope_status: "ready_requires_approval", secrets_included: false }),
      secrets_included: 0,
      ledger_envelope_status: "ready_requires_approval",
      ledger_decision: "ready_requires_approval",
      ledger_dispatch_allowed: 1,
      ledger_apply_allowed: 0,
      ledger_approval_required: 1,
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
        return [[{ ...state.actualRequest }]];
      }
      if (compact.startsWith("SELECT COUNT(*) AS count FROM session_insight_capability_envelope_approval_decisions")) {
        return [[{ count: state.approval ? 1 : 0 }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_approval_decisions")) {
        assert(compact.includes("'actual_envelope_approved'"), "approval decision must record approval");
        assert(compact.includes("'approved_but_not_executed'"), "approval decision must remain no-execution");
        assert(compact.includes("1, ?, ?, ?, 0, 0, 0"), "approval may create hold but must not execute or target-write");
        const result = JSON.parse(params[16]);
        const safety = JSON.parse(params[17]);
        assert.equal(result.envelope_id, "actual_envelope_1");
        assert.equal(result.envelope_status, "ready_for_dispatch");
        assert.equal(result.approval_hold_id, "approval_hold_1");
        assert.equal(result.secrets_included, false);
        assert.equal(safety.approval_gate_only, true);
        assert.equal(safety.approval_hold_created, true);
        assert.equal(safety.adapter_apply_executed, false);
        assert.equal(safety.execution_allowed, false);
        assert.equal(safety.target_write_allowed, false);
        assert.equal(safety.secrets_included, false);
        state.approval = {
          approval_decision_id: params[0],
          actual_request_id: params[1],
          actual_request_preflight_id: params[2],
          dispatch_dry_run_id: params[3],
          request_gate_id: params[4],
          capability_plan_id: params[5],
          promotion_id: params[6],
          insight_id: params[7],
          capability_key: params[8],
          operation_intent: params[9],
          runtime_surface: params[10],
          actual_capability_envelope_id: params[11],
          approval_decision_status: "actual_envelope_approved",
          approval_policy_status: "approved_but_not_executed",
          approval_hold_created: 1,
          approval_hold_id: params[12],
          envelope_status_after_approval: params[13],
          envelope_decision_after_approval: params[14],
          execution_allowed: 0,
          target_write_allowed: 0,
          adapter_apply_executed: 0,
          source_actual_request_sha256: params[15],
          approval_result_json: params[16],
          safety_contract_json: params[17],
          typed_confirm: params[18],
          approved_by: params[19],
          approval_notes: params[20],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_approval_decisions WHERE approval_decision_id")) {
        return [[{ ...state.approval }]];
      }
      if (compact.startsWith("SELECT d.* FROM session_insight_capability_envelope_approval_decisions")) {
        return [[{ ...state.approval }]];
      }
      if (compact.startsWith("SELECT approval_decision_status")) {
        return [[{
          approval_decision_status: "actual_envelope_approved",
          approval_policy_status: "approved_but_not_executed",
          approval_hold_created: 1,
          execution_allowed: 0,
          target_write_allowed: 0,
          adapter_apply_executed: 0,
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

const mockApprovalTool = async ({ envelopeId, approvedBy, decisionNote, ttlMinutes }) => {
  assert.equal(envelopeId, "actual_envelope_1");
  assert.equal(approvedBy, "gpt_admin");
  assert.equal(decisionNote, "Approve only, no execution.");
  assert.equal(ttlMinutes, 120);
  return {
    ok: true,
    envelope_id: "actual_envelope_1",
    envelope_status: "ready_for_dispatch",
    decision: "ready_for_dispatch",
    approval_hold_id: "approval_hold_1",
    approved_by: "gpt_admin",
    secrets_included: false,
  };
};

{
  const pool = makePool();
  const result = await decideSessionInsightCapabilityEnvelopeApproval({
    pool,
    approvalTool: mockApprovalTool,
    input: {
      actual_request_id: "actual_request_1",
      typed_confirm: REQUIRED_TYPED_CONFIRM,
      approved_by: "gpt_admin",
      approval_notes: "Approve only, no execution.",
      ttl_minutes: 120,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.approval_decision.actual_request_id, "actual_request_1");
  assert.equal(result.approval_decision.approval_hold_created, true);
  assert.equal(result.approval_decision.approval_hold_id, "approval_hold_1");
  assert.equal(result.approval_decision.envelope_status_after_approval, "ready_for_dispatch");
  assert.equal(result.approval_decision.execution_allowed, false);
  assert.equal(result.approval_decision.target_write_allowed, false);
  assert.equal(result.approval_decision.adapter_apply_executed, false);
  assert.equal(result.safety_contract.approval_hold_created, true);
  assert.equal(result.safety_contract.adapter_apply_executed, false);
  assert.equal(result.safety_contract.target_write_allowed, false);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await decideSessionInsightCapabilityEnvelopeApproval({
    pool,
    approvalTool: mockApprovalTool,
    input: { actual_request_id: "actual_request_1", typed_confirm: REQUIRED_TYPED_CONFIRM, approved_by: "gpt_admin", approval_notes: "Approve only, no execution." },
  });
  const result = await listSessionInsightCapabilityEnvelopeApprovals({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.approval_decisions[0].approval_hold_created, true);
  assert.equal(result.approval_decisions[0].execution_allowed, false);
  assert.equal(result.approval_decisions[0].target_write_allowed, false);
  assert.equal(result.approval_decisions[0].adapter_apply_executed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.approval_policy.requires_typed_confirm, REQUIRED_TYPED_CONFIRM);
  assert.equal(result.approval_policy.adapter_apply_executed, false);
  assert.equal(result.approval_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => decideSessionInsightCapabilityEnvelopeApproval({
      pool,
      approvalTool: mockApprovalTool,
      input: { actual_request_id: "actual_request_1", typed_confirm: "WRONG" },
    }),
    /typed_confirm must equal APPROVE_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION/
  );
}

{
  const pool = makePool();
  pool.state.actualRequest.ledger_envelope_status = "ready_for_dispatch";
  pool.state.actualRequest.ledger_approval_required = 0;
  await assert.rejects(
    () => decideSessionInsightCapabilityEnvelopeApproval({
      pool,
      approvalTool: mockApprovalTool,
      input: { actual_request_id: "actual_request_1", typed_confirm: REQUIRED_TYPED_CONFIRM },
    }),
    /capability envelope approval validation failed/
  );
}

console.log("session insight capability envelope approval service tests passed");
