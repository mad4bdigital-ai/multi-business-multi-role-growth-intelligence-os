import assert from "node:assert/strict";
import {
  listTenantSkillApprovals,
  decideTenantSkillApproval,
  _testingTenantSkillApprovalCenterService,
} from "./tenantSkillApprovalCenterService.js";

const {
  approvalKeyFor,
  effectiveHoldStatus,
  groupGrantRows,
  normalizeDecisionInput,
  sanitizeValue,
} = _testingTenantSkillApprovalCenterService;

const tenantId = "tenant_1";
const ownerSubject = { tenant_id: tenantId, user_id: "user_owner", tenant_role: "owner" };
const memberSubject = { tenant_id: tenantId, user_id: "user_member", tenant_role: "member" };
const nowValue = new Date("2026-07-14T12:00:00.000Z");

const tenantGrant = {
  grant_id: "grant_tenant_1",
  tenant_id: tenantId,
  brand_key: "brand_a",
  agent_id: "agent_1",
  agent_name: "agent_one",
  agent_display_name: "Agent One",
  skill_id: "skill_1",
  skill_key: "api.wordpress_write",
  skill_display_name: "WordPress Write",
  skill_type: "api_access",
  skill_scope: "brand",
  requires_approval: 1,
  grant_status: "active",
  grant_expires_at: null,
  granted_at: "2026-07-10T00:00:00.000Z",
};
const globalGrant = {
  ...tenantGrant,
  grant_id: "grant_global_1",
  tenant_id: null,
  brand_key: null,
  agent_id: "agent_global",
  skill_id: "skill_global",
  skill_key: "system.trigger_chain_dispatch",
  skill_display_name: "Trigger Chain Dispatch",
  skill_type: "system_control",
  skill_scope: "global",
};
const tenantApprovalKey = approvalKeyFor(tenantGrant, tenantId);
const globalApprovalKey = approvalKeyFor(globalGrant, tenantId);

assert.match(tenantApprovalKey, /^skill-approval\.[a-f0-9]{64}$/);
assert.notEqual(tenantApprovalKey, globalApprovalKey);
assert.deepEqual(
  sanitizeValue({ token: "hidden", safe: "visible", nested: { password: "hidden", reason: "ok" } }),
  { safe: "visible", nested: { reason: "ok" } }
);
assert.equal(
  effectiveHoldStatus({ status: "open", expires_at: "2026-07-14T11:59:00.000Z", execution_context_json: "{}" }, nowValue),
  "expired"
);
assert.equal(
  effectiveHoldStatus({ status: "open", expires_at: "2026-07-15T00:00:00.000Z", execution_context_json: JSON.stringify({ decision_state: "deferred" }) }, nowValue),
  "deferred"
);
assert.throws(
  () => normalizeDecisionInput({ decision: "skip" }, nowValue),
  (error) => error.code === "TENANT_SKILL_APPROVAL_DECISION_INVALID" && error.status === 400
);
assert.throws(
  () => normalizeDecisionInput({ decision: "defer", defer_until: "2026-07-14T11:00:00.000Z" }, nowValue),
  (error) => error.code === "TENANT_SKILL_APPROVAL_DEFER_UNTIL_INVALID" && error.status === 400
);
const grouped = groupGrantRows([tenantGrant, globalGrant], tenantId, nowValue);
assert.equal(grouped.length, 2);
assert.equal(grouped.find((item) => item.approval_key === tenantApprovalKey).tenant_decision_allowed, true);
assert.equal(grouped.find((item) => item.approval_key === globalApprovalKey).tenant_decision_allowed, false);

class FakeConnection {
  constructor({ grants = [tenantGrant, globalGrant], holds = [], forceReadbackFailure = false } = {}) {
    this.grants = grants.map((row) => ({ ...row }));
    this.holds = holds.map((row) => ({ ...row }));
    this.forceReadbackFailure = forceReadbackFailure;
    this.transactions = [];
    this.queries = [];
    this.insertedHolds = [];
  }

  async beginTransaction() { this.transactions.push("begin"); }
  async commit() { this.transactions.push("commit"); }
  async rollback() { this.transactions.push("rollback"); }
  release() { this.transactions.push("release"); }

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (sql.includes("FROM agent_skill_grants g") && sql.includes("JOIN agent_skills s")) {
      return [this.grants.map((row) => ({ ...row }))];
    }
    if (sql.includes("FROM approval_holds") && sql.includes("tenant_skill_grant")) {
      return [this.holds.map((row) => ({ ...row })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))];
    }
    if (sql.startsWith("INSERT INTO approval_holds")) {
      const hold = {
        hold_id: params[0],
        run_id: params[1],
        tenant_id: params[2],
        workspace_id: params[3],
        user_id: params[4],
        actor_id: params[5],
        actor_type: "tenant_user",
        brand_key: params[6],
        request_id: params[7],
        correlation_id: params[8],
        execution_context_json: params[9],
        hold_type: "supervisor_approval",
        requested_by: params[10],
        assigned_to: params[11],
        required_role: "tenant_owner",
        status: "open",
        decision_by: null,
        decision_note: null,
        expires_at: params[12],
        decided_at: null,
        created_at: nowValue,
      };
      this.holds.unshift(hold);
      this.insertedHolds.push(hold);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("UPDATE agent_skill_grants") && sql.includes("status = 'revoked'")) {
      let affectedRows = 0;
      for (const grant of this.grants) {
        if (grant.tenant_id === params[0]
          && grant.agent_id === params[1]
          && grant.skill_id === params[2]
          && (grant.brand_key || "") === (params[3] || "")
          && grant.grant_status === "active") {
          if (!this.forceReadbackFailure) grant.grant_status = "revoked";
          affectedRows += 1;
        }
      }
      return [{ affectedRows }];
    }
    if (sql.includes("UPDATE agent_skill_grants") && sql.includes("status = 'active'")) {
      const hasTtl = sql.includes("DATE_ADD");
      const tenantParamIndex = hasTtl ? 2 : 1;
      let affectedRows = 0;
      for (const grant of this.grants) {
        if (grant.tenant_id === params[tenantParamIndex]
          && grant.agent_id === params[tenantParamIndex + 1]
          && grant.skill_id === params[tenantParamIndex + 2]
          && (grant.brand_key || "") === (params[tenantParamIndex + 3] || "")) {
          if (!this.forceReadbackFailure) grant.grant_status = "active";
          affectedRows += 1;
        }
      }
      return [{ affectedRows }];
    }
    if (sql.includes("UPDATE approval_holds")) {
      const holdId = params[5];
      const hold = this.holds.find((row) => row.hold_id === holdId);
      if (hold) {
        hold.status = params[0];
        hold.decision_by = params[1];
        hold.decision_note = params[2];
        hold.decided_at = nowValue;
        hold.expires_at = params[3];
        hold.execution_context_json = params[4];
      }
      return [{ affectedRows: hold ? 1 : 0 }];
    }
    throw new Error(`unexpected query: ${sql}`);
  }
}

class FakePool {
  constructor(connection) { this.connection = connection; }
  async getConnection() { return this.connection; }
}

const listConnection = new FakeConnection();
const listed = await listTenantSkillApprovals({
  explicitSubject: ownerSubject,
  cursor: 0,
  limit: 1,
  pool: new FakePool(listConnection),
  now: () => nowValue,
});
assert.equal(listed.items.length, 1);
assert.equal(listed.page.total_count, 2);
assert.equal(listed.page.has_more, true);
assert.equal(listed.policy.owner_only_decisions, true);
assert.equal(listed.secrets_included, false);

const filtered = await listTenantSkillApprovals({
  explicitSubject: ownerSubject,
  status: "pending",
  q: "wordpress",
  pool: new FakePool(new FakeConnection()),
  now: () => nowValue,
});
assert.equal(filtered.items.length, 1);
assert.equal(filtered.items[0].approval_key, tenantApprovalKey);

await assert.rejects(
  () => decideTenantSkillApproval({
    explicitSubject: memberSubject,
    approvalKey: tenantApprovalKey,
    input: { decision: "approve" },
    pool: new FakePool(new FakeConnection()),
  }),
  (error) => error.code === "TENANT_SKILL_APPROVAL_OWNER_REQUIRED" && error.status === 403
);

await assert.rejects(
  () => decideTenantSkillApproval({
    explicitSubject: ownerSubject,
    approvalKey: globalApprovalKey,
    input: { decision: "reject" },
    pool: new FakePool(new FakeConnection()),
    now: () => nowValue,
  }),
  (error) => error.code === "TENANT_SKILL_APPROVAL_PLATFORM_SCOPE_REQUIRED" && error.status === 403
);

const approveConnection = new FakeConnection({ grants: [{ ...tenantGrant, grant_status: "revoked" }] });
const approved = await decideTenantSkillApproval({
  explicitSubject: ownerSubject,
  approvalKey: tenantApprovalKey,
  input: {
    decision: "approve",
    decision_note: "Approved for tenant operations.",
    idempotency_key: "approve-1",
  },
  pool: new FakePool(approveConnection),
  uuid: () => "11111111-1111-4111-8111-111111111111",
  now: () => nowValue,
});
assert.equal(approved.changed, true);
assert.equal(approved.decision, "approve");
assert.equal(approved.approval.status, "approved");
assert.equal(approved.approval.readback.status, "passed");
assert.equal(approved.approval.readback.active_grant_count, 1);
assert.equal(approveConnection.insertedHolds.length, 1);
assert.deepEqual(approveConnection.transactions, ["begin", "commit", "release"]);
assert.equal(JSON.parse(approveConnection.holds[0].execution_context_json).decision_state, "approved");

const existingApprovedHold = {
  ...approveConnection.holds[0],
  status: "approved",
  execution_context_json: JSON.stringify({
    approval_type: "tenant_skill_grant",
    approval_key: tenantApprovalKey,
    decision_state: "approved",
  }),
};
const idempotentConnection = new FakeConnection({ grants: [tenantGrant], holds: [existingApprovedHold] });
const idempotent = await decideTenantSkillApproval({
  explicitSubject: ownerSubject,
  approvalKey: tenantApprovalKey,
  input: { decision: "approve" },
  pool: new FakePool(idempotentConnection),
  now: () => nowValue,
});
assert.equal(idempotent.changed, false);
assert.equal(idempotent.idempotency.existing_decision_returned, true);
assert.equal(idempotentConnection.insertedHolds.length, 0);

const rejectConnection = new FakeConnection({ grants: [tenantGrant] });
const rejected = await decideTenantSkillApproval({
  explicitSubject: ownerSubject,
  approvalKey: tenantApprovalKey,
  input: { decision: "reject", decision_note: "Not allowed for this tenant." },
  pool: new FakePool(rejectConnection),
  uuid: () => "22222222-2222-4222-8222-222222222222",
  now: () => nowValue,
});
assert.equal(rejected.approval.status, "rejected");
assert.equal(rejected.approval.readback.status, "passed");
assert.equal(rejected.approval.readback.active_grant_count, 0);
assert.equal(rejected.approval.readback.revoked_grant_count, 1);
assert.equal(JSON.parse(rejectConnection.holds[0].execution_context_json).decision_state, "rejected");

const deferConnection = new FakeConnection({ grants: [tenantGrant] });
const deferred = await decideTenantSkillApproval({
  explicitSubject: ownerSubject,
  approvalKey: tenantApprovalKey,
  input: {
    decision: "defer",
    defer_until: "2026-07-20T12:00:00.000Z",
    decision_note: "Review after access audit.",
  },
  pool: new FakePool(deferConnection),
  uuid: () => "33333333-3333-4333-8333-333333333333",
  now: () => nowValue,
});
assert.equal(deferred.approval.status, "deferred");
assert.equal(deferred.approval.readback.status, "blocked");
assert.equal(deferred.grant_mutation.affected_grants, 0);
assert.equal(JSON.parse(deferConnection.holds[0].execution_context_json).decision_state, "deferred");

const readbackFailureConnection = new FakeConnection({ grants: [tenantGrant], forceReadbackFailure: true });
await assert.rejects(
  () => decideTenantSkillApproval({
    explicitSubject: ownerSubject,
    approvalKey: tenantApprovalKey,
    input: { decision: "reject" },
    pool: new FakePool(readbackFailureConnection),
    uuid: () => "44444444-4444-4444-8444-444444444444",
    now: () => nowValue,
  }),
  (error) => error.code === "TENANT_SKILL_APPROVAL_READBACK_FAILED" && error.status === 409
);
assert.deepEqual(readbackFailureConnection.transactions, ["begin", "rollback", "release"]);

await assert.rejects(
  () => listTenantSkillApprovals({
    explicitSubject: {},
    pool: new FakePool(new FakeConnection()),
  }),
  (error) => error.code === "TENANT_SKILL_APPROVAL_SCOPE_REQUIRED" && error.status === 403
);

console.log("tenant skill approval center tests passed");
