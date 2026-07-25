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
const ownerSubject = { tenant_id: tenantId, user_id: "user_owner", tenant_role: "tenant_owner" };
const memberSubject = { tenant_id: tenantId, user_id: "user_member", tenant_role: "member" };
const nowValue = new Date("2026-07-23T07:00:00.000Z");

function tenantGrant(overrides = {}) {
  return {
    grant_id: "grant_tenant_1",
    grant_request_id: "request_tenant_1",
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
    grant_status: "revoked",
    grant_expires_at: null,
    granted_at: "2026-07-22T00:00:00.000Z",
    ...overrides,
  };
}

function globalGrant(overrides = {}) {
  return tenantGrant({
    grant_id: "grant_global_1",
    grant_request_id: "request_global_1",
    tenant_id: null,
    brand_key: null,
    agent_id: "agent_global",
    skill_id: "skill_global",
    skill_key: "system.trigger_chain_dispatch",
    skill_display_name: "Trigger Chain Dispatch",
    skill_type: "system_control",
    skill_scope: "global",
    ...overrides,
  });
}

function tenantRequest(overrides = {}) {
  return {
    request_id: "request_tenant_1",
    agent_id: "agent_1",
    skill_id: "skill_1",
    tenant_id: tenantId,
    brand_key: "brand_a",
    request_status: "pending",
    approval_policy_key: "tenant_owner_skill_grant_v1",
    approval_hold_id: null,
    requested_by: "requester_1",
    requested_at: "2026-07-22T00:00:00.000Z",
    decision_by: null,
    decision_note: null,
    decided_at: null,
    provenance_type: "runtime_request",
    provenance_ref: "runtime://agent-skill-grant-request",
    expires_at: null,
    ...overrides,
  };
}

function globalRequest(overrides = {}) {
  return tenantRequest({
    request_id: "request_global_1",
    agent_id: "agent_global",
    skill_id: "skill_global",
    tenant_id: null,
    brand_key: null,
    approval_policy_key: "platform_admin_skill_grant_v1",
    ...overrides,
  });
}

function approvalHold({
  holdId = "hold_tenant_1",
  requestId = "request_tenant_1",
  approvalKey,
  status = "open",
  decisionState = "open",
} = {}) {
  return {
    hold_id: holdId,
    run_id: holdId,
    tenant_id: tenantId,
    workspace_id: null,
    user_id: "user_owner",
    actor_id: "user_owner",
    actor_type: "tenant_user",
    brand_key: "brand_a",
    request_id: requestId,
    correlation_id: approvalKey,
    execution_context_json: JSON.stringify({
      approval_type: "agent_skill_grant_request",
      approval_key: approvalKey,
      request_id: requestId,
      decision_state: decisionState,
      secrets_included: false,
    }),
    hold_type: "supervisor_approval",
    requested_by: "user_owner",
    assigned_to: "user_owner",
    required_role: "tenant_owner",
    status,
    decision_by: status === "open" ? null : "user_owner",
    decision_note: null,
    expires_at: "2026-07-30T00:00:00.000Z",
    decided_at: status === "open" ? null : nowValue,
    created_at: nowValue,
  };
}

const tenantApprovalKey = approvalKeyFor(tenantGrant(), tenantId);
const globalApprovalKey = approvalKeyFor(globalGrant(), tenantId);

assert.match(tenantApprovalKey, /^skill-approval\.[a-f0-9]{64}$/);
assert.notEqual(tenantApprovalKey, globalApprovalKey);
assert.deepEqual(
  sanitizeValue({ token: "hidden", safe: "visible", nested: { password: "hidden", reason: "ok" } }),
  { safe: "visible", nested: { reason: "ok" } }
);
assert.equal(
  effectiveHoldStatus({ status: "open", expires_at: "2026-07-23T06:59:00.000Z", execution_context_json: "{}" }, nowValue),
  "expired"
);
assert.throws(
  () => normalizeDecisionInput({ decision: "skip" }, nowValue),
  (error) => error.code === "TENANT_SKILL_APPROVAL_DECISION_INVALID" && error.status === 400
);
assert.throws(
  () => normalizeDecisionInput({ decision: "defer", defer_until: "2026-07-23T06:00:00.000Z" }, nowValue),
  (error) => error.code === "TENANT_SKILL_APPROVAL_DEFER_UNTIL_INVALID" && error.status === 400
);

const grouped = groupGrantRows([
  { ...tenantGrant(), ...tenantRequest(), grant_request_id: "request_tenant_1" },
  { ...globalGrant(), ...globalRequest(), grant_request_id: "request_global_1" },
], tenantId, nowValue);
assert.equal(grouped.length, 2);
assert.deepEqual(grouped.find((item) => item.approval_key === tenantApprovalKey).request_ids, ["request_tenant_1"]);
assert.equal(grouped.find((item) => item.approval_key === tenantApprovalKey).tenant_decision_allowed, true);
assert.equal(grouped.find((item) => item.approval_key === globalApprovalKey).tenant_decision_allowed, false);

class FakeConnection {
  constructor({
    grants = [tenantGrant(), globalGrant({ grant_status: "active" })],
    requests = [tenantRequest(), globalRequest()],
    holds = [],
    forceGrantMutationFailure = false,
  } = {}) {
    this.grants = grants.map((row) => ({ ...row }));
    this.requests = requests.map((row) => ({ ...row }));
    this.holds = holds.map((row) => ({ ...row }));
    this.forceGrantMutationFailure = forceGrantMutationFailure;
    this.transactions = [];
    this.queries = [];
    this.insertedHolds = [];
  }

  async beginTransaction() { this.transactions.push("begin"); }
  async commit() { this.transactions.push("commit"); }
  async rollback() { this.transactions.push("rollback"); }
  release() { this.transactions.push("release"); }

  grantRows() {
    return this.grants.map((grant) => {
      const request = this.requests.find((row) => row.request_id === grant.grant_request_id) || {};
      return {
        ...grant,
        request_status: request.request_status || null,
        approval_policy_key: request.approval_policy_key || null,
        approval_hold_id: request.approval_hold_id || null,
        requested_at: request.requested_at || null,
        request_decided_at: request.decided_at || null,
      };
    });
  }

  async query(sql, params = []) {
    this.queries.push({ sql, params });

    if (sql.includes("FROM agent_skill_grants g") && sql.includes("LEFT JOIN agent_skill_grant_requests r")) {
      return [this.grantRows()];
    }
    if (sql.includes("FROM approval_holds")) {
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
    if (sql.includes("UPDATE agent_skill_grant_requests") && sql.includes("SET approval_hold_id")) {
      const holdId = params[0];
      const tenantParam = params[params.length - 1];
      const requestIds = params.slice(1, -1);
      let affectedRows = 0;
      for (const request of this.requests) {
        if (requestIds.includes(request.request_id) && request.tenant_id === tenantParam) {
          request.approval_hold_id = holdId;
          affectedRows += 1;
        }
      }
      return [{ affectedRows }];
    }
    if (sql.includes("FROM agent_skill_grant_requests") && sql.includes("request_id IN") && sql.includes("FOR UPDATE")) {
      const tenantParam = params[params.length - 1];
      const requestIds = params.slice(0, -1);
      return [this.requests.filter((request) => requestIds.includes(request.request_id) && request.tenant_id === tenantParam).map((row) => ({ ...row }))];
    }
    if (sql.includes("UPDATE agent_skill_grant_requests") && sql.includes("SET request_status")) {
      const requestId = params[params.length - 1];
      const request = this.requests.find((row) => row.request_id === requestId);
      if (request) {
        request.request_status = params[0];
        request.decision_by = params[1];
        request.decision_note = params[2];
        request.decided_at = nowValue;
        request.provenance_type = params[3];
        request.provenance_ref = params[4];
        request.expires_at = params[5];
      }
      return [{ affectedRows: request ? 1 : 0 }];
    }
    if (sql.includes("UPDATE agent_skill_grants") && sql.includes("status = 'active'")) {
      const requestId = params[params.length - 1];
      const grant = this.grants.find((row) => row.grant_request_id === requestId);
      if (grant && !this.forceGrantMutationFailure) grant.grant_status = "active";
      return [{ affectedRows: grant ? 1 : 0 }];
    }
    if (sql.includes("UPDATE agent_skill_grants") && sql.includes("status = 'revoked'")) {
      const requestId = params[0];
      const grant = this.grants.find((row) => row.grant_request_id === requestId);
      if (grant && !this.forceGrantMutationFailure) grant.grant_status = "revoked";
      return [{ affectedRows: grant ? 1 : 0 }];
    }
    if (sql.includes("UPDATE approval_holds") && sql.includes("JSON_SET")) {
      const holdId = params[params.length - 1];
      const hold = this.holds.find((row) => row.hold_id === holdId);
      if (hold) {
        hold.status = params[0];
        hold.decision_by = params[1];
        hold.decision_note = params[2];
        hold.decided_at = nowValue;
        const context = JSON.parse(hold.execution_context_json || "{}");
        context.decision_state = params[5];
        context.decision_by = params[6];
        context.decision_note = params[7];
        context.deferred_until = params[8];
        context.secrets_included = false;
        hold.execution_context_json = JSON.stringify(context);
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

const listed = await listTenantSkillApprovals({
  explicitSubject: ownerSubject,
  cursor: 0,
  limit: 1,
  pool: new FakePool(new FakeConnection()),
  now: () => nowValue,
});
assert.equal(listed.items.length, 1);
assert.equal(listed.page.total_count, 2);
assert.equal(listed.page.has_more, true);
assert.equal(listed.items[0].status, "pending");
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

const approveConnection = new FakeConnection({ grants: [tenantGrant()], requests: [tenantRequest()] });
const approved = await decideTenantSkillApproval({
  explicitSubject: ownerSubject,
  approvalKey: tenantApprovalKey,
  input: { decision: "approve", decision_note: "Approved for tenant operations.", idempotency_key: "approve-1" },
  pool: new FakePool(approveConnection),
  uuid: () => "11111111-1111-4111-8111-111111111111",
  now: () => nowValue,
});
assert.equal(approved.changed, true);
assert.equal(approved.decision, "approve");
assert.equal(approved.grant_mutation.affected_requests, 1);
assert.equal(approved.approval.status, "approved");
assert.equal(approved.approval.readback.status, "passed");
assert.equal(approved.approval.readback.active_grant_count, 1);
assert.equal(approveConnection.insertedHolds.length, 1);
assert.equal(approveConnection.requests[0].approval_hold_id, "11111111-1111-4111-8111-111111111111");
assert.deepEqual(approveConnection.transactions, ["begin", "commit", "release"]);
assert.equal(JSON.parse(approveConnection.holds[0].execution_context_json).decision_state, "approved");

const approvedHold = approvalHold({ approvalKey: tenantApprovalKey, status: "approved", decisionState: "approved" });
const idempotentConnection = new FakeConnection({
  grants: [tenantGrant({ grant_status: "active" })],
  requests: [tenantRequest({ request_status: "approved", approval_hold_id: approvedHold.hold_id, decided_at: nowValue })],
  holds: [approvedHold],
});
const idempotent = await decideTenantSkillApproval({
  explicitSubject: ownerSubject,
  approvalKey: tenantApprovalKey,
  input: { decision: "approve" },
  pool: new FakePool(idempotentConnection),
  now: () => nowValue,
});
assert.equal(idempotent.changed, false);
assert.equal(idempotent.idempotency.existing_decision_returned, true);

const rejectHold = approvalHold({ approvalKey: tenantApprovalKey });
const rejectConnection = new FakeConnection({
  grants: [tenantGrant({ grant_status: "active" })],
  requests: [tenantRequest({ approval_hold_id: rejectHold.hold_id })],
  holds: [rejectHold],
});
const rejected = await decideTenantSkillApproval({
  explicitSubject: ownerSubject,
  approvalKey: tenantApprovalKey,
  input: { decision: "reject", decision_note: "Not allowed for this tenant." },
  pool: new FakePool(rejectConnection),
  now: () => nowValue,
});
assert.equal(rejected.approval.status, "rejected");
assert.equal(rejected.approval.readback.status, "passed");
assert.equal(rejected.approval.readback.active_grant_count, 0);
assert.equal(rejected.approval.readback.revoked_grant_count, 1);

const deferHold = approvalHold({ approvalKey: tenantApprovalKey });
const deferConnection = new FakeConnection({
  grants: [tenantGrant({ grant_status: "active" })],
  requests: [tenantRequest({ approval_hold_id: deferHold.hold_id })],
  holds: [deferHold],
});
const deferred = await decideTenantSkillApproval({
  explicitSubject: ownerSubject,
  approvalKey: tenantApprovalKey,
  input: { decision: "defer", defer_until: "2026-07-30T12:00:00.000Z", decision_note: "Review after access audit." },
  pool: new FakePool(deferConnection),
  now: () => nowValue,
});
assert.equal(deferred.approval.status, "deferred");
assert.equal(deferred.approval.readback.status, "blocked");
assert.equal(deferred.grant_mutation.affected_requests, 1);

const failureHold = approvalHold({ approvalKey: tenantApprovalKey });
const readbackFailureConnection = new FakeConnection({
  grants: [tenantGrant({ grant_status: "active" })],
  requests: [tenantRequest({ approval_hold_id: failureHold.hold_id })],
  holds: [failureHold],
  forceGrantMutationFailure: true,
});
await assert.rejects(
  () => decideTenantSkillApproval({
    explicitSubject: ownerSubject,
    approvalKey: tenantApprovalKey,
    input: { decision: "reject" },
    pool: new FakePool(readbackFailureConnection),
    now: () => nowValue,
  }),
  (error) => error.code === "TENANT_SKILL_APPROVAL_READBACK_FAILED" && error.status === 409
);
assert.deepEqual(readbackFailureConnection.transactions, ["begin", "rollback", "release"]);

await assert.rejects(
  () => listTenantSkillApprovals({ explicitSubject: {}, pool: new FakePool(new FakeConnection()) }),
  (error) => error.code === "TENANT_SKILL_APPROVAL_SCOPE_REQUIRED" && error.status === 403
);

console.log("PASS tenant-skill-approval-center-request-authority");
