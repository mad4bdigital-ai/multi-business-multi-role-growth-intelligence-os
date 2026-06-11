import assert from "node:assert/strict";
import {
  executeSessionInsightBacklogTargetWrite,
  listSessionInsightBacklogTargetWrites,
  rollbackSessionInsightBacklogTargetWrite,
} from "./sessionInsightBacklogTargetWriteService.js";

function makePool(overrides = {}) {
  const state = {
    context: {
      remaining_scope_completion_id: "remaining_scope_completion_1",
      adapter_execution_gate_id: "adapter_gate_1",
      actual_request_id: "actual_request_1",
      actual_capability_envelope_id: "actual_envelope_1",
      promotion_id: "promo_1",
      insight_id: "insight_1",
      completion_status: "remaining_scope_completed_as_gated_no_execution",
      completion_policy_status: "all_remaining_stages_gated_no_execution",
      completion_result_json: JSON.stringify({ valid_for_remaining_scope_completion: true, secrets_included: false }),
      safety_contract_json: JSON.stringify({ secrets_included: false }),
      adapter_apply_executed: 0,
      target_write_executed: 0,
      secrets_included: 0,
      capability_plan_id: "capability_plan_1",
      adapter_execution_gate_status: "adapter_execution_gate_ready",
      adapter_execution_policy_status: "ready_for_adapter_apply_dispatch",
      payload_preview_id: "payload_preview_1",
      apply_request_id: "apply_request_1",
      target_surface: "development_backlog",
      promotion_type: "development_backlog_item",
      adapter_key: "session_insight.development_backlog.skeleton_adapter",
      contract_key: "session_insight.development_backlog.dry_run_contract.v1",
      payload_status: "payload_preview_generated",
      payload_mode: "dry_run_payload_preview",
      payload_json: JSON.stringify({ title: "Write actual backlog item", description: "Create the first internal SQL backlog target item.", acceptance_criteria: ["write is readback visible"], priority: "high" }),
      validation_result_json: JSON.stringify({ valid_for_dry_run_contract: true, secrets_included: false }),
      payload_execution_allowed: 0,
      payload_target_write_allowed: 0,
      payload_secrets_included: 0,
      existing_target_write_id: null,
      ...overrides.context,
    },
    targetWrite: null,
    targetItem: null,
    rollbackUpdated: false,
    calls: [],
  };
  const pool = {
    state,
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ").trim();
      state.calls.push({ sql: compact, params });
      if (compact.startsWith("SELECT c.*, g.capability_plan_id")) return [[state.context]];
      if (compact.startsWith("INSERT INTO session_insight_backlog_target_items")) {
        state.targetItem = {
          target_item_id: params[0],
          source_target_write_id: params[1],
          promotion_id: params[2],
          insight_id: params[3],
          target_surface: params[4],
          promotion_type: params[5],
          title: params[6],
          description: params[7],
          acceptance_criteria_json: params[8],
          priority: params[9],
          target_item_status: "open",
          source_payload_sha256: params[10],
          metadata_json: params[11],
          created_by: params[12],
          secrets_included: 0,
          created_at: "2026-06-11T00:00:00.000Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("INSERT INTO session_insight_backlog_target_writes")) {
        state.targetWrite = {
          target_write_id: params[0],
          remaining_scope_completion_id: params[1],
          adapter_execution_gate_id: params[2],
          actual_request_id: params[3],
          actual_capability_envelope_id: params[4],
          promotion_id: params[5],
          insight_id: params[6],
          target_surface: params[7],
          promotion_type: params[8],
          target_item_id: params[9],
          typed_confirm: params[10],
          target_write_status: "target_write_executed",
          target_write_allowed: 1,
          target_write_executed: 1,
          promotion_allowed: 1,
          provider_call_executed: 0,
          credential_payload_read: 0,
          external_write_executed: 0,
          raw_transcript_included: 0,
          source_remaining_scope_sha256: params[11],
          source_payload_sha256: params[12],
          write_payload_json: params[13],
          write_result_json: params[14],
          rollback_plan_json: params[15],
          safety_contract_json: params[16],
          created_by: params[17],
          secrets_included: 0,
          created_at: "2026-06-11T00:00:00.000Z",
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_backlog_target_writes WHERE target_write_id")) return [[state.targetWrite].filter(Boolean)];
      if (compact.startsWith("SELECT * FROM session_insight_backlog_target_items WHERE target_item_id")) return [[state.targetItem].filter(Boolean)];
      if (compact.startsWith("SELECT w.* FROM session_insight_backlog_target_writes")) return [[state.targetWrite].filter(Boolean)];
      if (compact.startsWith("SELECT issue_code, severity")) return [[{ issue_code: "none", severity: "pass", count: 0 }]];
      if (compact.startsWith("UPDATE session_insight_backlog_target_items")) {
        state.targetItem.target_item_status = "rolled_back";
        state.rollbackUpdated = true;
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("UPDATE session_insight_backlog_target_writes")) {
        state.targetWrite.target_write_status = "rolled_back";
        state.targetWrite.rollback_result_json = params[0];
        state.targetWrite.rolled_back_by = params[1];
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL in test: ${compact}`);
    },
  };
  return pool;
}

const pool = makePool();
const created = await executeSessionInsightBacklogTargetWrite({ pool, input: {
  remaining_scope_completion_id: "remaining_scope_completion_1",
  typed_confirm: "EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE",
  created_by: "test",
} });
assert.equal(created.ok, true);
assert.equal(created.target_write.target_write_executed, true);
assert.equal(created.target_write.promotion_allowed, true);
assert.equal(created.target_write.provider_call_executed, false);
assert.equal(created.target_write.external_write_executed, false);
assert.equal(created.target_write.secrets_included, false);
assert.equal(created.target_item.target_item_status, "open");
assert.equal(created.target_item.title, "Write actual backlog item");

const listed = await listSessionInsightBacklogTargetWrites({ pool, filters: { limit: 5 } });
assert.equal(listed.ok, true);
assert.equal(listed.count, 1);
assert.equal(listed.policy.internal_sql_only, true);

const rolledBack = await rollbackSessionInsightBacklogTargetWrite({ pool, input: {
  target_write_id: created.target_write.target_write_id,
  typed_confirm: "ROLLBACK_SESSION_INSIGHT_BACKLOG_TARGET_WRITE",
  rolled_back_by: "test",
  rollback_reason: "test rollback",
} });
assert.equal(rolledBack.ok, true);
assert.equal(rolledBack.target_write.target_write_status, "rolled_back");
assert.equal(rolledBack.target_item.target_item_status, "rolled_back");
assert.equal(rolledBack.rollback_result.provider_call_executed, false);

await assert.rejects(
  () => executeSessionInsightBacklogTargetWrite({ pool: makePool(), input: { remaining_scope_completion_id: "x", typed_confirm: "WRONG" } }),
  /typed_confirm must equal EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE/
);

await assert.rejects(
  () => executeSessionInsightBacklogTargetWrite({ pool: makePool({ context: { completion_status: "bad" } }), input: { remaining_scope_completion_id: "x", typed_confirm: "EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE" } }),
  /target write validation failed/
);

console.log("session insight backlog target write service tests passed");
