import assert from "node:assert/strict";

import {
  approveRepositoryAdvisoryCommentApprovalHoldAdmin,
  createRepositoryAdvisoryCommentApprovalHoldAdmin,
  decideGrowthIntelligenceActionAdmin,
  decideGrowthIntelligenceInsightAdmin,
  refreshGrowthIntelligenceReadinessAdmin,
} from "./growthIntelligenceAdminDecisions.js";

const tenantId = "65f3f066-eefa-4625-9023-8318c858e94b";
const reportId = "70ec04a0-8cef-4242-8241-1ff30047d567";

const insight = await decideGrowthIntelligenceInsightAdmin({
  tenant_id: tenantId,
  report_id: reportId,
  insight_id: "opp_1",
  decision: "accepted",
}, {
  pool: {},
  async decideInsight(input) {
    assert.equal(input.tenantId, tenantId);
    assert.equal(input.reportId, reportId);
    assert.equal(input.decision, "accepted");
    return { report_id: reportId, insight_id: "opp_1", status: "accepted", execution_dispatched: false, secrets_included: false };
  },
});
assert.equal(insight.ok, true);
assert.equal(insight.execution_dispatched, false);
assert.equal(insight.provider_writes, 0);
assert.equal(insight.external_sends, 0);
assert.equal(insight.secrets_included, false);

const action = await decideGrowthIntelligenceActionAdmin({
  tenant_id: tenantId,
  report_id: reportId,
  action_id: "action_1",
  decision: "approved",
}, {
  pool: {},
  async decideAction(input) {
    assert.equal(input.decision, "approved");
    return {
      report_id: reportId,
      action_id: "action_1",
      approval_hold_id: "hold-action-1",
      decision: "approved",
      report_status: "approval_pending",
      workflow_status: "awaiting_approval",
      execution_dispatched: false,
      provider_writes: 0,
      external_sends: 0,
      secrets_included: false,
    };
  },
});
assert.equal(action.ok, true);
assert.equal(action.execution_dispatched, false);
assert.equal(action.provider_writes, 0);
assert.equal(action.secrets_included, false);

const readiness = await refreshGrowthIntelligenceReadinessAdmin({
  tenant_id: tenantId,
  report_id: reportId,
}, {
  pool: {},
  async persistAssessment(input) {
    assert.equal(input.tenantId, tenantId);
    return {
      assessment_id: "assessment-1",
      assessment_status: "review_ready",
      blocking_gap_count: 0,
      execution_allowed: false,
      provider_writes_allowed: false,
      external_sends_allowed: false,
      secrets_included: false,
    };
  },
});
assert.equal(readiness.classification, "growth_intelligence_review_ready_no_execution");
assert.equal(readiness.execution_allowed, false);
assert.equal(readiness.provider_writes, 0);

const state = {
  plan: {
    plan_id: "11111111-2222-3333-4444-555555555555",
    tenant_id: tenantId,
    workspace_id: null,
    user_id: null,
    owner_name: "mad4bdigital-ai",
    repo_name: "multi-business-multi-role-growth-intelligence-os",
    pr_number: 1659,
    classification: "manual_review_required",
    planned_comment_type: "manual_review_advisory",
    approval_hold_id: null,
    status: "approval_required",
  },
  hold: null,
  workflow: null,
};

const connection = {
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {},
  async query(sql, params) {
    if (sql.includes("FROM repository_advisory_comment_plans") && sql.includes("FOR UPDATE") && !sql.includes("JOIN approval_holds")) {
      return [[{ ...state.plan }]];
    }
    if (sql.includes("FROM approval_holds") && sql.includes("WHERE hold_id")) {
      return [[state.hold].filter(Boolean)];
    }
    if (sql.includes("INSERT INTO workflow_runs")) {
      state.workflow = { run_id: params[0], status: "awaiting_approval" };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO approval_holds")) {
      state.hold = {
        hold_id: params[0],
        run_id: params[1],
        status: "open",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE repository_advisory_comment_plans") && sql.includes("approval_hold_id = ?")) {
      state.plan.approval_hold_id = params[0];
      state.plan.status = "approval_required";
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("JOIN approval_holds") && sql.includes("p.plan_id") && !sql.includes("JOIN workflow_runs")) {
      return [[{
        plan_id: state.plan.plan_id,
        approval_hold_id: state.plan.approval_hold_id,
        plan_status: state.plan.status,
        run_id: state.hold.run_id,
        approval_status: state.hold.status,
        expires_at: state.hold.expires_at,
      }]];
    }
    if (sql.includes("JOIN approval_holds") && sql.includes("FOR UPDATE")) {
      return [[{
        plan_id: state.plan.plan_id,
        approval_hold_id: state.plan.approval_hold_id,
        plan_status: state.plan.status,
        run_id: state.hold.run_id,
        approval_status: state.hold.status,
        expires_at: state.hold.expires_at,
      }]];
    }
    if (sql.includes("UPDATE approval_holds") && sql.includes("status = 'approved'")) {
      state.hold.status = "approved";
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE repository_advisory_comment_plans") && sql.includes("status = 'approved'")) {
      state.plan.status = "approved";
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE workflow_runs") && sql.includes("awaiting_review")) {
      state.workflow.status = "awaiting_review";
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("JOIN workflow_runs")) {
      return [[{
        plan_status: state.plan.status,
        approval_status: state.hold.status,
        workflow_status: state.workflow.status,
      }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  },
};
const pool = { async getConnection() { return connection; } };

const created = await createRepositoryAdvisoryCommentApprovalHoldAdmin({
  plan_id: state.plan.plan_id,
  ttl_minutes: 60,
}, { pool });
assert.equal(created.ok, true);
assert.equal(created.approval_status, "open");
assert.equal(created.apply_allowed, false);
assert.equal(created.provider_writes, 0);
assert.match(created.required_confirmation, /^APPROVE_V5_COMMENT_/);

await assert.rejects(
  approveRepositoryAdvisoryCommentApprovalHoldAdmin({
    plan_id: state.plan.plan_id,
    approval_hold_id: created.approval_hold_id,
    confirm: "WRONG",
  }, { pool }),
  (error) => error?.code === "repository_advisory_comment_approval_confirmation_required"
);

const approved = await approveRepositoryAdvisoryCommentApprovalHoldAdmin({
  plan_id: state.plan.plan_id,
  approval_hold_id: created.approval_hold_id,
  confirm: created.required_confirmation,
}, { pool });
assert.equal(approved.ok, true);
assert.equal(approved.approval_status, "approved");
assert.equal(approved.workflow_status, "awaiting_review");
assert.equal(approved.apply_allowed, true);
assert.equal(approved.provider_writes, 0);
assert.equal(approved.secrets_included, false);

console.log("growth intelligence admin decision tests passed");
