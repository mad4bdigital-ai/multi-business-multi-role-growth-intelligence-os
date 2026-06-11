import assert from "node:assert/strict";
import { createSessionInsightTargetWriteReadback, listSessionInsightTargetWriteReadbacks } from "./sessionInsightTargetWriteReadbackService.js";

function makePool() {
  const state = { readback: null };
  const ctx = {
    target_write_id: "tw1", target_item_id: "ti1", remaining_scope_completion_id: "rc1", actual_request_id: "ar1", actual_capability_envelope_id: "env1", promotion_id: "promo1", insight_id: "ins1", target_surface: "development_backlog", promotion_type: "development_backlog_item", target_write_status: "target_write_executed", target_write_executed: 1, provider_call_executed: 0, credential_payload_read: 0, external_write_executed: 0, raw_transcript_included: 0, secrets_included: 0, source_payload_sha256: "sha1", write_payload_json: JSON.stringify({ target_item_id: "ti1", target_surface: "development_backlog", promotion_type: "development_backlog_item" }), write_result_json: JSON.stringify({ target_item_id: "ti1", target_write_executed: true }), item_target_item_id: "ti1", source_target_write_id: "tw1", item_promotion_id: "promo1", item_insight_id: "ins1", item_target_surface: "development_backlog", item_promotion_type: "development_backlog_item", item_source_payload_sha256: "sha1", item_secrets_included: 0, duplicate_target_write_count: 1, duplicate_target_item_count: 1,
  };
  return { state, async query(sql, params = []) {
    const compact = String(sql).replace(/\s+/g, " ").trim();
    if (compact.startsWith("SELECT w.*")) return [[{ ...ctx }]];
    if (compact.startsWith("INSERT INTO session_insight_target_write_readbacks")) {
      const validation = JSON.parse(params[17]);
      const safety = JSON.parse(params[18]);
      assert.equal(validation.valid_target_write_readback, true);
      assert.equal(safety.readback_only, true);
      assert.equal(safety.target_item_modified_by_readback, false);
      assert.equal(safety.rollback_executed, false);
      assert.equal(safety.secrets_included, false);
      state.readback = { readback_id: params[0], target_write_id: params[1], target_item_id: params[2], promotion_id: params[6], insight_id: params[7], target_surface: params[8], promotion_type: params[9], readback_status: params[10], readback_mode: "read_only_validation", target_item_exists: params[11], target_link_matches: params[12], source_payload_matches: params[13], target_write_status_matches: params[14], duplicate_target_write_count: params[15], duplicate_target_item_count: params[16], provider_call_executed: 0, credential_payload_read: 0, external_write_executed: 0, raw_transcript_included: 0, target_modified_by_readback: 0, readback_result_json: params[17], safety_contract_json: params[18], created_by: params[19], secrets_included: 0 };
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith("SELECT * FROM session_insight_target_write_readbacks")) return [[{ ...state.readback }]];
    if (compact.startsWith("SELECT r.* FROM session_insight_target_write_readbacks")) return [[{ ...state.readback }]];
    if (compact.startsWith("SELECT issue_code")) return [[]];
    return [[]];
  } };
}

{
  const pool = makePool();
  const result = await createSessionInsightTargetWriteReadback({ pool, input: { target_write_id: "tw1", created_by: "test" } });
  assert.equal(result.ok, true);
  assert.equal(result.readback.readback_status, "target_write_readback_passed");
  assert.equal(result.readback.target_item_exists, true);
  assert.equal(result.readback.target_link_matches, true);
  assert.equal(result.readback.source_payload_matches, true);
  assert.equal(result.readback.provider_call_executed, false);
  assert.equal(result.readback.target_modified_by_readback, false);
  assert.equal(result.validation.valid_target_write_readback, true);
}

{
  const pool = makePool();
  await createSessionInsightTargetWriteReadback({ pool, input: { target_write_id: "tw1" } });
  const result = await listSessionInsightTargetWriteReadbacks({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.issues.length, 0);
  assert.equal(result.policy.readback_only, true);
  assert.equal(result.policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(() => createSessionInsightTargetWriteReadback({ pool, input: {} }), /target_write_id is required/);
}

console.log("session insight target write readback service tests passed");
