import assert from "node:assert/strict";
import {
  createSessionInsightTargetWriteReadback,
  listSessionInsightTargetWriteReadbacks,
} from "./sessionInsightTargetWriteReadbackService.js";

function makePool() {
  const state = { calls: [], readback: null };
  const ctx = {
    target_write_id: "target_write_1",
    target_item_id: "target_item_1",
    remaining_scope_completion_id: "remaining_1",
    actual_request_id: "actual_request_1",
    actual_capability_envelope_id: "envelope_1",
    promotion_id: "promo_1",
    insight_id: "ins_1",
    target_surface: "development_backlog",
    promotion_type: "development_backlog_item",
    target_write_status: "target_write_executed",
    target_write_executed: 1,
    provider_call_executed: 0,
    credential_payload_read: 0,
    external_write_executed: 0,
    raw_transcript_included: 0,
    secrets_included: 0,
    source_payload_sha256: "payload-sha",
    write_payload_json: JSON.stringify({
      target_item_id: "target_item_1",
      target_surface: "development_backlog",
      promotion_type: "development_backlog_item",
    }),
    write_result_json: JSON.stringify({
      target_item_id: "target_item_1",
      target_write_executed: true,
    }),
    item_target_item_id: "target_item_1",
    source_target_write_id: "target_write_1",
    item_promotion_id: "promo_1",
    item_insight_id: "ins_1",
    item_target_surface: "development_backlog",
    item_promotion_type: "development_backlog_item",
    title: "Readback target",
    description: "Target description",
    acceptance_criteria_json: JSON.stringify(["Readback passes"]),
    priority: "medium",
    target_item_status: "open",
    item_source_payload_sha256: "payload-sha",
    item_secrets_included: 0,
    duplicate_target_write_count: 1,
    duplicate_target_item_count: 1,
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT w.*")) {
        return [[{ ...ctx }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_target_write_readbacks")) {
        assert(compact.includes("'read_only_validation'"), "readback must be read-only validation mode");
        assert(compact.includes("0, 0, 0, 0, 0"), "readback must not claim runtime effects");
        const validation = JSON.parse(params[18]);
        const safety = JSON.parse(params[19]);
        assert.equal(validation.valid_target_write_readback, true);
        assert.equal(validation.checks.target_item_exists, true);
        assert.equal(validation.checks.target_link_matches, true);
        assert.equal(validation.checks.source_payload_matches, true);
        assert.equal(validation.checks.no_duplicate_target_write, true);
        assert.equal(validation.checks.no_duplicate_target_item, true);
        assert.equal(validation.checks.no_provider_or_external, true);
        assert.equal(safety.readback_only, true);
        assert.equal(safety.target_write_created_by_readback, false);
        assert.equal(safety.target_item_modified_by_readback, false);
        assert.equal(safety.rollback_executed, false);
        assert.equal(safety.secrets_included, false);
        state.readback = {
          readback_id: params[0],
          target_write_id: params[1],
          target_item_id: params[2],
          remaining_scope_completion_id: params[3],
          actual_request_id: params[4],
          actual_capability_envelope_id: params[5],
          promotion_id: params[6],
          insight_id: params[7],
          target_surface: params[8],
          promotion_type: params[9],
          readback_status: params[10],
          readback_mode: "read_only_validation",
          target_item_exists: params[11],
          target_link_matches: params[12],
          source_payload_matches: params[13],
          target_write_status_matches: params[14],
          duplicate_target_write_count: params[15],
          duplicate_target_item_count: params[16],
          provider_call_executed: 0,
          credential_payload_read: 0,
          external_write_executed: 0,
          raw_transcript_included: 0,
          target_modified_by_readback: 0,
          readback_result_json: params[18],
          safety_contract_json: params[19],
          created_by: params[20],
          secrets_included: 0,
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_target_write_readbacks WHERE readback_id")) {
        return [[{ ...state.readback }]];
      }
      if (compact.startsWith("SELECT r.* FROM session_insight_target_write_readbacks")) {
        return [[{ ...state.readback }]];
      }
      if (compact.startsWith("SELECT readback_status")) {
        return [[{ readback_status: "target_write_readback_passed", target_surface: "development_backlog", count: 1 }]];
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
  const result = await createSessionInsightTargetWriteReadback({
    pool,
    input: { target_write_id: "target_write_1", created_by: "gpt_admin" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.readback.target_write_id, "target_write_1");
  assert.equal(result.readback.readback_status, "target_write_readback_passed");
  assert.equal(result.readback.target_item_exists, true);
  assert.equal(result.readback.target_link_matches, true);
  assert.equal(result.readback.source_payload_matches, true);
  assert.equal(result.readback.provider_call_executed, false);
  assert.equal(result.readback.external_write_executed, false);
  assert.equal(result.readback.target_modified_by_readback, false);
  assert.equal(result.validation.valid_target_write_readback, true);
  assert.equal(result.safety_contract.readback_only, true);
}

{
  const pool = makePool();
  await createSessionInsightTargetWriteReadback({ pool, input: { target_write_id: "target_write_1" } });
  const result = await listSessionInsightTargetWriteReadbacks({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.readbacks[0].readback_status, "target_write_readback_passed");
  assert.equal(result.issues.length, 0);
  assert.equal(result.policy.readback_only, true);
  assert.equal(result.policy.target_item_modified_by_readback, false);
  assert.equal(result.policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightTargetWriteReadback({ pool, input: {} }),
    /target_write_id is required/
  );
}

console.log("session insight target write readback service tests passed");
