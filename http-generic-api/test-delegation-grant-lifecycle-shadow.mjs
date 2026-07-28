import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DELEGATION_GRANT_LIFECYCLE_SHADOW_VERSION,
  createDelegationLifecycleReadPort,
  evaluateDelegationRenewalNoWidening,
  inspectDelegationGrantLifecycleShadow,
  planDelegationGrantCreateShadow,
  planDelegationGrantExpireShadow,
  planDelegationGrantRevokeShadow,
  _testingDelegationGrantLifecycleShadow,
} from "./delegationGrantLifecycleShadowService.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const GRANT_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const STEP_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-07-26T12:00:00.000Z";

function grant(overrides = {}) {
  return {
    schema_version: "spec011-delegation-grant-v1",
    grant_id: GRANT_ID,
    delegated_by: "user-1",
    delegated_to: "agent-1",
    approval_mode: "delegated_plan_bound",
    plan_id: PLAN_ID,
    plan_hash: HASH_A,
    resource_scope: [
      { resource_uri: "github://owner/repo", snapshot_hash: HASH_B },
      { resource_uri: "plan://tenant/plan", snapshot_hash: HASH_C },
    ],
    allowed_intents: ["repo.pr.create", "repo.patch.apply"],
    denied_intents: ["repo.pr.merge"],
    max_risk_tier: "medium",
    limits: { max_mutations: 4, max_retries: 2, max_pull_requests: 1 },
    require_readback: true,
    stop_on_drift: true,
    policy_version: "policy-v1",
    status: "preview",
    created_at: "2026-07-26T11:00:00.000Z",
    expires_at: "2026-07-26T13:00:00.000Z",
    revoked_at: null,
    secrets_included: false,
    ...overrides,
  };
}

function readiness(overrides = {}) {
  return {
    status: "verified_applied",
    migration_applied: true,
    readback_complete: true,
    migration_checksum_sha256: HASH_A,
    statement_count: 2,
    schema_readback_fingerprint: HASH_B,
    ...overrides,
  };
}

function preview(overrides = {}) {
  const canonical = grant();
  return {
    decision: "eligible_preview",
    grant_hash: HASH_C,
    grant: {
      ...canonical,
      schema_version: "spec011-delegation-grant-shadow-v1",
    },
    ...overrides,
  };
}

const mutationContext = {
  operationId: OPERATION_ID,
  stepId: STEP_ID,
  idempotencyKey: "delegation-create-001",
  requestedBy: "user-1",
};

{
  const blocked = planDelegationGrantCreateShadow({
    preview: preview(),
    schemaReadiness: {},
    ...mutationContext,
    now: NOW,
  });
  assert.equal(blocked.decision, "blocked");
  assert.equal(blocked.receipt, null);
  assert.ok(blocked.blockers.includes("DELEGATION_SCHEMA_NOT_VERIFIED_APPLIED"));
  assert.equal(blocked.guarantees.database_write_performed, false);
}

{
  const first = planDelegationGrantCreateShadow({
    preview: preview(),
    schemaReadiness: readiness(),
    expectedPreviewGrantHash: HASH_C,
    ...mutationContext,
    now: NOW,
  });
  const second = planDelegationGrantCreateShadow({
    preview: preview(),
    schemaReadiness: readiness(),
    expectedPreviewGrantHash: HASH_C,
    ...mutationContext,
    now: NOW,
  });
  assert.equal(first.decision, "eligible_shadow");
  assert.equal(first.receipt.state, "pending");
  assert.equal(first.receipt.outcome_classification, "pending");
  assert.equal(first.receipt.retry_allowed, false);
  assert.equal(first.receipt.readback_complete, false);
  assert.equal(first.receipt.receipt_id, second.receipt.receipt_id);
  assert.equal(first.request_fingerprint, second.request_fingerprint);
  assert.equal(first.command_preview.proposed_status, "active");
  assert.equal(first.execution_performed, false);
}

assert.throws(
  () => planDelegationGrantCreateShadow({
    preview: preview(),
    schemaReadiness: readiness(),
    expectedPreviewGrantHash: HASH_A,
    ...mutationContext,
    now: NOW,
  }),
  (error) => error.code === "DELEGATION_LIFECYCLE_PREVIEW_STALE",
);

assert.throws(
  () => planDelegationGrantCreateShadow({
    preview: preview(),
    schemaReadiness: readiness(),
    ...mutationContext,
    idempotencyKey: "short",
    now: NOW,
  }),
  (error) => error.code === "DELEGATION_LIFECYCLE_IDEMPOTENCY_KEY_INVALID",
);

{
  const narrowed = grant({
    resource_scope: [{ resource_uri: "github://owner/repo", snapshot_hash: HASH_B }],
    allowed_intents: ["repo.pr.create"],
    denied_intents: ["repo.pr.merge", "production.deploy"],
    max_risk_tier: "low",
    limits: { max_mutations: 2, max_retries: 1, max_pull_requests: 0 },
    expires_at: "2026-07-26T12:30:00.000Z",
  });
  const result = evaluateDelegationRenewalNoWidening({ currentGrant: grant(), requestedGrant: narrowed });
  assert.equal(result.decision, "eligible_preview");
  assert.equal(result.new_approval_required, false);
  assert.deepEqual(result.blockers, []);
}

{
  const wideningCases = [
    [grant({ allowed_intents: ["repo.pr.create", "repo.patch.apply", "production.deploy"] }), "DELEGATION_RENEWAL_ALLOWED_INTENTS_WIDENED"],
    [grant({ max_risk_tier: "high" }), "DELEGATION_RENEWAL_RISK_WIDENED"],
    [grant({ limits: { max_mutations: 5, max_retries: 2, max_pull_requests: 1 } }), "DELEGATION_RENEWAL_MAX_MUTATIONS_WIDENED"],
    [grant({ expires_at: "2026-07-26T14:00:00.000Z" }), "DELEGATION_RENEWAL_EXPIRY_EXTENDED"],
    [grant({ resource_scope: [{ resource_uri: "github://owner/other", snapshot_hash: HASH_B }] }), "DELEGATION_RENEWAL_RESOURCE_SCOPE_WIDENED"],
    [grant({ denied_intents: [] }), "DELEGATION_RENEWAL_DENIED_INTENTS_NARROWED"],
  ];
  for (const [requestedGrant, blocker] of wideningCases) {
    const result = evaluateDelegationRenewalNoWidening({ currentGrant: grant(), requestedGrant });
    assert.equal(result.decision, "blocked");
    assert.ok(result.blockers.includes(blocker), blocker);
    assert.equal(result.new_approval_required, true);
  }
}

{
  const unauthorized = planDelegationGrantRevokeShadow({
    grant: grant({ status: "active" }),
    schemaReadiness: readiness(),
    operationId: OPERATION_ID,
    stepId: STEP_ID,
    idempotencyKey: "delegation-revoke-001",
    requestedBy: "other-user",
    principalScope: "tenant",
    now: NOW,
  });
  assert.equal(unauthorized.decision, "blocked");
  assert.ok(unauthorized.blockers.includes("DELEGATION_REVOKE_NOT_AUTHORIZED"));

  const admin = planDelegationGrantRevokeShadow({
    grant: grant({ status: "active" }),
    schemaReadiness: readiness(),
    operationId: OPERATION_ID,
    stepId: STEP_ID,
    idempotencyKey: "delegation-revoke-002",
    requestedBy: "admin-1",
    principalScope: "admin",
    reason: "policy changed",
    now: NOW,
  });
  assert.equal(admin.decision, "eligible_shadow");
  assert.equal(admin.command_preview.proposed_status, "revoked");
  assert.equal(admin.receipt.state, "pending");
}

{
  const early = planDelegationGrantExpireShadow({
    grant: grant({ status: "active" }),
    schemaReadiness: readiness(),
    operationId: OPERATION_ID,
    stepId: STEP_ID,
    idempotencyKey: "delegation-expire-001",
    requestedBy: "system-sweeper",
    now: NOW,
  });
  assert.equal(early.decision, "blocked");
  assert.ok(early.blockers.includes("DELEGATION_NOT_YET_EXPIRED"));

  const due = planDelegationGrantExpireShadow({
    grant: grant({ status: "active", expires_at: "2026-07-26T11:59:00.000Z" }),
    schemaReadiness: readiness(),
    operationId: OPERATION_ID,
    stepId: STEP_ID,
    idempotencyKey: "delegation-expire-002",
    requestedBy: "system-sweeper",
    now: NOW,
  });
  assert.equal(due.decision, "eligible_shadow");
  assert.equal(due.command_preview.proposed_status, "expired");
}

{
  let reads = 0;
  const repository = {
    async inspectGrant(input) {
      reads += 1;
      assert.deepEqual(input, { grant_id: GRANT_ID, tenant_id: TENANT_ID });
      return grant({ status: "active" });
    },
    async inspectReceipt() {
      return null;
    },
  };
  assert.equal(typeof createDelegationLifecycleReadPort(repository).inspectGrant, "function");
  const inspected = await inspectDelegationGrantLifecycleShadow({
    repository,
    grantId: GRANT_ID,
    tenantId: TENANT_ID,
    now: NOW,
  });
  assert.equal(reads, 1);
  assert.equal(inspected.dispatch_eligible, false);
  assert.equal(inspected.guarantees.repository_read_performed, true);
  assert.equal(inspected.guarantees.repository_write_performed, false);
  assert.equal(inspected.observed_expired, false);
  assert.match(inspected.readback_fingerprint, /^[0-9a-f]{64}$/);
}

assert.throws(
  () => createDelegationLifecycleReadPort({ inspectGrant() {} }),
  (error) => error.code === "DELEGATION_LIFECYCLE_REPOSITORY_PORT_INVALID",
);

assert.equal(DELEGATION_GRANT_LIFECYCLE_SHADOW_VERSION, "spec011-delegation-grant-lifecycle-shadow-v1");
assert.match(_testingDelegationGrantLifecycleShadow.canonicalGrantHash(grant()), /^[0-9a-f]{64}$/);

const source = await readFile(new URL("./delegationGrantLifecycleShadowService.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /\.query\s*\(/);
assert.doesNotMatch(source, /\bINSERT\s+INTO\b/i);
assert.doesNotMatch(source, /\bUPDATE\s+agent_delegations\b/i);
assert.doesNotMatch(source, /\bDELETE\s+FROM\b/i);
assert.doesNotMatch(source, /express|Router\s*\(/);

console.log("delegation grant lifecycle shadow tests passed");
