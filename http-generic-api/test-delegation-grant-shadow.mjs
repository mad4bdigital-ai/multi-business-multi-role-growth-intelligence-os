import assert from "node:assert/strict";
import {
  projectDelegationGrantPreview,
  projectLegacyDelegationInspection,
  evaluateDelegationTransitionShadow,
  previewDelegationGrantShadow,
} from "./delegationGrantShadowService.js";

const PLAN_ID = "plan-0001";
const TENANT_ID = "tenant-0001";
const USER_ID = "user-0001";
const AGENT_ID = "agent-0001";
const PLAN_HASH = "1".repeat(64);
const RESOURCE_HASH = "2".repeat(64);
const NOW = "2099-07-23T10:00:00.000Z";

function planBound(overrides = {}) {
  return {
    decision: "resolved_preview",
    plan: { plan_id: PLAN_ID, plan_hash: PLAN_HASH, intent_key: "repo.patch.apply" },
    resource_snapshot: { resource_snapshot_hash: RESOURCE_HASH },
    risk_ceiling: { tier: "low" },
    ...overrides,
  };
}

function activeAgent(overrides = {}) {
  return {
    agent_id: AGENT_ID,
    name: "repo-agent",
    execution_class: "standard",
    health_status: "active",
    status: "active",
    max_delegation_ttl: 7200,
    ...overrides,
  };
}

function grantInput(overrides = {}) {
  return {
    delegated_by: USER_ID,
    delegated_to: AGENT_ID,
    tenant_id: TENANT_ID,
    approval_mode: "delegated_plan_bound",
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    resource_scope: [{ resource_uri: "github://owner/repo", snapshot_hash: RESOURCE_HASH }],
    allowed_intents: ["repo.patch.apply"],
    denied_intents: ["repo.pr.merge"],
    max_risk_tier: "low",
    limits: { max_mutations: 3, max_retries: 1, max_pull_requests: 1 },
    require_readback: true,
    stop_on_drift: true,
    created_at: NOW,
    expires_at: "2099-07-23T11:00:00.000Z",
    delegation_approved: true,
    delegation_mode: "manual_api",
    delegation_reason: "User approved this exact plan.",
    ...overrides,
  };
}

function legacyDelegation(overrides = {}) {
  return {
    delegation_id: "delegation-0001",
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    agent_id: AGENT_ID,
    intent_key: "repo.patch.apply",
    brand_key: "brand-main",
    plan_id: PLAN_ID,
    status: "pending",
    failure_reason: "must-not-leak",
    expires_at: "2099-07-23T11:00:00.000Z",
    created_at: NOW,
    completed_at: null,
    ...overrides,
  };
}

const eligible = projectDelegationGrantPreview({
  input: grantInput(),
  planBoundSession: planBound(),
  agent: activeAgent(),
  existingDelegations: [],
  now: NOW,
});
assert.equal(eligible.decision, "eligible_preview");
assert.equal(eligible.grant.status, "preview");
assert.match(eligible.grant.grant_id, /^[0-9a-f-]{36}$/);
assert.match(eligible.grant_hash, /^[0-9a-f]{64}$/);
assert.equal(eligible.execution_performed, false);
assert.equal(eligible.guarantees.database_writes_performed, false);
assert.equal(eligible.guarantees.delegation_activated, false);
assert.equal(eligible.secrets_included, false);

const missingOptIn = projectDelegationGrantPreview({
  input: grantInput({ delegation_approved: false, delegation_mode: "disabled", delegation_reason: "" }),
  planBoundSession: planBound(),
  agent: activeAgent(),
  now: NOW,
});
assert.equal(missingOptIn.decision, "blocked");
assert.ok(missingOptIn.blockers.includes("DELEGATION_APPROVAL_REQUIRED"));
assert.ok(missingOptIn.blockers.includes("MANUAL_API_DELEGATION_MODE_REQUIRED"));

const selfDelegation = projectDelegationGrantPreview({
  input: grantInput({ delegated_to: USER_ID }),
  planBoundSession: planBound(),
  agent: activeAgent({ agent_id: USER_ID }),
  now: NOW,
});
assert.ok(selfDelegation.blockers.includes("SELF_DELEGATION_FORBIDDEN"));

const stalePlan = projectDelegationGrantPreview({
  input: grantInput({ plan_hash: "3".repeat(64) }),
  planBoundSession: planBound(),
  agent: activeAgent(),
  now: NOW,
});
assert.ok(stalePlan.blockers.includes("PLAN_HASH_MISMATCH"));

const staleResource = projectDelegationGrantPreview({
  input: grantInput({
    resource_scope: [{ resource_uri: "github://owner/repo", snapshot_hash: "4".repeat(64) }],
  }),
  planBoundSession: planBound(),
  agent: activeAgent(),
  now: NOW,
});
assert.ok(staleResource.blockers.includes("RESOURCE_SNAPSHOT_MISMATCH"));

const riskBlocked = projectDelegationGrantPreview({
  input: grantInput(),
  planBoundSession: planBound({ risk_ceiling: { tier: "high" } }),
  agent: activeAgent(),
  now: NOW,
});
assert.ok(riskBlocked.blockers.includes("DELEGATION_RISK_EXCEEDED"));

const duplicateActive = projectDelegationGrantPreview({
  input: grantInput(),
  planBoundSession: planBound(),
  agent: activeAgent(),
  existingDelegations: [{ status: "executing" }],
  now: NOW,
});
assert.ok(duplicateActive.blockers.includes("ACTIVE_DELEGATION_ALREADY_EXISTS"));

assert.throws(
  () => projectDelegationGrantPreview({
    input: grantInput({
      allowed_intents: ["repo.patch.apply"],
      denied_intents: ["repo.patch.apply"],
    }),
    planBoundSession: planBound(),
    agent: activeAgent(),
    now: NOW,
  }),
  (error) => error.status === 409 && error.code === "DELEGATION_GRANT_INTENT_CONFLICT",
);

const inspection = projectLegacyDelegationInspection({
  delegation: legacyDelegation(),
  planBoundSession: planBound(),
  now: NOW,
});
assert.equal(inspection.grant.status, "active");
assert.equal(inspection.dispatch_eligible, false);
assert.ok(inspection.policy_gaps.includes("APPROVAL_MODE_NOT_PERSISTED"));
assert.equal(JSON.stringify(inspection).includes("must-not-leak"), false);

const revoke = evaluateDelegationTransitionShadow({
  inspection,
  action: "revoke",
  requestedBy: USER_ID,
  principalScope: "tenant",
  now: NOW,
});
assert.equal(revoke.decision, "eligible_preview");
assert.equal(revoke.proposed_status, "revoked");
assert.equal(revoke.guarantees.delegation_mutated, false);

const unauthorizedRevoke = evaluateDelegationTransitionShadow({
  inspection,
  action: "revoke",
  requestedBy: "other-user",
  principalScope: "tenant",
  now: NOW,
});
assert.ok(unauthorizedRevoke.blockers.includes("DELEGATION_REVOKE_NOT_AUTHORIZED"));

const expiredInspection = projectLegacyDelegationInspection({
  delegation: legacyDelegation({ expires_at: "2000-01-01T00:00:00.000Z" }),
  planBoundSession: planBound(),
  now: NOW,
});
const expire = evaluateDelegationTransitionShadow({
  inspection: expiredInspection,
  action: "expire",
  requestedBy: USER_ID,
  principalScope: "tenant",
  now: NOW,
});
assert.equal(expire.decision, "eligible_preview");
assert.equal(expire.proposed_status, "expired");

class FakePool {
  constructor() {
    this.queries = [];
  }

  async query(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    this.queries.push({ text, params });
    assert.doesNotMatch(text, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|REPLACE)\b/i);
    if (text.includes("FROM agents")) return [[activeAgent()]];
    if (text.includes("FROM agent_delegations") && text.includes("WHERE plan_id")) return [[]];
    throw new Error(`Unexpected SQL: ${text}`);
  }
}

const pool = new FakePool();
const tenantPreview = await previewDelegationGrantShadow({
  pool,
  auth: { mode: "user_jwt", tenant_id: TENANT_ID, user_id: USER_ID },
  input: grantInput(),
  planBoundSessionReader: async () => planBound(),
  now: NOW,
});
assert.equal(tenantPreview.decision, "eligible_preview");
assert.deepEqual(
  pool.queries.find((query) => query.text.includes("WHERE plan_id")).params,
  [PLAN_ID, TENANT_ID, USER_ID],
);

await assert.rejects(
  () => previewDelegationGrantShadow({
    pool: new FakePool(),
    auth: { mode: "user_jwt", tenant_id: TENANT_ID, user_id: USER_ID },
    input: grantInput({ delegated_by: "other-user" }),
    planBoundSessionReader: async () => planBound(),
    now: NOW,
  }),
  (error) => error.status === 403 && error.code === "DELEGATION_GRANT_DELEGATOR_MISMATCH",
);

console.log("delegation grant shadow tests passed");
