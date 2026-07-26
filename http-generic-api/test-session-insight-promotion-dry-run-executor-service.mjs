import assert from "node:assert/strict";
import {
  buildSessionInsightPromotionExecutionPreview,
  previewSessionInsightPromotionExecution,
} from "./sessionInsightPromotionDryRunExecutorService.js";

function promotionRow(overrides = {}) {
  return {
    promotion_id: "promo-approved-1",
    insight_id: "ins-approved-1",
    insight_type: "development_idea",
    promotion_type: "development_backlog_item",
    target_surface: "development_backlog",
    target_ref: null,
    target_scope_type: "workspace",
    target_scope_ref: "platform_repo_governance_zero",
    proposal_title: "Review development idea: executor dry-run",
    proposal_text: "Preview approved proposal destination without executing writes.",
    decision_status: "approved",
    approval_status: "approved",
    promotion_status: "ready",
    risk_level: "medium",
    confidence: 0.9,
    promotion_allowed: 0,
    promotion_executor_key: null,
    tenant_id: "tenant-1",
    workspace_key: "workspace-1",
    secrets_included: 0,
    ...overrides,
  };
}

function makePool() {
  const state = {
    calls: [],
    previewInserts: [],
    row: promotionRow(),
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT p.*, c.insight_type")) {
        assert(compact.includes("p.decision_status = 'approved'"), "default dry-run list must require approved decision");
        assert(compact.includes("p.approval_status = 'approved'"), "default dry-run list must require approved approval status");
        assert(compact.includes("p.promotion_status = 'ready'"), "default dry-run list must require ready promotion status");
        assert(compact.includes("p.secrets_included = 0"), "dry-run list must exclude secret-flagged promotions");
        return [[{ ...state.row }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_promotion_execution_previews")) {
        assert(compact.includes("'dry_run', 0, 'preview_generated'"), "preview insert must be dry-run and execution_allowed=0");
        state.previewInserts.push({ sql, params });
        const proposedWrite = JSON.parse(params[5]);
        const blockers = JSON.parse(params[6]);
        const dryRunResult = JSON.parse(params[7]);
        const safety = JSON.parse(params[8]);
        assert.equal(proposedWrite.backlog_policy_canonical_write_executed, false);
        assert.equal(proposedWrite.provider_call_executed, false);
        assert.equal(dryRunResult.execution_allowed, false);
        assert(blockers.includes("executor_layer_not_implemented"));
        assert.equal(safety.runtime_promotion_executed, false);
        assert.equal(safety.external_write_executed, false);
        assert.equal(safety.secrets_included, false);
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT approval_status, promotion_status")) {
        return [[{ approval_status: "approved", promotion_status: "ready", promotion_allowed: 0, count: 1 }]];
      }
      return [[]];
    },
  };
}

{
  const preview = buildSessionInsightPromotionExecutionPreview(promotionRow());
  assert.equal(preview.execution_mode, "dry_run");
  assert.equal(preview.execution_allowed, false);
  assert.equal(preview.promotion_allowed, false);
  assert.equal(preview.proposed_write.proposed_surface, "development_backlog");
  assert.equal(preview.proposed_write.proposed_operation, "would_create_development_backlog_item");
  assert(preview.blockers.includes("executor_layer_not_implemented"));
  assert(preview.blockers.includes("promotion_allowed_policy_forces_false_until_executor_layer"));
  assert.equal(preview.safety_contract.backlog_policy_canonical_write_executed, false);
  assert.equal(preview.safety_contract.provider_call_executed, false);
  assert.equal(preview.safety_contract.secrets_included, false);
}

{
  const preview = buildSessionInsightPromotionExecutionPreview(promotionRow({
    promotion_type: "unknown_type",
    decision_status: "review_required",
    approval_status: "review_required",
    promotion_status: "queued",
  }));
  assert(preview.blockers.includes("promotion_not_approved_ready"));
  assert(preview.blockers.includes("unknown_promotion_type_requires_manual_mapping"));
  assert.equal(preview.execution_allowed, false);
}

{
  const pool = makePool();
  const result = await previewSessionInsightPromotionExecution({
    pool,
    filters: { record_preview: true, limit: 5, created_by: "test_executor" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.recorded_count, 1);
  assert.equal(result.previews[0].execution_allowed, false);
  assert.equal(result.previews[0].safety_contract.runtime_promotion_executed, false);
  assert.equal(result.executor_policy.mode, "dry_run_only");
  assert.equal(result.executor_policy.writes_backlog_policy_or_canonical, false);
  assert.equal(pool.state.previewInserts.length, 1);
}

console.log("session insight promotion dry-run executor service tests passed");
