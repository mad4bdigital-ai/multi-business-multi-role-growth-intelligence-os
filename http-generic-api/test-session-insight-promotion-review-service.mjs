import assert from "node:assert/strict";
import {
  decideSessionInsightPromotionReview,
  listSessionInsightPromotionReviews,
} from "./sessionInsightPromotionReviewService.js";

function makePool() {
  const state = {
    calls: [],
    promotion: {
      promotion_id: "promo-1",
      insight_id: "ins-1",
      insight_type: "development_idea",
      promotion_type: "development_backlog_item",
      target_surface: "development_backlog",
      target_ref: null,
      target_scope_type: "tenant",
      target_scope_ref: "tenant-1",
      proposal_title: "Review development idea: add review tools",
      proposal_text: "Add review-only tools for promotion proposals.",
      decision_status: "review_required",
      approval_status: "review_required",
      promotion_status: "queued",
      risk_level: "medium",
      confidence: 0.8,
      requires_human_approval: 1,
      promotion_allowed: 0,
      promotion_executor_key: null,
      secrets_included: 0,
      evidence_json: JSON.stringify({ secrets_included: false }),
      scope_links_json: JSON.stringify([{ scope_type: "tenant", scope_ref: "tenant-1" }]),
      metadata_json: JSON.stringify({ promotion_allowed: false }),
      source_session_id: "sess-1",
      source_summary_id: "summary-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      workspace_key: "workspace-1",
      created_at: "2026-06-09T00:00:00.000Z",
      updated_at: "2026-06-09T00:00:00.000Z",
    },
    events: [],
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT p.promotion_id")) {
        return [[{ ...state.promotion }]];
      }
      if (compact.startsWith("SELECT promotion_type, target_surface")) {
        return [[{
          promotion_type: "development_backlog_item",
          target_surface: "development_backlog",
          approval_status: state.promotion.approval_status,
          promotion_status: state.promotion.promotion_status,
          promotion_allowed: state.promotion.promotion_allowed,
          count: 1,
        }]];
      }
      if (compact.startsWith("SELECT p.*, c.insight_type")) {
        return [[{ ...state.promotion }]];
      }
      if (compact.startsWith("UPDATE session_insight_promotions") && compact.includes("approval_status = 'approved'")) {
        assert(compact.includes("promotion_allowed = 0"), "approve must keep promotion_allowed disabled");
        assert(compact.includes("promotion_executor_key = NULL"), "approve must not assign executor");
        state.promotion = {
          ...state.promotion,
          decision_status: "approved",
          approval_status: "approved",
          promotion_status: "ready",
          approved_by: params[0],
          decision_notes: params[1],
          promotion_allowed: 0,
          promotion_executor_key: null,
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("UPDATE session_insight_promotions") && compact.includes("approval_status = 'rejected'")) {
        assert(compact.includes("promotion_allowed = 0"), "reject must keep promotion_allowed disabled");
        assert(compact.includes("promotion_executor_key = NULL"), "reject must not assign executor");
        state.promotion = {
          ...state.promotion,
          decision_status: "rejected",
          approval_status: "rejected",
          promotion_status: "rejected",
          rejected_by: params[0],
          decision_notes: params[1],
          promotion_allowed: 0,
          promotion_executor_key: null,
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("INSERT INTO session_insight_promotion_review_events")) {
        state.events.push({ sql, params });
        assert.equal(params.at(-1).includes('"secrets_included":false'), true);
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await listSessionInsightPromotionReviews({
    pool,
    filters: { promotion_status: "queued", approval_status: "review_required", limit: 5, include_evidence: true },
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.promotions[0].promotion_id, "promo-1");
  assert.equal(result.promotions[0].promotion_allowed, false);
  assert.equal(result.promotions[0].secrets_included, false);
  assert.equal(result.promotions[0].evidence.secrets_included, false);
  assert.equal(result.review_policy.approval_sets_promotion_allowed, false);
  assert.equal(result.review_policy.executor_required_for_runtime_promotion, true);
  assert(
    pool.state.calls.some((call) => String(call.sql).includes("p.secrets_included = 0")),
    "review list should filter out secret-flagged proposals"
  );
}

{
  const pool = makePool();
  const result = await decideSessionInsightPromotionReview({
    pool,
    input: { promotion_id: "promo-1", decision: "approve", reviewed_by: "gpt_admin", review_notes: "Safe to queue for executor design." },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "approve");
  assert.equal(result.after.approval_status, "approved");
  assert.equal(result.after.promotion_status, "ready");
  assert.equal(result.promotion.promotion_allowed, false);
  assert.equal(result.safety_contract.runtime_promotion_executed, false);
  assert.equal(result.safety_contract.backlog_policy_canonical_write_executed, false);
  assert.equal(result.safety_contract.secrets_included, false);
  assert.equal(pool.state.events.length, 1);
}

{
  const pool = makePool();
  const result = await decideSessionInsightPromotionReview({
    pool,
    input: { promotion_id: "promo-1", decision: "reject", reviewed_by: "gpt_admin", review_notes: "Not needed." },
  });
  assert.equal(result.ok, true);
  assert.equal(result.decision, "reject");
  assert.equal(result.after.approval_status, "rejected");
  assert.equal(result.after.promotion_status, "rejected");
  assert.equal(result.promotion.promotion_allowed, false);
  assert.equal(pool.state.events.length, 1);
}

{
  const pool = makePool();
  await assert.rejects(
    () => decideSessionInsightPromotionReview({ pool, input: { promotion_id: "promo-1", decision: "promote" } }),
    /decision must be approve or reject/
  );
}

console.log("session insight promotion review service tests passed");
