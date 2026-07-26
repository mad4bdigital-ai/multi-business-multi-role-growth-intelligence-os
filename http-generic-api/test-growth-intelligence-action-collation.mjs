import assert from "node:assert/strict";

import { decideGrowthIntelligenceAction } from "./growthIntelligenceRegistry.js";

let joinChecked = false;
const connection = {
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {},
  async query(sql) {
    if (sql.includes("FROM growth_intelligence_actions a")) {
      assert(sql.includes("CONVERT(h.hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci"));
      assert(sql.includes("CONVERT(a.approval_hold_id USING utf8mb4) COLLATE utf8mb4_unicode_ci"));
      joinChecked = true;
      return [[{
        action_record_id: "record-1",
        action_id: "action-1",
        approval_hold_id: "hold-1",
        workflow_run_id: "run-1",
        approval_state: "held",
        hold_status: "open",
      }]];
    }
    if (sql.includes("UPDATE approval_holds")) return [{ affectedRows: 1 }];
    if (sql.includes("UPDATE growth_intelligence_actions")) return [{ affectedRows: 1 }];
    if (sql.includes("SUM(approval_state = 'held')")) return [[{ held_count: 0, rejected_count: 0 }]];
    if (sql.includes("UPDATE growth_intelligence_reports")) return [{ affectedRows: 1 }];
    if (sql.includes("UPDATE workflow_runs")) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  },
};
const pool = { async getConnection() { return connection; } };

const result = await decideGrowthIntelligenceAction({
  pool,
  tenantId: "tenant-1",
  reportId: "report-1",
  actionId: "action-1",
  decision: "approved",
  decisionBy: "test",
  decisionNote: "Collation regression coverage",
});

assert.equal(joinChecked, true);
assert.equal(result.decision, "approved");
assert.equal(result.report_status, "approved");
assert.equal(result.workflow_status, "awaiting_review");
assert.equal(result.execution_dispatched, false);
assert.equal(result.provider_writes, 0);
assert.equal(result.external_sends, 0);
assert.equal(result.secrets_included, false);

console.log("growth intelligence action collation test passed");
