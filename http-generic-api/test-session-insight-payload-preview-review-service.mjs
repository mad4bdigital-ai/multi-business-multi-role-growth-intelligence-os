import assert from "node:assert/strict";
import {
  decideSessionInsightPayloadPreviewReview,
  listSessionInsightPayloadPreviewReviews,
} from "./sessionInsightPayloadPreviewReviewService.js";

function makePool() {
  const state = {
    calls: [],
    events: [],
    preview: {
      payload_preview_id: "payload_preview_1",
      apply_request_id: "promo_apply_req_1",
      preview_id: "promo_preview_1",
      promotion_id: "promo_1",
      insight_id: "ins_1",
      adapter_key: "session_insight.development_backlog.skeleton_adapter",
      contract_key: "session_insight.development_backlog.dry_run_contract.v1",
      target_surface: "development_backlog",
      promotion_type: "development_backlog_item",
      payload_status: "payload_preview_generated",
      payload_review_status: "review_required",
      payload_decision_status: "review_required",
      payload_mode: "dry_run_payload_preview",
      execution_allowed: 0,
      target_write_allowed: 0,
      payload_json: JSON.stringify({ title: "Draft", source_promotion_id: "promo_1", source_insight_id: "ins_1" }),
      validation_result_json: JSON.stringify({ valid_for_dry_run_contract: true, secrets_included: false }),
      safety_contract_json: JSON.stringify({ adapter_apply_executed: false, target_write_allowed: false, secrets_included: false }),
      created_by: "test",
      secrets_included: 0,
    },
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT p.* FROM session_insight_promotion_payload_previews")) {
        assert(compact.includes("p.secrets_included = 0"), "review list must exclude secret-flagged previews");
        return [[{ ...state.preview }]];
      }
      if (compact.startsWith("SELECT payload_review_status")) {
        return [[{
          payload_review_status: state.preview.payload_review_status,
          payload_decision_status: state.preview.payload_decision_status,
          payload_status: state.preview.payload_status,
          target_surface: state.preview.target_surface,
          execution_allowed: state.preview.execution_allowed,
          target_write_allowed: state.preview.target_write_allowed,
          count: 1,
        }]];
      }
      if (compact.startsWith("SELECT * FROM session_insight_promotion_payload_previews")) {
        return [[{ ...state.preview }]];
      }
      if (compact.startsWith("UPDATE session_insight_promotion_payload_previews") && compact.includes("payload_review_status = 'approved'")) {
        assert(compact.includes("execution_allowed = 0"), "approve must keep execution disabled");
        assert(compact.includes("target_write_allowed = 0"), "approve must keep target writes disabled");
        state.preview = {
          ...state.preview,
          payload_review_status: "approved",
          payload_decision_status: "approved",
          approved_by: params[0],
          decision_notes: params[1],
          execution_allowed: 0,
          target_write_allowed: 0,
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("UPDATE session_insight_promotion_payload_previews") && compact.includes("payload_review_status = 'rejected'")) {
        assert(compact.includes("execution_allowed = 0"), "reject must keep execution disabled");
        assert(compact.includes("target_write_allowed = 0"), "reject must keep target writes disabled");
        state.preview = {
          ...state.preview,
          payload_review_status: "rejected",
          payload_decision_status: "rejected",
          rejected_by: params[0],
          decision_notes: params[1],
          execution_allowed: 0,
          target_write_allowed: 0,
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("INSERT INTO session_insight_payload_preview_review_events")) {
        const evidence = JSON.parse(params.at(-1));
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
  const result = await listSessionInsightPayloadPreviewReviews({
    pool,
    filters: { payload_review_status: "review_required", include_payload: true, limit: 5 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.payload_previews[0].payload_preview_id, "payload_preview_1");
  assert.equal(result.payload_previews[0].execution_allowed, false);
  assert.equal(result.payload_previews[0].target_write_allowed, false);
  assert.equal(result.payload_previews[0].payload.title, "Draft");
  assert.equal(result.review_policy.approval_sets_execution_allowed, false);
  assert.equal(result.review_policy.approval_sets_target_write_allowed, false);
}

{
  const pool = makePool();
  const result = await decideSessionInsightPayloadPreviewReview({
    pool,
    input: { payload_preview_id: "payload_preview_1", decision: "approve", reviewed_by: "gpt_admin", review_notes: "Payload shape looks safe." },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "approve");
  assert.equal(result.after.payload_review_status, "approved");
  assert.equal(result.payload_preview.execution_allowed, false);
  assert.equal(result.payload_preview.target_write_allowed, false);
  assert.equal(result.safety_contract.adapter_apply_executed, false);
  assert.equal(pool.state.events.length, 1);
}

{
  const pool = makePool();
  const result = await decideSessionInsightPayloadPreviewReview({
    pool,
    input: { payload_preview_id: "payload_preview_1", decision: "reject", reviewed_by: "gpt_admin", review_notes: "Reject smoke." },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "reject");
  assert.equal(result.after.payload_review_status, "rejected");
  assert.equal(result.payload_preview.execution_allowed, false);
  assert.equal(result.payload_preview.target_write_allowed, false);
  assert.equal(pool.state.events.length, 1);
}

{
  const pool = makePool();
  await assert.rejects(
    () => decideSessionInsightPayloadPreviewReview({ pool, input: { payload_preview_id: "payload_preview_1", decision: "execute" } }),
    /decision must be approve or reject/
  );
}

console.log("session insight payload preview review service tests passed");
