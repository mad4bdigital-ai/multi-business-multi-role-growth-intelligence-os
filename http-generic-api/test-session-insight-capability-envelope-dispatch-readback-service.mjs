import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const migrationFile of [
  "281_sprint68_session_insight_capability_envelope_dispatch_readback.sql",
  "282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql",
  "283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql",
]) {
  const migrationSql = readFileSync(`migrations/${migrationFile}`, "utf8");
  const objectNames = Array.from(migrationSql.matchAll(/CREATE (?:TABLE IF NOT EXISTS|OR REPLACE VIEW) `([^`]+)`/g), (match) => match[1]);
  for (const objectName of objectNames) {
    assert(objectName.length <= 64, `${migrationFile}: ${objectName} must fit MySQL/MariaDB 64-character identifier limit`);
  }
}

import {
  createSessionInsightCapabilityEnvelopeDispatchReadback,
  listSessionInsightCapabilityEnvelopeDispatchReadbacks,
} from "./sessionInsightCapabilityEnvelopeDispatchReadbackService.js";

function makePool() {
  const state = {
    calls: [],
    insert: null,
    readback: null,
    approval: {
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
      approval_decision_status: "actual_envelope_approved",
      approval_policy_status: "approved_but_not_executed",
      approval_hold_created: 1,
      approval_hold_id: "approval_hold_1",
      execution_allowed: 0,
      target_write_allowed: 0,
      adapter_apply_executed: 0,
      approval_result_json: JSON.stringify({ envelope_id: "actual_envelope_1", envelope_status: "ready_for_dispatch", decision: "ready_for_dispatch", secrets_included: false }),
      secrets_included: 0,
      ledger_envelope_status: "ready_for_dispatch",
      ledger_decision: "ready_for_dispatch",
      ledger_dispatch_allowed: 1,
      ledger_apply_allowed: 0,
      ledger_approval_required: 0,
      ledger_blocking_gap_count: 0,
      ledger_secrets_included: 0,
    },
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT d.*, e.envelope_status")) {
        return [[{ ...state.approval }]];
      }
      if (compact.startsWith("SELECT COUNT(*) AS count FROM session_insight_capability_envelope_dispatch_readbacks")) {
        return [[{ count: state.readback ? 1 : 0 }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_dispatch_readbacks")) {
        assert(compact.includes("'dispatch_readback_passed'"), "readback must pass only after validation");
        assert(compact.includes("'ready_for_adapter_execution_gate'"), "readback policy must only stage adapter execution gate");
        assert(compact.includes("0, 0, 0"), "readback must not execute adapter, execution, or target write");
        const readbackResult = JSON.parse(params[21]);
        const safety = JSON.parse(params[22]);
        assert.equal(readbackResult.valid_for_dispatch_readback, true);
        assert.equal(readbackResult.adapter_apply_executed, false);
        assert.equal(readbackResult.execution_allowed, false);
        assert.equal(readbackResult.target_write_allowed, false);
        assert.equal(readbackResult.secrets_included, false);
        assert.equal(safety.dispatch_readback_only, true);
        assert.equal(safety.ready_for_adapter_execution_gate, true);
        assert.equal(safety.adapter_execution_gate_not_implemented, true);
        assert.equal(safety.adapter_apply_executed, false);
        assert.equal(safety.execution_allowed, false);
        assert.equal(safety.target_write_allowed, false);
        assert.equal(safety.secrets_included, false);
        state.readback = {
          dispatch_readback_id: params[0],
          approval_decision_id: params[1],
          actual_request_id: params[2],
          actual_request_preflight_id: params[3],
          dispatch_dry_run_id: params[4],
          request_gate_id: params[5],
          capability_plan_id: params[6],
          promotion_id: params[7],
          insight_id: params[8],
          capability_key: params[9],
          operation_intent: params[10],
          runtime_surface: params[11],
          actual_capability_envelope_id: params[12],
          dispatch_readback_status: "dispatch_readback_passed",
          dispatch_readback_policy_status: "ready_for_adapter_execution_gate",
          approval_hold_created: 1,
          approval_hold_id: params[13],
          envelope_status: params[14],
          envelope_decision: params[15],
          envelope_dispatch_allowed: params[16],
          envelope_apply_allowed: params[17],
          envelope_approval_required: params[18],
          envelope_blocking_gap_count: params[19],
          adapter_apply_executed: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          source_approval_decision_sha256: params[20],
          readback_result_json: params[21],
          safety_contract_json: params[22],
          created_by: params[23],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_dispatch_readbacks WHERE dispatch_readback_id")) {
        return [[{ ...state.readback }]];
      }
      if (compact.startsWith("SELECT r.* FROM session_insight_capability_envelope_dispatch_readbacks")) {
        return [[{ ...state.readback }]];
      }
      if (compact.startsWith("SELECT dispatch_readback_status")) {
        return [[{
          dispatch_readback_status: "dispatch_readback_passed",
          dispatch_readback_policy_status: "ready_for_adapter_execution_gate",
          adapter_apply_executed: 0,
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
  const result = await createSessionInsightCapabilityEnvelopeDispatchReadback({
    pool,
    input: { approval_decision_id: "approval_decision_1", created_by: "gpt_admin" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dispatch_readback.approval_decision_id, "approval_decision_1");
  assert.equal(result.dispatch_readback.dispatch_readback_status, "dispatch_readback_passed");
  assert.equal(result.dispatch_readback.dispatch_readback_policy_status, "ready_for_adapter_execution_gate");
  assert.equal(result.dispatch_readback.envelope_status, "ready_for_dispatch");
  assert.equal(result.dispatch_readback.adapter_apply_executed, false);
  assert.equal(result.dispatch_readback.execution_allowed, false);
  assert.equal(result.dispatch_readback.target_write_allowed, false);
  assert.equal(result.safety_contract.dispatch_readback_only, true);
  assert.equal(result.safety_contract.adapter_execution_gate_not_implemented, true);
  assert.equal(result.safety_contract.adapter_apply_executed, false);
  assert.equal(result.safety_contract.target_write_allowed, false);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await createSessionInsightCapabilityEnvelopeDispatchReadback({ pool, input: { approval_decision_id: "approval_decision_1" } });
  const result = await listSessionInsightCapabilityEnvelopeDispatchReadbacks({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.dispatch_readbacks[0].adapter_apply_executed, false);
  assert.equal(result.dispatch_readbacks[0].execution_allowed, false);
  assert.equal(result.dispatch_readbacks[0].target_write_allowed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.dispatch_readback_policy.readback_only, true);
  assert.equal(result.dispatch_readback_policy.ready_for_adapter_execution_gate, true);
  assert.equal(result.dispatch_readback_policy.adapter_apply_executed, false);
  assert.equal(result.dispatch_readback_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeDispatchReadback({ pool, input: {} }),
    /approval_decision_id is required/
  );
}

{
  const pool = makePool();
  pool.state.approval.ledger_envelope_status = "ready_requires_approval";
  pool.state.approval.ledger_decision = "ready_requires_approval";
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeDispatchReadback({ pool, input: { approval_decision_id: "approval_decision_1" } }),
    /capability envelope dispatch readback validation failed/
  );
}

console.log("session insight capability envelope dispatch readback service tests passed");
