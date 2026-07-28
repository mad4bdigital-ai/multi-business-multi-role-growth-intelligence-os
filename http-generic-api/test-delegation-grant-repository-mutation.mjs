import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  planDelegationGrantCreateShadow,
  planDelegationGrantExpireShadow,
  planDelegationGrantRevokeShadow,
} from "./delegationGrantLifecycleShadowService.js";
import {
  DELEGATION_GRANT_REPOSITORY_MUTATION_CONTRACT_VERSION,
  executeDelegationGrantRepositoryMutation,
} from "./delegationGrantRepositoryMutationService.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const STEP_ID = "55555555-5555-4555-8555-555555555555";
const CAPABILITY_ENVELOPE_ID = "66666666-6666-4666-8666-666666666666";
const APPROVAL_HOLD_ID = "77777777-7777-4777-8777-777777777777";
const NOW = "2026-07-28T06:00:00.000Z";

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

function canonicalGrant(overrides = {}) {
  return {
    schema_version: "spec011-delegation-grant-v1",
    grant_id: GRANT_ID,
    delegated_by: "user-1",
    delegated_to: "agent-1",
    approval_mode: "delegated_plan_bound",
    plan_id: PLAN_ID,
    plan_hash: HASH_A,
    resource_scope: [{ resource_uri: "github://owner/repo", snapshot_hash: HASH_B }],
    allowed_intents: ["repo.patch.apply"],
    denied_intents: ["repo.pr.merge"],
    max_risk_tier: "medium",
    limits: { max_mutations: 3, max_retries: 1, max_pull_requests: 1 },
    require_readback: true,
    stop_on_drift: true,
    policy_version: "policy-v1",
    status: "active",
    created_at: "2026-07-28T05:00:00.000Z",
    expires_at: "2026-07-28T07:00:00.000Z",
    revoked_at: null,
    secrets_included: false,
    ...overrides,
  };
}

function createPlan({ idempotencyKey = "delegation-create-001", allowedIntents = ["repo.patch.apply"] } = {}) {
  return planDelegationGrantCreateShadow({
    preview: {
      decision: "eligible_preview",
      grant_hash: HASH_C,
      grant: {
        ...canonicalGrant({ status: "preview", allowed_intents: allowedIntents }),
        schema_version: "spec011-delegation-grant-shadow-v1",
      },
    },
    schemaReadiness: readiness(),
    expectedPreviewGrantHash: HASH_C,
    operationId: OPERATION_ID,
    stepId: STEP_ID,
    idempotencyKey,
    requestedBy: "user-1",
    now: NOW,
  });
}

function authorization(plan) {
  return {
    approved: true,
    capability_envelope_id: CAPABILITY_ENVELOPE_ID,
    approval_hold_id: APPROVAL_HOLD_ID,
    resource_authority_ref: "resource-authority:test",
    expected_request_fingerprint: plan.request_fingerprint,
  };
}

function key(tenantId, id) {
  return `${tenantId}:${id}`;
}

function clone(value) {
  return structuredClone(value);
}

class InMemoryRepository {
  constructor({ failCommit = false, tamperGrantReadback = false } = {}) {
    this.state = { grants: {}, receipts: {} };
    this.failCommit = failCommit;
    this.tamperGrantReadback = tamperGrantReadback;
    this.beginCount = 0;
    this.commitCount = 0;
    this.rollbackCount = 0;
    this.mutationCount = 0;
  }

  seedGrant(tenantId, grant) {
    this.state.grants[key(tenantId, grant.grant_id)] = clone(grant);
  }

  seedReceipt(tenantId, receipt) {
    this.state.receipts[key(tenantId, receipt.receipt_id)] = { ...clone(receipt), tenant_id: tenantId };
  }

  async beginTransaction() {
    this.beginCount += 1;
    const repository = this;
    const working = clone(this.state);
    return {
      async findReceiptByIdempotencyKey({ tenant_id, idempotency_key }) {
        return clone(Object.values(working.receipts).find(
          (receipt) => receipt.tenant_id === tenant_id && receipt.idempotency_key === idempotency_key,
        ) || null);
      },
      async insertPendingReceipt({ tenant_id, receipt }) {
        working.receipts[key(tenant_id, receipt.receipt_id)] = { ...clone(receipt), tenant_id };
      },
      async applyCreateGrant({ tenant_id, command }) {
        repository.mutationCount += 1;
        working.grants[key(tenant_id, command.grant.grant_id)] = {
          ...clone(command.grant),
          status: command.proposed_status,
        };
      },
      async applyGrantTransition({ tenant_id, command }) {
        repository.mutationCount += 1;
        const grantKey = key(tenant_id, command.grant_id);
        const existing = working.grants[grantKey];
        if (!existing) throw new Error("grant not found");
        working.grants[grantKey] = {
          ...existing,
          status: command.proposed_status,
          revoked_at: command.proposed_status === "revoked" ? command.revoked_at : existing.revoked_at,
        };
      },
      async inspectGrant({ tenant_id, grant_id }) {
        const grant = clone(working.grants[key(tenant_id, grant_id)] || null);
        if (grant && repository.tamperGrantReadback) grant.status = "preview";
        return grant;
      },
      async finalizeReceipt({ tenant_id, receipt_id, ...updates }) {
        const receiptKey = key(tenant_id, receipt_id);
        working.receipts[receiptKey] = { ...working.receipts[receiptKey], ...clone(updates) };
      },
      async inspectReceipt({ tenant_id, receipt_id }) {
        return clone(working.receipts[key(tenant_id, receipt_id)] || null);
      },
      async commit() {
        repository.commitCount += 1;
        repository.state = clone(working);
        if (repository.failCommit) throw new Error("simulated commit transport failure");
      },
      async rollback() {
        repository.rollbackCount += 1;
      },
    };
  }
}

{
  const repository = new InMemoryRepository();
  const plan = createPlan();
  const result = await executeDelegationGrantRepositoryMutation({
    repository,
    plan,
    tenantId: TENANT_ID,
    schemaReadiness: readiness(),
    authorization: authorization(plan),
    now: NOW,
  });
  assert.equal(result.decision, "verified_success");
  assert.equal(result.mutation_applied, true);
  assert.equal(result.idempotent_replay, false);
  assert.equal(result.grant.status, "active");
  assert.equal(result.receipt.state, "reconciled");
  assert.equal(result.receipt.outcome_classification, "verified_success");
  assert.equal(result.receipt.readback_complete, true);
  assert.equal(result.retry_allowed, false);
  assert.equal(repository.commitCount, 1);
  assert.equal(repository.mutationCount, 1);

  const replay = await executeDelegationGrantRepositoryMutation({
    repository,
    plan,
    tenantId: TENANT_ID,
    schemaReadiness: readiness(),
    authorization: authorization(plan),
    now: NOW,
  });
  assert.equal(replay.decision, "idempotent_replay");
  assert.equal(replay.mutation_applied, false);
  assert.equal(replay.idempotent_replay, true);
  assert.equal(repository.mutationCount, 1);
}

{
  const repository = new InMemoryRepository();
  const first = createPlan({ idempotencyKey: "delegation-conflict-001" });
  await executeDelegationGrantRepositoryMutation({
    repository,
    plan: first,
    tenantId: TENANT_ID,
    schemaReadiness: readiness(),
    authorization: authorization(first),
    now: NOW,
  });
  const conflicting = createPlan({
    idempotencyKey: "delegation-conflict-001",
    allowedIntents: ["repo.patch.apply", "repo.pr.create"],
  });
  await assert.rejects(
    executeDelegationGrantRepositoryMutation({
      repository,
      plan: conflicting,
      tenantId: TENANT_ID,
      schemaReadiness: readiness(),
      authorization: authorization(conflicting),
      now: NOW,
    }),
    (error) => error.code === "DELEGATION_REPOSITORY_IDEMPOTENCY_CONFLICT",
  );
  assert.equal(repository.mutationCount, 1);
}

{
  const repository = new InMemoryRepository();
  const plan = createPlan({ idempotencyKey: "delegation-pending-001" });
  repository.seedReceipt(TENANT_ID, plan.receipt);
  const result = await executeDelegationGrantRepositoryMutation({
    repository,
    plan,
    tenantId: TENANT_ID,
    schemaReadiness: readiness(),
    authorization: authorization(plan),
    now: NOW,
  });
  assert.equal(result.decision, "blocked_existing_receipt_requires_reconciliation");
  assert.equal(result.mutation_applied, false);
  assert.equal(result.retry_allowed, false);
  assert.equal(repository.mutationCount, 0);
}

{
  const repository = new InMemoryRepository({ tamperGrantReadback: true });
  const plan = createPlan({ idempotencyKey: "delegation-readback-001" });
  await assert.rejects(
    executeDelegationGrantRepositoryMutation({
      repository,
      plan,
      tenantId: TENANT_ID,
      schemaReadiness: readiness(),
      authorization: authorization(plan),
      now: NOW,
    }),
    (error) => error.code === "DELEGATION_REPOSITORY_GRANT_READBACK_MISMATCH",
  );
  assert.equal(Object.keys(repository.state.grants).length, 0);
  assert.equal(Object.keys(repository.state.receipts).length, 0);
  assert.equal(repository.rollbackCount, 1);
}

{
  const repository = new InMemoryRepository({ failCommit: true });
  const plan = createPlan({ idempotencyKey: "delegation-unknown-001" });
  await assert.rejects(
    executeDelegationGrantRepositoryMutation({
      repository,
      plan,
      tenantId: TENANT_ID,
      schemaReadiness: readiness(),
      authorization: authorization(plan),
      now: NOW,
    }),
    (error) => error.code === "DELEGATION_REPOSITORY_COMMIT_OUTCOME_UNKNOWN"
      && error.details.retry_allowed === false,
  );
  assert.equal(repository.mutationCount, 1);
  repository.failCommit = false;
  const reconciled = await executeDelegationGrantRepositoryMutation({
    repository,
    plan,
    tenantId: TENANT_ID,
    schemaReadiness: readiness(),
    authorization: authorization(plan),
    now: NOW,
  });
  assert.equal(reconciled.decision, "idempotent_replay");
  assert.equal(repository.mutationCount, 1);
}

{
  const repository = new InMemoryRepository();
  const active = canonicalGrant();
  repository.seedGrant(TENANT_ID, active);
  const plan = planDelegationGrantRevokeShadow({
    grant: active,
    schemaReadiness: readiness(),
    operationId: OPERATION_ID,
    stepId: STEP_ID,
    idempotencyKey: "delegation-revoke-001",
    requestedBy: "user-1",
    principalScope: "tenant",
    reason: "scope withdrawn",
    now: NOW,
  });
  const result = await executeDelegationGrantRepositoryMutation({
    repository,
    plan,
    tenantId: TENANT_ID,
    schemaReadiness: readiness(),
    authorization: authorization(plan),
    now: NOW,
  });
  assert.equal(result.decision, "verified_success");
  assert.equal(result.grant.status, "revoked");
  assert.equal(result.grant.revoked_at, NOW);
}

{
  const repository = new InMemoryRepository();
  const expired = canonicalGrant({ expires_at: "2026-07-28T05:59:00.000Z" });
  repository.seedGrant(TENANT_ID, expired);
  const plan = planDelegationGrantExpireShadow({
    grant: expired,
    schemaReadiness: readiness(),
    operationId: OPERATION_ID,
    stepId: STEP_ID,
    idempotencyKey: "delegation-expire-001",
    requestedBy: "system-sweeper",
    principalScope: "system",
    now: NOW,
  });
  const result = await executeDelegationGrantRepositoryMutation({
    repository,
    plan,
    tenantId: TENANT_ID,
    schemaReadiness: readiness(),
    authorization: authorization(plan),
    now: NOW,
  });
  assert.equal(result.decision, "verified_success");
  assert.equal(result.grant.status, "expired");
}

{
  const repository = new InMemoryRepository();
  const plan = createPlan({ idempotencyKey: "delegation-schema-block-001" });
  await assert.rejects(
    executeDelegationGrantRepositoryMutation({
      repository,
      plan,
      tenantId: TENANT_ID,
      schemaReadiness: {},
      authorization: authorization(plan),
      now: NOW,
    }),
    (error) => error.code === "DELEGATION_REPOSITORY_SCHEMA_NOT_READY"
      && error.details.blockers.includes("DELEGATION_MIGRATION_NOT_APPLIED"),
  );
  assert.equal(repository.beginCount, 0);
}

{
  const repository = new InMemoryRepository();
  const plan = createPlan({ idempotencyKey: "delegation-auth-stale-001" });
  await assert.rejects(
    executeDelegationGrantRepositoryMutation({
      repository,
      plan,
      tenantId: TENANT_ID,
      schemaReadiness: readiness(),
      authorization: { ...authorization(plan), expected_request_fingerprint: HASH_A },
      now: NOW,
    }),
    (error) => error.code === "DELEGATION_REPOSITORY_AUTHORIZATION_STALE",
  );
  assert.equal(repository.beginCount, 0);
}

assert.equal(
  DELEGATION_GRANT_REPOSITORY_MUTATION_CONTRACT_VERSION,
  "spec011-delegation-grant-repository-mutation-v1",
);

const source = await readFile(new URL("./delegationGrantRepositoryMutationService.js", import.meta.url), "utf8");
assert.doesNotMatch(source, /getPool\s*\(/);
assert.doesNotMatch(source, /\.query\s*\(/);
assert.doesNotMatch(source, /\bINSERT\s+INTO\b/i);
assert.doesNotMatch(source, /\bUPDATE\s+agent_delegations\b/i);
assert.doesNotMatch(source, /express|Router\s*\(/);

console.log("delegation grant repository mutation contract tests passed");
